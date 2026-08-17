import { DefaultJsonSchemaValidator } from '@modelcontextprotocol/client/_shims';
import type { JsonSchemaType, jsonSchemaValidator, StandardSchemaWithJSON } from '@modelcontextprotocol/core-internal/client-runtime';
import { fromJsonSchema as coreFromJsonSchema } from '@modelcontextprotocol/core-internal/client-runtime';

let _defaultValidator: jsonSchemaValidator | undefined;

export function fromJsonSchema<T = unknown>(schema: JsonSchemaType, validator?: jsonSchemaValidator): StandardSchemaWithJSON<T, T> {
    return coreFromJsonSchema<T>(schema, validator ?? (_defaultValidator ??= new DefaultJsonSchemaValidator()));
}
