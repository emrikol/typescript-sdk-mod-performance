import type { JsonSchemaType } from '@modelcontextprotocol/core-internal/server-runtime';
import { describe, expect, test, vi } from 'vitest';

const ajvState = vi.hoisted(() => ({ moduleEvaluations: 0, compiledSchemas: [] as unknown[] }));

vi.mock('@modelcontextprotocol/core-internal/validators/ajv', async () => {
    ajvState.moduleEvaluations += 1;
    const actual = await vi.importActual<typeof import('@modelcontextprotocol/core-internal/validators/ajv')>(
        '@modelcontextprotocol/core-internal/validators/ajv'
    );
    return {
        ...actual,
        AjvJsonSchemaValidator: class extends actual.AjvJsonSchemaValidator {
            override getValidator<T>(schema: JsonSchemaType) {
                ajvState.compiledSchemas.push(schema);
                return super.getValidator<T>(schema);
            }
        }
    };
});

import { createMcpHandler } from '../../src/server/createMcpHandler';
import { fromJsonSchema } from '../../src/fromJsonSchema';
import { invoke } from '../../src/server/invoke';
import { McpServer } from '../../src/server/mcp';

const LEGACY = { classification: { era: 'legacy' as const } };

function objectSchema(label: string): JsonSchemaType {
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: label,
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false
    };
}

function inventory(performanceCaches: boolean) {
    const alphaInput = objectSchema('alpha-input');
    const alphaOutput = objectSchema('alpha-output');
    const betaInput = objectSchema('beta-input');
    const betaOutput = objectSchema('beta-output');
    const calls = { alpha: 0, beta: 0 };
    const server = new McpServer({ name: 'lazy-json-schema', version: '1.0.0' }, { performanceCaches });
    const alpha = server.registerTool(
        'alpha',
        {
            inputSchema: fromJsonSchema<{ value: string }>(alphaInput),
            outputSchema: fromJsonSchema<{ value: string }>(alphaOutput)
        },
        async ({ value }) => {
            calls.alpha += 1;
            return { content: [], structuredContent: { value } };
        }
    );
    server.registerTool(
        'beta',
        {
            inputSchema: fromJsonSchema<{ value: string }>(betaInput),
            outputSchema: fromJsonSchema<{ value: string }>(betaOutput)
        },
        async ({ value }) => {
            calls.beta += 1;
            return { content: [], structuredContent: { value } };
        }
    );
    return { server, alpha, calls, alphaInput, alphaOutput, betaInput, betaOutput };
}

async function wire(server: McpServer, method: string, params: Record<string, unknown> = {}): Promise<string> {
    return (await invoke(server, { jsonrpc: '2.0', id: 1, method, params }, LEGACY)).text();
}

function modernRequest(method: 'server/discover'): Request {
    const body = {
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
            _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'lazy-test', version: '1.0.0' },
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
            'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify(body)
    });
}

describe.sequential('lazy JSON Schema validation', () => {
    test('registration, server/discover, and tools/list preserve raw schemas without evaluating AJV', async () => {
        const state = inventory(true);
        expect(ajvState).toMatchObject({ moduleEvaluations: 0, compiledSchemas: [] });
        expect(state.server.toolInputSchemaJson('alpha')).toBe(state.alphaInput);

        const listWire = await wire(state.server, 'tools/list');
        const list = JSON.parse(listWire) as {
            result: { tools: Array<{ inputSchema: JsonSchemaType; outputSchema?: JsonSchemaType }> };
        };
        expect(list.result.tools[0]?.inputSchema).toEqual(state.alphaInput);
        expect(list.result.tools[0]?.outputSchema).toEqual(state.alphaOutput);
        expect(ajvState).toMatchObject({ moduleEvaluations: 0, compiledSchemas: [] });

        const handler = createMcpHandler(() => inventory(true).server);
        try {
            const response = await handler.fetch(modernRequest('server/discover'));
            expect(response.status).toBe(200);
            await response.arrayBuffer();
        } finally {
            await handler.close();
        }
        expect(ajvState).toMatchObject({ moduleEvaluations: 0, compiledSchemas: [] });
    });

    test('the first tools/call loads AJV and compiles only the selected tool validators', async () => {
        const state = inventory(true);
        const before = ajvState.compiledSchemas.length;

        const first = JSON.parse(await wire(state.server, 'tools/call', { name: 'alpha', arguments: { value: 'ok' } })) as {
            result: { isError?: boolean };
        };
        expect(first.result.isError).not.toBe(true);
        expect(ajvState.moduleEvaluations).toBe(1);
        expect(ajvState.compiledSchemas.slice(before)).toEqual([state.alphaInput, state.alphaOutput]);
        expect(state.calls).toEqual({ alpha: 1, beta: 0 });

        await wire(state.server, 'tools/call', { name: 'alpha', arguments: { value: 'again' } });
        expect(ajvState.compiledSchemas.slice(before)).toEqual([state.alphaInput, state.alphaOutput]);

        await wire(state.server, 'tools/call', { name: 'beta', arguments: { value: 'now' } });
        expect(ajvState.compiledSchemas.slice(before)).toEqual([state.alphaInput, state.alphaOutput, state.betaInput, state.betaOutput]);
    });

    test('cache modes have byte-equivalent valid and malformed calls while cache-off retains no compiled validators', async () => {
        const cached = inventory(true);
        const uncached = inventory(false);

        const validParams = { name: 'alpha', arguments: { value: 'ok' } };
        const invalidParams = { name: 'alpha', arguments: { value: 42 } };
        expect(await wire(uncached.server, 'tools/call', validParams)).toBe(await wire(cached.server, 'tools/call', validParams));
        expect(await wire(uncached.server, 'tools/call', invalidParams)).toBe(await wire(cached.server, 'tools/call', invalidParams));
        expect(cached.calls.alpha).toBe(1);
        expect(uncached.calls.alpha).toBe(1);

        const beforeCachedRepeat = ajvState.compiledSchemas.length;
        await wire(cached.server, 'tools/call', validParams);
        expect(ajvState.compiledSchemas.length).toBe(beforeCachedRepeat);

        const beforeUncachedRepeat = ajvState.compiledSchemas.length;
        await wire(uncached.server, 'tools/call', validParams);
        expect(ajvState.compiledSchemas.length - beforeUncachedRepeat).toBe(2);
    });

    test('changing a registered schema invalidates only that tool validator cache', async () => {
        const state = inventory(true);
        await wire(state.server, 'tools/call', { name: 'alpha', arguments: { value: 'before' } });
        const replacement = objectSchema('alpha-input-replacement');
        state.alpha.update({ paramsSchema: fromJsonSchema<{ value: string }>(replacement) });

        const before = ajvState.compiledSchemas.length;
        await wire(state.server, 'tools/call', { name: 'alpha', arguments: { value: 'after' } });
        expect(ajvState.compiledSchemas.slice(before)).toEqual([replacement]);
    });
});
