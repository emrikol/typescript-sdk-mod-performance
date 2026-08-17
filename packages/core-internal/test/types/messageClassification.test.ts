import { describe, expect, it } from 'vitest';

import {
    isJSONRPCErrorResponseMessage,
    isJSONRPCNotificationMessage,
    isJSONRPCRequestMessage,
    isJSONRPCResultResponseMessage,
    jsonRPCMessageKind
} from '../../src/types/messageClassification';
import { isJSONRPCErrorResponse, isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResultResponse } from '../../src/types/guards';

function generatedValues(count: number): unknown[] {
    let state = 0x5eed_2026;
    const random = (): number => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
    const scalar = (): unknown => {
        const values = [undefined, null, false, true, '', '2.0', 'tools/call', -1, 0, 1, 1.5, Number.MAX_SAFE_INTEGER + 1];
        return values[Math.floor(random() * values.length)];
    };
    const value = (depth: number): unknown => {
        if (depth === 0 || random() < 0.35) return scalar();
        if (random() < 0.25) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth - 1));
        const keys = [
            'jsonrpc',
            'id',
            'method',
            'params',
            'result',
            'error',
            'code',
            'message',
            'data',
            '_meta',
            'progressToken',
            'io.modelcontextprotocol/related-task',
            'taskId',
            'extra'
        ];
        const object: Record<string, unknown> = {};
        for (const key of keys) {
            if (random() < 0.28) object[key] = value(depth - 1);
        }
        return object;
    };
    return Array.from({ length: count }, () => value(3));
}

describe('lightweight JSON-RPC classifiers', () => {
    it('matches the authoritative public Zod guards', () => {
        const values = generatedValues(10_000);
        for (const value of values) {
            expect(isJSONRPCRequestMessage(value)).toBe(isJSONRPCRequest(value));
            expect(isJSONRPCNotificationMessage(value)).toBe(isJSONRPCNotification(value));
            expect(isJSONRPCResultResponseMessage(value)).toBe(isJSONRPCResultResponse(value));
            expect(isJSONRPCErrorResponseMessage(value)).toBe(isJSONRPCErrorResponse(value));
            const expected = isJSONRPCResultResponse(value)
                ? 'result'
                : isJSONRPCErrorResponse(value)
                  ? 'error'
                  : isJSONRPCRequest(value)
                    ? 'request'
                    : isJSONRPCNotification(value)
                      ? 'notification'
                      : undefined;
            expect(jsonRPCMessageKind(value)).toBe(expected);
        }
    });
});
