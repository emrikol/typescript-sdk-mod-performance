import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';

import { schemasBuilt2025 } from '../../../core-internal/src/wire/rev2025-11-25/buildSchemas';
import { schemasBuilt2026 } from '../../../core-internal/src/wire/rev2026-07-28/buildSchemas';

vi.mock('@modelcontextprotocol/server', () => {
    throw new Error('the Node adapter evaluated the full server root');
});
vi.mock('@modelcontextprotocol/core', () => {
    throw new Error('the Node adapter evaluated the optional public protocol-schema catalog');
});

test('imports operational symbols only from the lazy server runtime', async () => {
    expect(schemasBuilt2025()).toBe(false);
    expect(schemasBuilt2026()).toBe(false);

    await expect(import('../src/index')).resolves.toMatchObject({
        NodeStreamableHTTPServerTransport: expect.any(Function),
        toNodeHandler: expect.any(Function)
    });

    // Importing an adapter selects no wire era and must never behave like the
    // workerd warm-up shim: both schema graphs stay unconstructed.
    expect(schemasBuilt2025()).toBe(false);
    expect(schemasBuilt2026()).toBe(false);
});

test('every adapter source edge targets the runtime and none calls preloadSchemas', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = [
        '../src/streamableHttp.ts',
        '../src/toNodeHandler.ts',
        '../src/middleware/hostHeaderValidation.ts',
        '../src/middleware/originValidation.ts'
    ].map(path => readFileSync(join(here, path), 'utf8'));
    expect(sources.join('\n')).toMatch(/from '@modelcontextprotocol\/server\/runtime'/);
    for (const source of sources) {
        expect(source).not.toMatch(/from '@modelcontextprotocol\/server'/);
        expect(source).not.toMatch(/\bpreloadSchemas\s*\(/);
    }
});
