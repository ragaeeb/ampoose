import { expect, test } from 'bun:test';
import { createDuplicatePageGuard } from '../../src/runtime/state/duplicateGuard';

test('duplicate guard stops after 5 full-duplicate pages', () => {
    const guard = createDuplicatePageGuard(5);

    for (let i = 1; i <= 4; i += 1) {
        const next = guard.evaluate({
            allModeWithoutDateFilter: true,
            dedupedCount: 10,
            fetchedCount: 10,
        });
        expect(next.shouldStop).toBe(false);
        expect(next.streak).toBe(i);
    }

    const stop = guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 10,
        fetchedCount: 10,
    });

    expect(stop.shouldStop).toBe(true);
    expect(stop.streak).toBe(5);

    const reset = guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 2,
        fetchedCount: 8,
    });
    expect(reset.streak).toBe(0);
    expect(reset.shouldStop).toBe(false);
});
