# SDK performance

The SDK keeps the complete MCP feature set while avoiding work until its feature is used.

## Choose the entry

`@modelcontextprotocol/server` remains the complete root surface, including the public runtime schema exports. `@modelcontextprotocol/server/runtime` exposes the same operational server API and all protocol TypeScript types without eagerly evaluating that optional schema catalog.

`@modelcontextprotocol/client` likewise remains the complete client surface. `@modelcontextprotocol/client/runtime` provides `Client`, response caching, version-negotiation types, and protocol TypeScript types without eagerly loading OAuth and network-transport modules. Import the transport or authentication surface from the package root when it is needed.

`@modelcontextprotocol/node` imports its operational server dependencies from `@modelcontextprotocol/server/runtime`, so importing the Node adapter does not pull in the complete server root or the optional public protocol-schema catalog.

Session-style Streamable HTTP dynamically loads its exact JSON-RPC schemas on its first POST. Wire schemas remain memoized per era. Call `preloadSchemas()` during startup only on runtimes where predictable first-request latency matters more than cold memory.

## Caches

- Standard Schema to JSON Schema conversion is cached by schema object in a `WeakMap`, so shared definitions across stateless request factories convert once and remain collectible.
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

`performanceCaches` defaults to `true`. Setting it to `false` bypasses the JSON-Schema conversion WeakMaps, `x-mcp-header` scan cache, retained converted tool schemas, discovery-list caches, and resource-template indexes. It does not alter validation, schemas, inventory, cache hints, protocol behavior, or serialized responses. The option is per server and is never read from an environment variable.

## Profile

Build first, then run the three-scenario server comparison:

```bash
pnpm --filter @modelcontextprotocol/server build
pnpm profile:server -- --iterations 20000 --runs 7
pnpm --filter @modelcontextprotocol/client build
pnpm profile:client -- packages/client/dist/runtime.mjs 20000
```

The server profiler launches a fresh process for every sample and reports medians for `runtime+caching`, `runtime+no-caching`, and the `root+caching` baseline. Each process records cold import, post-registration, post-discovery (`server/discover` plus `tools/list`), first `tools/call`, 20,000 hot `tools/call` requests, and post-close GC heap/RSS, with wall time, CPU, latency, and throughput. Add `--include-samples` to retain all raw runs in the JSON report.

The profile exercises real modern HTTP requests through `Request`, JSON parsing, protocol classification, schema validation, dispatch, response encoding, and teardown. Keep transport overhead separate from SDK overhead when interpreting results: Fetch `Request`/`Response`, JSON parsing, and Web Streams can dominate a fast handler.

### Measured tradeoff

The following is the seven-run median from 2026-08-17 on Node 22.19.0, macOS arm64. Registration uses 128 tools with distinct Zod schema objects; discovery performs `server/discover` and `tools/list`; the hot phase performs 20,000 modern `tools/call` requests through a fresh-server-per-request factory. Memory values are measured after forced GC. Times and RSS are host-sensitive, so rerun the command above on the deployment class you care about.

| Metric                         |    runtime+caching |     runtime+no-caching |       root+caching |
| ------------------------------ | -----------------: | ---------------------: | -----------------: |
| Cold import wall time          |           35.94 ms |               35.69 ms |           52.32 ms |
| Cold import heap / RSS delta   |   5.17 / 16.22 MiB |       5.17 / 16.11 MiB |  10.76 / 26.45 MiB |
| Post-registration heap delta   |           0.59 MiB |               0.29 MiB |           0.59 MiB |
| Post-discovery heap            |          19.74 MiB |              19.44 MiB |          25.09 MiB |
| First request                  |            0.87 ms |                1.21 ms |            0.91 ms |
| 20,000 hot requests wall / CPU | 477.33 / 688.10 ms | 2,298.46 / 2,542.74 ms | 483.80 / 703.68 ms |
| Hot latency                    |   23.87 µs/request |      114.92 µs/request |   24.19 µs/request |
| Hot throughput                 |  41,900 requests/s |       8,701 requests/s |  41,339 requests/s |
| Post-close GC heap / RSS       | 20.92 / 118.30 MiB |     20.68 / 116.72 MiB | 26.26 / 124.36 MiB |

On this workload, disabling caches saved about 0.24 MiB post-GC heap and 1.58 MiB RSS, while hot request latency increased 4.8× and throughput fell about 79%. Selecting `/runtime` with caching retained the cached hot-path performance while saving about 5.34 MiB heap and 6.06 MiB RSS versus the root+caching baseline after the run. The cache-off mode is therefore intended for memory ceilings where a small retained-heap reduction matters more than CPU capacity; `/runtime` is the broadly favorable default for operational-only servers.

For CPU flamegraphs, run a single worker with Node's built-in profiler flags:

```bash
node --cpu-prof --expose-gc scripts/profile-server.mjs --worker packages/server/dist/runtime.mjs true 100000
```
