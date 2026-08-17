import { RELATED_TASK_META_KEY } from './constants';
import type { JSONRPCErrorResponse, JSONRPCNotification, JSONRPCRequest, JSONRPCResultResponse } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    for (const key in value) {
        if (Object.hasOwn(value, key) && !allowed.has(key)) return false;
    }
    return true;
}

function isRequestId(value: unknown): value is number | string {
    return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isRequestMeta(value: unknown): boolean {
    if (!isObject(value)) return false;
    const progressToken = value.progressToken;
    if (progressToken !== undefined && !isRequestId(progressToken)) return false;
    const relatedTask = value[RELATED_TASK_META_KEY];
    return relatedTask === undefined || (isObject(relatedTask) && typeof relatedTask.taskId === 'string');
}

function isParams(value: unknown): boolean {
    return value === undefined || (isObject(value) && (value._meta === undefined || isRequestMeta(value._meta)));
}

const REQUEST_KEYS = new Set(['jsonrpc', 'id', 'method', 'params']);
const NOTIFICATION_KEYS = new Set(['jsonrpc', 'method', 'params']);
const RESULT_KEYS = new Set(['jsonrpc', 'id', 'result']);
const ERROR_KEYS = new Set(['jsonrpc', 'id', 'error']);

/** Strict JSON-RPC request classifier without constructing the public schema catalog. */
export function isJSONRPCRequestMessage(value: unknown): value is JSONRPCRequest {
    return (
        isObject(value) &&
        hasOnlyKeys(value, REQUEST_KEYS) &&
        value.jsonrpc === '2.0' &&
        isRequestId(value.id) &&
        typeof value.method === 'string' &&
        isParams(value.params)
    );
}

/** Strict JSON-RPC notification classifier without constructing the public schema catalog. */
export function isJSONRPCNotificationMessage(value: unknown): value is JSONRPCNotification {
    return (
        isObject(value) &&
        hasOnlyKeys(value, NOTIFICATION_KEYS) &&
        value.jsonrpc === '2.0' &&
        typeof value.method === 'string' &&
        isParams(value.params)
    );
}

/** Strict JSON-RPC success-response classifier without constructing the public schema catalog. */
export function isJSONRPCResultResponseMessage(value: unknown): value is JSONRPCResultResponse {
    return (
        isObject(value) &&
        hasOnlyKeys(value, RESULT_KEYS) &&
        value.jsonrpc === '2.0' &&
        isRequestId(value.id) &&
        isObject(value.result) &&
        (value.result._meta === undefined || isObject(value.result._meta))
    );
}

/** Strict JSON-RPC error-response classifier without constructing the public schema catalog. */
export function isJSONRPCErrorResponseMessage(value: unknown): value is JSONRPCErrorResponse {
    if (!isObject(value) || !hasOnlyKeys(value, ERROR_KEYS) || value.jsonrpc !== '2.0') return false;
    if (value.id !== undefined && !isRequestId(value.id)) return false;
    return isObject(value.error) && Number.isSafeInteger(value.error.code) && typeof value.error.message === 'string';
}

/** Selects one strict JSON-RPC classifier from the message's discriminating fields. */
export function jsonRPCMessageKind(value: unknown): 'request' | 'notification' | 'result' | 'error' | undefined {
    if (!isObject(value)) return undefined;
    if ('method' in value) {
        if ('id' in value) return isJSONRPCRequestMessage(value) ? 'request' : undefined;
        return isJSONRPCNotificationMessage(value) ? 'notification' : undefined;
    }
    if ('result' in value) return isJSONRPCResultResponseMessage(value) ? 'result' : undefined;
    if ('error' in value) return isJSONRPCErrorResponseMessage(value) ? 'error' : undefined;
    return undefined;
}
