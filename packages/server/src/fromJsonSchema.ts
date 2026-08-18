import type { JsonSchemaType, jsonSchemaValidator, StandardSchemaWithJSON } from '@modelcontextprotocol/core-internal/server-runtime';
import {
    fromJsonSchema as coreFromJsonSchema,
    fromJsonSchemaWithValidatorFactory
} from '@modelcontextprotocol/core-internal/server-runtime';
import { loadDefaultJsonSchemaValidator } from '@modelcontextprotocol/server/_shims';

let _defaultValidator: Promise<jsonSchemaValidator> | undefined;

export function fromJsonSchema<T = unknown>(schema: JsonSchemaType, validator?: jsonSchemaValidator): StandardSchemaWithJSON<T, T> {
    if (validator !== undefined) return coreFromJsonSchema<T>(schema, validator);
    return fromJsonSchemaWithValidatorFactory<T>(schema, retainProvider => {
        if (!retainProvider) return loadDefaultJsonSchemaValidator();
        return (_defaultValidator ??= loadDefaultJsonSchemaValidator());
    });
}
