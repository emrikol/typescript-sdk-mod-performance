import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import * as z from 'zod/v4';

const modulePath = process.argv[2] ?? './packages/server/dist/index.mjs';
const iterations = Number.parseInt(process.argv[3] ?? '2000', 10);

if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new TypeError('Iterations must be a positive integer.');
}

function memory() {
    if (globalThis.gc) globalThis.gc();
    const usage = process.memoryUsage();
    return { heapUsed: usage.heapUsed, rss: usage.rss };
}

function elapsedCpu(start) {
    const used = process.cpuUsage(start);
    return (used.user + used.system) / 1000;
}

function request(id) {
    const body = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
            name: 'echo',
            arguments: { text: 'hello' },
            _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'profile-client', version: '1.0.0' },
                'io.modelcontextprotocol/clientCapabilities': {}
            }
        }
    };
    return new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-method': 'tools/call',
            'mcp-name': 'echo',
            'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify(body)
    });
}

const beforeImport = memory();
const importCpu = process.cpuUsage();
const importStarted = performance.now();
const sdk = await import(pathToFileURL(modulePath).href);
const importMs = performance.now() - importStarted;
const importCpuMs = elapsedCpu(importCpu);
const afterImport = memory();

// Schemas are application definitions, not request data. A realistic server
// creates them once and reuses them when constructing per-request instances.
const echoInputSchema = z.object({ text: z.string() });
const handler = sdk.createMcpHandler(() => {
    const server = new sdk.McpServer({ name: 'profile-server', version: '1.0.0' });
    server.registerTool('echo', { inputSchema: echoInputSchema }, async ({ text }) => ({
        content: [{ type: 'text', text }]
    }));
    return server;
});

const afterSetup = memory();
const firstStarted = performance.now();
const firstResponse = await handler.fetch(request(0));
await firstResponse.arrayBuffer();
const firstRequestMs = performance.now() - firstStarted;
const afterFirst = memory();

const hotCpu = process.cpuUsage();
const hotStarted = performance.now();
for (let index = 1; index <= iterations; index += 1) {
    const response = await handler.fetch(request(index));
    await response.arrayBuffer();
}
const hotMs = performance.now() - hotStarted;
const hotCpuMs = elapsedCpu(hotCpu);
const afterHot = memory();
await handler.close();

console.log(
    JSON.stringify({
        module: modulePath,
        iterations,
        import: {
            wallMs: importMs,
            cpuMs: importCpuMs,
            heapBytes: afterImport.heapUsed - beforeImport.heapUsed,
            rssBytes: afterImport.rss - beforeImport.rss
        },
        setup: {
            heapBytes: afterSetup.heapUsed - afterImport.heapUsed,
            rssBytes: afterSetup.rss - afterImport.rss
        },
        firstRequest: {
            wallMs: firstRequestMs,
            heapBytes: afterFirst.heapUsed - afterSetup.heapUsed,
            rssBytes: afterFirst.rss - afterSetup.rss
        },
        hot: {
            wallMs: hotMs,
            cpuMs: hotCpuMs,
            microsecondsPerRequest: (hotMs * 1000) / iterations,
            cpuMicrosecondsPerRequest: (hotCpuMs * 1000) / iterations,
            retainedHeapBytes: afterHot.heapUsed - afterFirst.heapUsed,
            retainedRssBytes: afterHot.rss - afterFirst.rss
        }
    })
);
