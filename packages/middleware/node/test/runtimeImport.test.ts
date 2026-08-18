import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';

const importState = vi.hoisted(() => ({ ajvEvaluated: false }));

vi.mock('@modelcontextprotocol/server', () => {
    throw new Error('the Node adapter evaluated the full server root');
});
vi.mock('@modelcontextprotocol/core', () => {
    throw new Error('the Node adapter evaluated the optional public protocol-schema catalog');
});
vi.mock('@modelcontextprotocol/core-internal/validators/ajv', () => {
    importState.ajvEvaluated = true;
    throw new Error('the Node adapter evaluated the optional AJV provider');
});

function diagnostic(key: string): unknown {
    return (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for(key)];
}

test('imports operational symbols only from the lazy server runtime', async () => {
    expect(importState.ajvEvaluated).toBe(false);
    expect(diagnostic('@modelcontextprotocol/sdk/public-schema-catalog')).toBeUndefined();
    expect(diagnostic('@modelcontextprotocol/sdk/wire-schema-2025-built')).toBeUndefined();
    expect(diagnostic('@modelcontextprotocol/sdk/wire-schema-2026-built')).toBeUndefined();

    await expect(import('../src/index')).resolves.toMatchObject({
        NodeStreamableHTTPServerTransport: expect.any(Function),
        toNodeHandler: expect.any(Function)
    });

    // Importing an adapter selects no wire era, does not load the optional
    // validator/catalog, and never behaves like the workerd warm-up shim.
    expect(importState.ajvEvaluated).toBe(false);
    expect(diagnostic('@modelcontextprotocol/sdk/public-schema-catalog')).toBeUndefined();
    expect(diagnostic('@modelcontextprotocol/sdk/wire-schema-2025-built')).toBeUndefined();
    expect(diagnostic('@modelcontextprotocol/sdk/wire-schema-2026-built')).toBeUndefined();
});

test('every adapter source edge targets the runtime and none calls preloadSchemas', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sources = [
        '../src/streamableHttp.ts',
        '../src/toNodeHandler.ts',
        '../src/middleware/hostHeaderValidation.ts',
        '../src/middleware/originValidation.ts'
    ].map(sourcePath => readFileSync(path.join(here, sourcePath), 'utf8'));
    expect(sources.join('\n')).toMatch(/from '@modelcontextprotocol\/server\/runtime'/);
    for (const source of sources) {
        expect(source).not.toMatch(/from '@modelcontextprotocol\/server'/);
        expect(source).not.toMatch(/\bpreloadSchemas\s*\(/);
    }
});
