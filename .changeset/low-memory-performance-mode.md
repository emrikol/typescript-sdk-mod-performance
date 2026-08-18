---
'@modelcontextprotocol/server': patch
'@modelcontextprotocol/node': patch
---

Add genuine lazy Node JSON Schema validation and a per-server `performanceCaches` option for low-memory deployments, defaulting to enabled. Server/runtime, the Node adapter, registration, `server/discover`, and `tools/list` no longer evaluate AJV; `fromJsonSchema()` compiles only the selected tool's required validators on its first call. Disabling caches also discards compiled validators and the default provider after each request, in addition to bypassing schema-conversion, tool-header, converted-tool-schema, discovery-list, and resource-template caches, without changing protocol output. The deterministic profiler compares runtime cache-on/cache-off modes with the root-entry baseline in fresh processes and reports module state and compilation counts.
