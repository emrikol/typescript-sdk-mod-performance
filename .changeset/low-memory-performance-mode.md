---
'@modelcontextprotocol/server': patch
'@modelcontextprotocol/node': patch
---

Add a per-server `performanceCaches` option for low-memory deployments, defaulting to enabled. Disabling it bypasses schema-conversion, tool-header, converted-tool-schema, discovery-list, and resource-template caches without changing protocol output. The Node adapter now imports operational symbols only from the lazy server runtime entry, and the deterministic server profiler compares runtime cache-on/cache-off modes with the root-entry baseline in fresh processes.
