import { expect, it } from 'bun:test';
import { LOG_PAYLOAD_LIMIT, LOG_STORE_LIMIT, LogStore, normalizeLogPayload } from '../../src/runtime/logs/logStore';

it('should enforce log store size cap', () => {
    const store = new LogStore();
    for (let i = 0; i < LOG_STORE_LIMIT + 25; i += 1) {
        store.add('info', `log-${i}`);
    }

    const logs = store.getAll();
    expect(logs.length).toBe(LOG_STORE_LIMIT);
    expect(logs[0]?.msg).toBe('log-25');
});

it('should truncate long strings and errors', () => {
    const long = 'x'.repeat(LOG_PAYLOAD_LIMIT + 100);
    const normalized = normalizeLogPayload(long);
    expect(typeof normalized).toBe('string');
    expect(String(normalized).length).toBe(LOG_PAYLOAD_LIMIT);

    const err = new Error(`boom${'x'.repeat(6000)}`);
    const errPayload = normalizeLogPayload(err) as Record<string, unknown>;
    expect(typeof errPayload.message).toBe('string');
    expect(String(errPayload.message).length).toBeLessThanOrEqual(LOG_PAYLOAD_LIMIT);
});
