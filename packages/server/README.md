# `@modelcontextprotocol/server`

The MCP (Model Context Protocol) TypeScript server SDK. Build MCP servers that expose tools, resources, and prompts.

<!-- prettier-ignore -->
> [!WARNING]
> **v2 is the stable release line**, implementing the [2026-07-28 MCP spec](https://modelcontextprotocol.io/specification/2026-07-28). Migrating from v1? Start with the [migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/).

<!-- prettier-ignore -->
> [!NOTE]
> This is **v2** of the MCP TypeScript SDK. It replaces the monolithic `@modelcontextprotocol/sdk` package from v1. See the **[migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)** if you're coming from v1.

## Install

```bash
npm install @modelcontextprotocol/server
```

TypeScript ≥6.0 no longer auto-includes `@types/*` — add `"types": ["node"]` to your `tsconfig.json` `compilerOptions` (the published `.d.mts` references `Buffer`).

Optional framework adapters: [`@modelcontextprotocol/express`](https://www.npmjs.com/package/@modelcontextprotocol/express), [`@modelcontextprotocol/fastify`](https://www.npmjs.com/package/@modelcontextprotocol/fastify), [`@modelcontextprotocol/hono`](https://www.npmjs.com/package/@modelcontextprotocol/hono),
[`@modelcontextprotocol/node`](https://www.npmjs.com/package/@modelcontextprotocol/node).

## Performance-oriented runtime entry

This fork also exports `@modelcontextprotocol/server/runtime`. It has the same complete server API and TypeScript types as the package root, but it does not eagerly load the optional public Zod protocol-schema catalog. Session-style HTTP loads its full message schemas on first use; modern per-request HTTP and long-lived transports construct only the wire era they actually serve.

```ts
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server/runtime';
```

Use the package root when the same module also imports public runtime schema constants. Use `/runtime` for servers that only register and serve tools, resources, and prompts. `preloadSchemas()` remains available when moving one-time schema construction into startup is preferable to first-request latency.

Immutable schema conversion, tool-header scans, and discovery lists are cached in bounded `WeakMap` or per-server generation caches. Registry updates invalidate the affected discovery cache immediately; no idle timers or background unloading are used.

On a memory-constrained server, pass `{ performanceCaches: false }` as the second `McpServer` constructor argument. The option defaults to `true`; disabling it bypasses schema-conversion and tool-header caches, retained converted tool schemas, discovery-list caches, and resource-template indexes without changing validation, schemas, inventory, cache hints, protocol behavior, or wire output.

```ts
const server = new McpServer({ name: 'low-memory-server', version: '1.0.0' }, { performanceCaches: false });
```

Run the reproducible HTTP profile with:

```bash
pnpm profile:server -- --iterations 20000 --runs 7
```

The profiler compares fresh-process medians for runtime+caching, runtime+no-caching, and root+caching. It reports cold import, registration, discovery, first-request and 20,000-request hot-path CPU/wall time, latency, throughput, and post-GC heap/RSS.

## Documentation

- **[Repository README](https://github.com/modelcontextprotocol/typescript-sdk#readme)** — overview, package layout, examples
- **[Server guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools)** — tools, resources, prompts, and the rest of the server surface
- **[Serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)** — stdio, HTTP, the framework adapters, sessions, and authorization
- **[API reference](https://ts.sdk.modelcontextprotocol.io/v2/)**
- **[MCP specification](https://modelcontextprotocol.io)**
