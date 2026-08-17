# SDK performance

The SDK keeps the complete MCP feature set while avoiding work until its feature is used.

## Choose the entry

`@modelcontextprotocol/server` remains the complete root surface, including the public runtime schema exports. `@modelcontextprotocol/server/runtime` exposes the same operational server API and all protocol TypeScript types without eagerly evaluating that optional schema catalog.

`@modelcontextprotocol/client` likewise remains the complete client surface. `@modelcontextprotocol/client/runtime` provides `Client`, response caching, version-negotiation types, and protocol TypeScript types without eagerly loading OAuth and network-transport modules. Import the transport or authentication surface from the package root when it is needed.

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

## Profile

Build first, then profile a fresh process:

```bash
pnpm --filter @modelcontextprotocol/server build
pnpm profile:server -- packages/server/dist/runtime.mjs 20000
pnpm --filter @modelcontextprotocol/client build
pnpm profile:client -- packages/client/dist/runtime.mjs 20000
```

Use at least seven fresh runs and compare medians. The included profile exercises a real modern `tools/call` through `Request`, JSON parsing, protocol classification, schema validation, dispatch, response encoding, and teardown. For CPU flamegraphs, pass Node's built-in profiler flags:

```bash
node --cpu-prof --expose-gc scripts/profile-server.mjs packages/server/dist/runtime.mjs 100000
```

Keep transport overhead separate from SDK overhead when interpreting results: Fetch `Request`/`Response`, JSON parsing, and Web Streams can dominate a fast handler.
