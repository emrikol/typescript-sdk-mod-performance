import { describe, expect, it } from 'vitest';

import { createMcpHandler } from '../../src/server/createMcpHandler';
import { invoke } from '../../src/server/invoke';
import { McpServer, ResourceTemplate } from '../../src/server/mcp';

const LEGACY = { classification: { era: 'legacy' as const } };

function schema(property: string, header: string) {
    return {
        '~standard': {
            version: 1 as const,
            vendor: 'performance-cache-test',
            validate: (value: unknown) => ({ value }),
            jsonSchema: {
                input: () => ({
                    type: 'object',
                    properties: { [property]: { type: 'string', 'x-mcp-header': header } },
                    required: [property],
                    additionalProperties: false
                }),
                output: () => ({
                    type: 'object',
                    properties: { [property]: { type: 'string' } },
                    required: [property],
                    additionalProperties: false
                })
            }
        }
    };
}

type Inventory = ReturnType<typeof inventory>;

function inventory(performanceCaches: boolean) {
    const server = new McpServer(
        { name: 'cache-parity', version: '1.0.0' },
        { performanceCaches, capabilities: { tools: {}, prompts: {}, resources: {} } }
    );
    const originalSchema = schema('text', 'Text');
    const tool = server.registerTool('echo', { title: 'Echo', inputSchema: originalSchema, outputSchema: originalSchema }, async () => ({
        content: [],
        structuredContent: { text: 'ok' }
    }));
    const prompt = server.registerPrompt('hello', { title: 'Hello' }, async () => ({ messages: [] }));
    const resource = server.registerResource('config', 'memory://config', { title: 'Config' }, async () => ({ contents: [] }));
    const template = server.registerResource(
        'item',
        new ResourceTemplate('memory://items/{id}', {
            list: async () => ({ resources: [{ uri: 'memory://items/1', name: 'Item one' }] })
        }),
        { title: 'Item' },
        async () => ({ contents: [] })
    );
    return { server, tool, prompt, resource, template };
}

async function wireList(server: McpServer, method: string): Promise<string> {
    return (await invoke(server, { jsonrpc: '2.0', id: 1, method, params: {} }, LEGACY)).text();
}

async function discoveryLists(server: McpServer): Promise<Record<string, string>> {
    const lists: Record<string, string> = {};
    for (const method of ['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']) {
        lists[method] = await wireList(server, method);
    }
    return lists;
}

function discoverRequest(): Request {
    const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
            _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'cache-test', version: '1.0.0' },
                'io.modelcontextprotocol/clientCapabilities': {}
            }
        }
    };
    return new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-method': 'server/discover',
            'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify(body)
    });
}

async function wireDiscover(performanceCaches: boolean): Promise<string> {
    const handler = createMcpHandler(() => inventory(performanceCaches).server);
    try {
        return await (await handler.fetch(discoverRequest())).text();
    } finally {
        await handler.close();
    }
}

function mutate({ server, tool, prompt, resource, template }: Inventory): void {
    const updatedSchema = schema('message', 'Message');
    tool.update({ title: 'Echo updated', paramsSchema: updatedSchema, outputSchema: updatedSchema });
    prompt.disable();
    resource.disable();
    template.update({ metadata: { title: 'Item updated' } });
    server.registerTool('new-tool', {}, async () => ({ content: [] }));
    server.registerPrompt('new-prompt', {}, async () => ({ messages: [] }));
    server.registerResource('new-resource', 'memory://new', {}, async () => ({ contents: [] }));
}

describe('ServerOptions.performanceCaches', () => {
    it('returns byte-equivalent discovery lists, converted schemas, and server/discover results in both modes', async () => {
        const cached = inventory(true);
        const uncached = inventory(false);

        expect(await discoveryLists(uncached.server)).toEqual(await discoveryLists(cached.server));
        expect(await wireDiscover(false)).toBe(await wireDiscover(true));
        expect(uncached.server.toolInputSchemaJson('echo')).toEqual(cached.server.toolInputSchemaJson('echo'));
        expect(uncached.server.toolInputHeaderScan('echo')).toEqual(cached.server.toolInputHeaderScan('echo'));
    });

    it.each([true, false])('reflects registry changes after discovery in cache mode %s', async performanceCaches => {
        const state = inventory(performanceCaches);
        await discoveryLists(state.server);

        mutate(state);
        const lists = await discoveryLists(state.server);
        const tools = JSON.parse(lists['tools/list']!) as {
            result: { tools: Array<{ name: string; title?: string; inputSchema: Record<string, unknown> }> };
        };
        const prompts = JSON.parse(lists['prompts/list']!) as { result: { prompts: Array<{ name: string }> } };
        const resources = JSON.parse(lists['resources/list']!) as { result: { resources: Array<{ name: string }> } };
        const templates = JSON.parse(lists['resources/templates/list']!) as {
            result: { resourceTemplates: Array<{ name: string; title?: string }> };
        };

        expect(tools.result.tools.map(item => item.name)).toEqual(['echo', 'new-tool']);
        expect(tools.result.tools[0]).toMatchObject({
            title: 'Echo updated',
            inputSchema: { properties: { message: { type: 'string', 'x-mcp-header': 'Message' } } }
        });
        expect(prompts.result.prompts.map(item => item.name)).toEqual(['new-prompt']);
        expect(resources.result.resources.map(item => item.name)).toEqual(['new-resource', 'Item one']);
        expect(templates.result.resourceTemplates).toEqual([expect.objectContaining({ name: 'item', title: 'Item updated' })]);
        expect(state.server.toolInputHeaderScan('echo')).toMatchObject({
            valid: true,
            declarations: [expect.objectContaining({ path: ['message'], headerName: 'Message' })]
        });
    });

    it('bypasses conversion, scan, retained-tool-schema, and list memoization when disabled', async () => {
        let inputConversions = 0;
        let outputConversions = 0;
        const countedSchema = {
            '~standard': {
                version: 1 as const,
                vendor: 'conversion-counter',
                validate: (value: unknown) => ({ value }),
                jsonSchema: {
                    input: () => {
                        inputConversions += 1;
                        return { type: 'object', properties: {} };
                    },
                    output: () => {
                        outputConversions += 1;
                        return { type: 'object', properties: {} };
                    }
                }
            }
        };
        const server = new McpServer({ name: 'uncached', version: '1' }, { performanceCaches: false });
        server.registerTool('counted', { inputSchema: countedSchema, outputSchema: countedSchema }, async () => ({
            content: [],
            structuredContent: {}
        }));

        expect(inputConversions).toBe(1); // registration-time header scan
        expect(outputConversions).toBe(0); // converted output is not retained
        expect(server.toolInputHeaderScan('counted')).not.toBe(server.toolInputHeaderScan('counted'));
        await wireList(server, 'tools/list');
        await wireList(server, 'tools/list');
        expect(inputConversions).toBe(5);
        expect(outputConversions).toBe(2);
    });
});
