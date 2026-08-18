import type { StandardSchemaV1, StandardSchemaWithJSON } from '../util/standardSchema';
import type { JsonSchemaType, JsonSchemaValidator, jsonSchemaValidator, JsonSchemaValidatorResult } from './types';

/** @internal Validator source used by runtime-specific lazy wrappers. */
export type JsonSchemaValidatorFactory = (retainProvider: boolean) => jsonSchemaValidator | Promise<jsonSchemaValidator>;

type RawJsonSchemaRegistration = {
    schema: JsonSchemaType;
    validatorFactory: JsonSchemaValidatorFactory;
    compiled?: JsonSchemaValidator<unknown> | Promise<JsonSchemaValidator<unknown>>;
};

// This is registration metadata, not a derived-object cache: the wrapper must
// retain its raw schema and validator source to implement Standard Schema
// validation. Compiled validators remain local to the wrapper's first generic
// validation, or to the McpServer instance that consumes this metadata.
const rawJsonSchemaRegistrations = new WeakMap<StandardSchemaWithJSON, RawJsonSchemaRegistration>();

function standardResult<T>(result: JsonSchemaValidatorResult<T>): StandardSchemaV1.Result<T> {
    return result.valid ? { value: result.data } : { issues: [{ message: result.errorMessage }] };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T>)?.then === 'function';
}

function compileRegistration<T>(
    registration: RawJsonSchemaRegistration,
    retainProvider: boolean
): JsonSchemaValidator<T> | Promise<JsonSchemaValidator<T>> {
    if (retainProvider && registration.compiled !== undefined) {
        return registration.compiled as JsonSchemaValidator<T> | Promise<JsonSchemaValidator<T>>;
    }
    const provider = registration.validatorFactory(retainProvider);
    const compiled = isPromiseLike(provider)
        ? provider.then(resolved => resolved.getValidator<T>(registration.schema))
        : provider.getValidator<T>(registration.schema);
    if (retainProvider) registration.compiled = compiled as JsonSchemaValidator<unknown> | Promise<JsonSchemaValidator<unknown>>;
    return compiled;
}

/**
 * Wrap a raw JSON Schema object as a {@linkcode StandardSchemaWithJSON} so it can be
 * passed to `registerTool` / `registerPrompt`. Use this when you already have JSON
 * Schema (e.g. from TypeBox, or hand-written) and want to register it without going
 * through a Standard Schema library.
 *
 * The raw schema is returned directly by the Standard JSON Schema converters.
 * The validator provider is not asked to compile it until the wrapper is
 * actually validated. Server cache policy controls whether that compiled
 * validator is retained or discarded after a tool call.
 *
 * The callback arguments will be typed `unknown` (raw JSON Schema has no TypeScript
 * types attached). Cast at the call site, or use the generic `fromJsonSchema<MyType>(...)`.
 *
 * @param schema - A JSON Schema object describing the expected shape
 * @param validator - A validator provider. When importing `fromJsonSchema` from
 *   `@modelcontextprotocol/server` or `@modelcontextprotocol/client`, a runtime-appropriate
 *   default is provided automatically (AJV on Node.js, CfWorker on edge runtimes).
 *
 * @example
 * ```ts source="./fromJsonSchema.examples.ts#fromJsonSchema_basicUsage"
 * const inputSchema = fromJsonSchema<{ name: string }>(
 *     { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
 *     validator
 * );
 * // Use with server.registerTool('greet', { inputSchema }, handler)
 * ```
 */
export function fromJsonSchema<T = unknown>(schema: JsonSchemaType, validator: jsonSchemaValidator): StandardSchemaWithJSON<T, T> {
    return fromJsonSchemaWithValidatorFactory<T>(schema, () => validator);
}

/**
 * Runtime-specific lazy form of {@linkcode fromJsonSchema}. The factory is not
 * invoked by registration or JSON Schema export. `retainProvider=false` lets a
 * cache-disabled server request a request-scoped provider that it can discard.
 *
 * @internal
 */
export function fromJsonSchemaWithValidatorFactory<T = unknown>(
    schema: JsonSchemaType,
    validatorFactory: JsonSchemaValidatorFactory
): StandardSchemaWithJSON<T, T> {
    const registration: RawJsonSchemaRegistration = { schema, validatorFactory };
    const standardSchema: StandardSchemaWithJSON<T, T> = {
        '~standard': {
            version: 1,
            vendor: 'mcp',
            jsonSchema: {
                input: () => schema as Record<string, unknown>,
                output: () => schema as Record<string, unknown>
            },
            validate: (data: unknown): StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>> => {
                const compiled = compileRegistration<T>(registration, true);
                return isPromiseLike(compiled) ? compiled.then(check => standardResult(check(data))) : standardResult(compiled(data));
            }
        }
    };
    rawJsonSchemaRegistrations.set(standardSchema, registration);
    return standardSchema;
}

/**
 * Compile the validator associated with a `fromJsonSchema()` wrapper. Returns
 * `undefined` for every other Standard Schema implementation.
 *
 * The caller owns retention of the returned function. Passing
 * `retainProvider=false` also asks a runtime default factory not to retain its
 * validator provider, allowing cache-disabled servers to discard all derived
 * validation objects after the request.
 *
 * @internal
 */
export async function compileFromJsonSchemaValidator<T = unknown>(
    standardSchema: StandardSchemaWithJSON,
    retainProvider: boolean
): Promise<JsonSchemaValidator<T> | undefined> {
    const registration = rawJsonSchemaRegistrations.get(standardSchema);
    if (registration === undefined) return undefined;
    return compileRegistration<T>(registration, retainProvider);
}
