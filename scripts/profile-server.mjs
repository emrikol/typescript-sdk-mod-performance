import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ITERATIONS = 20_000;
const DEFAULT_RUNS = 7;
const INVENTORY_TOOLS = 128;
const scriptPath = fileURLToPath(import.meta.url);

function positiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} must be a positive integer.`);
    return parsed;
}

function flag(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

function gcMemory() {
    if (!globalThis.gc) throw new Error('Run the profiler with --expose-gc.');
    globalThis.gc();
    const { heapUsed, rss } = process.memoryUsage();
    return { heapUsedBytes: heapUsed, rssBytes: rss };
}

function cpuMilliseconds(start) {
    const used = process.cpuUsage(start);
    return (used.user + used.system) / 1000;
}

function memoryDelta(after, before) {
    return {
        heapBytes: after.heapUsedBytes - before.heapUsedBytes,
        rssBytes: after.rssBytes - before.rssBytes
    };
}

async function timedStage(operation, beforeMemory) {
    const cpu = process.cpuUsage();
    const started = performance.now();
    await operation();
    const wallMs = performance.now() - started;
    const cpuMs = cpuMilliseconds(cpu);
    const postGc = gcMemory();
    return { wallMs, cpuMs, ...memoryDelta(postGc, beforeMemory), postGc };
}

function modernRequest(method, id, params = {}) {
    const body = {
        jsonrpc: '2.0',
        id,
        method,
        params: {
            ...params,
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
            'mcp-method': method,
            ...(typeof params.name === 'string' && { 'mcp-name': params.name }),
            'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify(body)
    });
}

async function consume(response) {
    await response.arrayBuffer();
}

async function runWorker(moduleUrl, performanceCaches, iterations) {
    const baseline = gcMemory();
    let sdk;
    const importStage = await timedStage(async () => {
        sdk = await import(moduleUrl);
    }, baseline);

    // Application schemas are prepared after the SDK import so the cold-import
    // measurement includes the root entry's public catalog only when that entry
    // actually loads it. Schema setup itself is outside the registration timer.
    const z = await import('zod/v4');
    const fields = {};
    for (let index = 0; index < 24; index += 1) fields[`field${index}`] = z.string().optional();
    fields.text = z.string().meta({ 'x-mcp-header': 'Text' });
    const echoInputSchema = z.object(fields);
    const echoOutputSchema = z.object({ text: z.string() });
    const inventoryInputSchemas = [echoInputSchema];
    const inventoryOutputSchemas = [echoOutputSchema];
    for (let index = 1; index < INVENTORY_TOOLS; index += 1) {
        inventoryInputSchemas.push(z.object(fields));
        inventoryOutputSchemas.push(z.object({ text: z.string() }));
    }

    const options = { performanceCaches };
    const createServer = () => {
        const server = new sdk.McpServer({ name: 'profile-server', version: '1.0.0' }, options);
        server.registerTool('echo', { inputSchema: echoInputSchema, outputSchema: echoOutputSchema }, async ({ text }) => ({
            content: [{ type: 'text', text }],
            structuredContent: { text }
        }));
        return server;
    };

    const beforeRegistration = gcMemory();
    let registeredServer;
    const registrationStage = await timedStage(async () => {
        registeredServer = new sdk.McpServer({ name: 'profile-inventory', version: '1.0.0' }, options);
        for (let index = 0; index < INVENTORY_TOOLS; index += 1) {
            registeredServer.registerTool(
                `tool-${index}`,
                { inputSchema: inventoryInputSchemas[index], outputSchema: inventoryOutputSchemas[index] },
                async ({ text }) => ({ content: [{ type: 'text', text }], structuredContent: { text } })
            );
        }
    }, beforeRegistration);
    registrationStage.tools = INVENTORY_TOOLS;

    const handler = sdk.createMcpHandler(() => createServer());
    // Keep the registration sample faithful, then let the standalone instance
    // go; the hot path below is the documented one-fresh-server-per-request path.
    void registeredServer;
    registeredServer = undefined;

    let previousMemory = registrationStage.postGc;
    const discoveryStage = await timedStage(async () => {
        await consume(await handler.fetch(modernRequest('server/discover', 0)));
        await consume(await handler.fetch(modernRequest('tools/list', 1)));
    }, previousMemory);
    discoveryStage.requests = 2;

    previousMemory = discoveryStage.postGc;
    const firstRequestStage = await timedStage(async () => {
        await consume(await handler.fetch(modernRequest('tools/call', 2, { name: 'echo', arguments: { text: 'hello' } })));
    }, previousMemory);

    previousMemory = firstRequestStage.postGc;
    const hotStage = await timedStage(async () => {
        for (let index = 0; index < iterations; index += 1) {
            await consume(await handler.fetch(modernRequest('tools/call', index + 3, { name: 'echo', arguments: { text: 'hello' } })));
        }
    }, previousMemory);
    hotStage.requests = iterations;
    hotStage.microsecondsPerRequest = (hotStage.wallMs * 1000) / iterations;
    hotStage.cpuMicrosecondsPerRequest = (hotStage.cpuMs * 1000) / iterations;
    hotStage.requestsPerSecond = iterations / (hotStage.wallMs / 1000);

    await handler.close();
    const postCloseGc = gcMemory();

    return {
        processId: process.pid,
        module: fileURLToPath(moduleUrl),
        performanceCaches,
        iterations,
        inventoryTools: INVENTORY_TOOLS,
        baseline,
        stages: {
            coldImport: importStage,
            postRegistration: registrationStage,
            postDiscovery: discoveryStage,
            firstRequest: firstRequestStage,
            hotRequests: hotStage,
            postCloseGc: { ...postCloseGc, deltaFromBaseline: memoryDelta(postCloseGc, baseline) }
        }
    };
}

function median(values) {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function medianTree(values) {
    const first = values[0];
    if (typeof first === 'number') return median(values);
    if (first === null || typeof first !== 'object' || Array.isArray(first)) return first;
    return Object.fromEntries(
        Object.keys(first)
            .filter(key => key !== 'processId')
            .map(key => [key, medianTree(values.map(value => value[key]))])
    );
}

if (process.argv[2] === '--worker') {
    const moduleUrl = pathToFileURL(process.argv[3]).href;
    const performanceCaches = process.argv[4] === 'true';
    const iterations = positiveInteger(process.argv[5], 'iterations');
    console.log(JSON.stringify(await runWorker(moduleUrl, performanceCaches, iterations)));
} else {
    const iterations = positiveInteger(flag('--iterations', String(DEFAULT_ITERATIONS)), 'iterations');
    const runs = positiveInteger(flag('--runs', String(DEFAULT_RUNS)), 'runs');
    const includeSamples = process.argv.includes('--include-samples');
    const serverDist = new URL('../packages/server/dist/', import.meta.url);
    const scenarios = [
        {
            name: 'runtime+caching',
            module: fileURLToPath(new URL('runtime.mjs', serverDist)),
            performanceCaches: true
        },
        {
            name: 'runtime+no-caching',
            module: fileURLToPath(new URL('runtime.mjs', serverDist)),
            performanceCaches: false
        },
        {
            name: 'root+caching',
            module: fileURLToPath(new URL('index.mjs', serverDist)),
            performanceCaches: true
        }
    ];
    const samples = Object.fromEntries(scenarios.map(scenario => [scenario.name, []]));

    // Round-robin order limits time/temperature drift while every observation
    // still comes from a brand-new process with an empty module and heap state.
    for (let run = 0; run < runs; run += 1) {
        const rotatedScenarios = [...scenarios.slice(run % scenarios.length), ...scenarios.slice(0, run % scenarios.length)];
        for (const scenario of rotatedScenarios) {
            const child = spawnSync(
                process.execPath,
                ['--expose-gc', scriptPath, '--worker', scenario.module, String(scenario.performanceCaches), String(iterations)],
                { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
            );
            if (child.status !== 0) {
                throw new Error(
                    `${scenario.name} run ${run + 1} failed (${child.status}):\n${child.stderr || child.stdout || '<no output>'}`
                );
            }
            samples[scenario.name].push(JSON.parse(child.stdout));
        }
    }

    console.log(
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                node: process.version,
                platform: `${process.platform}/${process.arch}`,
                iterations,
                runs,
                freshProcessPerSample: true,
                scenarios: Object.fromEntries(
                    scenarios.map(scenario => [
                        scenario.name,
                        {
                            module: scenario.module,
                            performanceCaches: scenario.performanceCaches,
                            median: medianTree(samples[scenario.name]),
                            ...(includeSamples && { samples: samples[scenario.name] })
                        }
                    ])
                )
            },
            null,
            2
        )
    );
}
