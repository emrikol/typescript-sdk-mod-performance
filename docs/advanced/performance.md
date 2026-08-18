# SDK performance

The SDK keeps the complete MCP feature set while avoiding work until its feature is used.

## Choose the entry

`@modelcontextprotocol/server` remains the complete root surface, including the public runtime schema exports. `@modelcontextprotocol/server/runtime` exposes the same operational server API and all protocol TypeScript types without eagerly evaluating that optional schema catalog.

`@modelcontextprotocol/client` likewise remains the complete client surface. `@modelcontextprotocol/client/runtime` provides `Client`, response caching, version-negotiation types, and protocol TypeScript types without eagerly loading OAuth and network-transport modules. Import the transport or authentication surface from the package root when it is needed.

`@modelcontextprotocol/node` imports its operational server dependencies from `@modelcontextprotocol/server/runtime`, so importing the Node adapter does not pull in the complete server root or the optional public protocol-schema catalog.

Session-style Streamable HTTP dynamically loads its exact JSON-RPC schemas on its first POST. Wire schemas remain memoized per era. Call `preloadSchemas()` during startup only on runtimes where predictable first-request latency matters more than cold memory.

On Node.js, the default AJV provider is a separate dynamic chunk. Importing `server/runtime`, constructing a server, registering tools with `fromJsonSchema()`, `server/discover`, and `tools/list` do not evaluate AJV. `fromJsonSchema()` advertises its raw schema directly and loads AJV only when a call needs validation. On that first `tools/call`, only the selected tool's input validator and any required output validator compile; other registered tools remain cold.

## Caches

- Standard Schema to JSON Schema conversion is cached by schema object in a `WeakMap`, so shared definitions across stateless request factories convert once and remain collectible.
- Compiled `fromJsonSchema()` validators are cached by wrapper and selected tool. Registration and discovery retain no compiled validator.
- `x-mcp-header` scans share the converted-schema cache.
- Tool, prompt, static-resource, and resource-template discovery results are cached once per server registry generation. Any registration update invalidates the relevant cache.
- Resource-template completion uses a generation-cached URI lookup instead of scanning all templates for every completion.
- Resource-template registry values are materialized once per registration generation. Independent dynamic `resources/list` callbacks run concurrently, while their results still merge in registration order.
- Session HTTP keeps a reverse stream-to-request index, so completing one batch does not scan unrelated in-flight requests.
- Client cache partitions are encoded once per connection, not rebuilt for every lookup. The in-memory store uses collision-free length-prefixed keys without per-probe JSON serialization.
- A tool call resolves its cached descriptor and lazily compiled output validator together. Uncalled tool schemas are never compiled, and the backing store is probed once rather than once per derived view.
- Wire-codec result membership is queried directly. The request path never runs a deliberately failing result validation merely to discover whether a method exists.

These caches are bounded by live application definitions or by one current registry generation. The SDK does not run cache expiry timers or attempt idle unloading.

For a memory-constrained server, disable all server-side performance caches on that server instance:

```ts
const server = new McpServer({ name: 'low-memory-server', version: '1.0.0' }, { performanceCaches: false });
```

`performanceCaches` defaults to `true`. Setting it to `false` bypasses compiled-validator retention, the retained default validator provider, JSON-Schema conversion WeakMaps, `x-mcp-header` scan cache, retained converted tool schemas, discovery-list caches, and resource-template indexes. The default provider and compiled input/output functions are request-scoped and discarded after the call. It does not alter validation, schemas, inventory, cache hints, protocol behavior, or serialized responses. The option is per server and is never read from an environment variable. A custom validator provider remains owned by its caller, so any caches inside that custom implementation are likewise caller-owned.

## Profile

Build first, then run the three-scenario server comparison:

```bash
pnpm --filter @modelcontextprotocol/server build
pnpm profile:server -- --iterations 20000 --runs 7
pnpm --filter @modelcontextprotocol/client build
pnpm profile:client -- packages/client/dist/runtime.mjs 20000
```

The server profiler launches a fresh process for every sample and reports medians for `runtime+caching`, `runtime+no-caching`, and the `root+caching` baseline. Each process separately records cold import, post-registration, post-`server/discover`, post-`tools/list`, first `tools/call`, 20,000 hot `tools/call` requests, and post-close GC heap/RSS, with wall time, CPU, latency, throughput, validator compilation counts, and loaded-module state. Add `--include-samples` to retain all raw runs in the JSON report.

The profile exercises real modern HTTP requests through `Request`, JSON parsing, protocol classification, schema validation, dispatch, response encoding, and teardown. Keep transport overhead separate from SDK overhead when interpreting results: Fetch `Request`/`Response`, JSON parsing, and Web Streams can dominate a fast handler.

### Measured tradeoff

The following is the seven-run median from 2026-08-17 on Node 22.19.0, macOS arm64. Registration uses 128 tools with distinct raw JSON Schemas wrapped by `fromJsonSchema()`; the hot phase performs 20,000 modern `tools/call` requests through a fresh-server-per-request factory. Memory values are measured after forced GC. Times and especially RSS are host-sensitive, so rerun the command above on the deployment class you care about.

| Metric                                          |             runtime+caching |          runtime+no-caching |                root+caching |
| ----------------------------------------------- | --------------------------: | --------------------------: | --------------------------: |
| Cold import wall / CPU                          |            27.30 / 31.47 ms |            26.52 / 30.78 ms |            41.13 / 50.31 ms |
| Cold import heap / RSS delta                    |            4.19 / 14.77 MiB |            4.19 / 14.59 MiB |            9.78 / 24.56 MiB |
| Post-registration wall / heap delta             |          3.84 ms / 0.25 MiB |          3.65 ms / 0.17 MiB |          3.69 ms / 0.25 MiB |
| Post-`server/discover` heap / RSS               |           16.22 / 74.94 MiB |           16.15 / 74.80 MiB |           21.56 / 85.39 MiB |
| Post-`tools/list` wall / heap / RSS             | 1.02 ms / 16.25 / 75.20 MiB | 0.99 ms / 16.18 / 74.86 MiB | 1.14 ms / 21.59 / 85.61 MiB |
| First tool call wall / CPU                      |            18.20 / 20.02 ms |            18.60 / 24.14 ms |            17.70 / 19.95 ms |
| 20,000 hot calls wall / CPU                     |        706.27 / 1,187.96 ms |    12,344.07 / 13,327.27 ms |        712.23 / 1,199.26 ms |
| Hot latency                                     |            35.31 µs/request |           617.20 µs/request |            35.61 µs/request |
| Hot throughput                                  |           28,318 requests/s |            1,620 requests/s |           28,081 requests/s |
| Validator compilations after list / first / hot |                   0 / 2 / 2 |              0 / 2 / 40,002 |                   0 / 2 / 2 |
| Post-close GC heap / RSS                        |          19.43 / 199.80 MiB |          19.41 / 168.81 MiB |          24.78 / 225.64 MiB |

Loaded-module telemetry was deterministic across all samples: AJV stayed unloaded through `tools/list`, then loaded once on the first tool call. The runtime entry never evaluated the optional public schema catalog; the root baseline did. `server/discover` constructed the 2026 wire schema graph, while the unused 2025 graph stayed unbuilt.

On this workload, disabling caches saved about 0.03 MiB post-GC heap and 30.98 MiB RSS, while hot request latency increased 17.5× and throughput fell 94.3% because 40,002 request-scoped validators were compiled instead of two. Selecting `/runtime` with caching saved 5.59 MiB heap and 9.80 MiB RSS at cold import, and 5.35 MiB heap and 25.84 MiB RSS after the run, versus the root+caching baseline. This matches the intended tradeoff: cache-off is for hard memory ceilings and low request volume; `/runtime` with caching is the general-purpose server default.

For context, the supplied Ecobee MCP reference is a 47.9 KiB `tools/list` document (5.4 KiB gzip), about 1.74 MiB retained heap for first schema setup, about 32 KiB for an additional per-request registry, and a 5.6 MiB heap / 9.8 MiB RSS root-versus-runtime import opportunity. This local fixture measured a 1.59 MiB first-call heap increase, about 28 KiB after `tools/list`, and a 5.59 MiB / 9.80 MiB cold-import difference respectively. The Ecobee payload itself was not re-run by this deterministic local profiler.

For CPU flamegraphs, run a single worker with Node's built-in profiler flags:

```bash
node --cpu-prof --expose-gc scripts/profile-server.mjs --worker packages/server/dist/runtime.mjs true 100000
```
