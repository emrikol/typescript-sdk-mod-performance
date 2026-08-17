import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2] ?? './packages/client/dist/runtime.mjs';
const iterations = Number.parseInt(process.argv[3] ?? '20000', 10);

if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new TypeError('Iterations must be a positive integer.');
}

function memory() {
    globalThis.gc?.();
    return process.memoryUsage();
}

function elapsedCpu(start) {
    const used = process.cpuUsage(start);
    return (used.user + used.system) / 1000;
}

class ProfileTransport {
    onmessage;
    onerror;
    onclose;

    async start() {}

    async send(message) {
        if (!('id' in message)) return;
        const result =
            message.method === 'server/discover'
                ? {
                      resultType: 'complete',
                      supportedVersions: ['2026-07-28'],
                      capabilities: { tools: {} },
                      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'profile-server', version: '1.0.0' } }
                  }
                : {
                      resultType: 'complete',
                      content: [{ type: 'text', text: message.params?.arguments?.text ?? '' }]
                  };
        queueMicrotask(() => this.onmessage?.({ jsonrpc: '2.0', id: message.id, result }));
    }

    async close() {
        this.onclose?.();
    }

    setProtocolVersion() {}
}

const beforeImport = memory();
const importCpu = process.cpuUsage();
const importStarted = performance.now();
const sdk = await import(pathToFileURL(modulePath).href);
const importMs = performance.now() - importStarted;
const importCpuMs = elapsedCpu(importCpu);
const afterImport = memory();

const client = new sdk.Client({ name: 'profile-client', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
const transport = new ProfileTransport();
const connectStarted = performance.now();
await client.connect(transport);
const connectMs = performance.now() - connectStarted;
const afterConnect = memory();

const hotCpu = process.cpuUsage();
const hotStarted = performance.now();
for (let index = 0; index < iterations; index += 1) {
    await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
}
const hotMs = performance.now() - hotStarted;
const hotCpuMs = elapsedCpu(hotCpu);
const afterHot = memory();
await client.close();

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
        connect: {
            wallMs: connectMs,
            heapBytes: afterConnect.heapUsed - afterImport.heapUsed,
            rssBytes: afterConnect.rss - afterImport.rss
        },
        hot: {
            wallMs: hotMs,
            cpuMs: hotCpuMs,
            microsecondsPerRequest: (hotMs * 1000) / iterations,
            cpuMicrosecondsPerRequest: (hotCpuMs * 1000) / iterations,
            retainedHeapBytes: afterHot.heapUsed - afterConnect.heapUsed,
            retainedRssBytes: afterHot.rss - afterConnect.rss
        }
    })
);
