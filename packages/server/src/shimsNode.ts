/**
 * Node.js runtime shims for server package
 *
 * This file is selected via package.json export conditions when running in Node.js.
 */
import type { jsonSchemaValidator } from '@modelcontextprotocol/core-internal/server-runtime';

/**
 * Loads the Node default only when JSON Schema validation is actually needed.
 * Keeping the dynamic import inside this condition-selected shim prevents the
 * normal server/runtime and Node-adapter discovery paths from evaluating AJV.
 *
 * @internal
 */
export async function loadDefaultJsonSchemaValidator(): Promise<jsonSchemaValidator> {
    const { AjvJsonSchemaValidator } = await import('@modelcontextprotocol/core-internal/validators/ajv');
    return new AjvJsonSchemaValidator();
}

export { default as process } from 'node:process';
