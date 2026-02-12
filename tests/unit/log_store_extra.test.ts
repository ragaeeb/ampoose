import { describe, expect, it } from 'bun:test';
import { LogStore, normalizeLogPayload, LOG_PAYLOAD_LIMIT } from '@/runtime/logs/logStore';

describe('normalizeLogPayload', () => {
    it('should keep primitive payloads as-is', () => {
        expect(normalizeLogPayload(123)).toBe(123);
        expect(normalizeLogPayload(true)).toBe(true);
        expect(normalizeLogPayload(false)).toBe(false);
    });

    it('should serialize circular objects with a marker', () => {
        const payload: any = { a: 1 };
        payload.self = payload;

        const normalized = normalizeLogPayload(payload) as any;
        expect(normalized.a).toBe(1);
        expect(normalized.self).toBe('[Circular]');
    });

    it('should truncate oversized serialized payloads into a preview', () => {
        const payload = { text: 'x'.repeat(LOG_PAYLOAD_LIMIT * 2) };
        const normalized = normalizeLogPayload(payload) as any;
        expect(normalized.truncated).toBe(true);
        expect(typeof normalized.preview).toBe('string');
        expect(normalized.preview.length).toBe(LOG_PAYLOAD_LIMIT);
    });

    it('should return an unserializable marker when JSON serialization throws', () => {
        const payload = { value: BigInt(5) };
        const normalized = normalizeLogPayload(payload) as any;
        expect(normalized.truncated).toBe(true);
        expect(normalized.preview).toBe('[payload unserializable]');
    });
});

describe('LogStore', () => {
    it('should clear logs', () => {
        const store = new LogStore();
        store.add('info', 'hello');
        expect(store.getAll().length).toBe(1);
        store.clear();
        expect(store.getAll().length).toBe(0);
    });
});

