import { expect, it } from 'bun:test';
import { createDuplicatePageGuard } from '@/runtime/state/duplicateGuard';

it('should stop after 5 full-duplicate pages', () => {
    const guard = createDuplicatePageGuard(5);

    for (let i = 1; i <= 4; i += 1) {
        const next = guard.evaluate({
            allModeWithoutDateFilter: true,
            dedupedCount: 10,
            fetchedCount: 10,
        });
        expect(next.shouldStop).toBeFalse();
        expect(next.streak).toBe(i);
    }

    const stop = guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 10,
        fetchedCount: 10,
    });

    expect(stop.shouldStop).toBeTrue();
    expect(stop.streak).toBe(5);

    const reset = guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 2,
        fetchedCount: 8,
    });
    expect(reset.streak).toBe(0);
    expect(reset.shouldStop).toBeFalse();
});

it('should reset streak when reset() is called', () => {
    const guard = createDuplicatePageGuard(5);
    guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 3,
        fetchedCount: 3,
    });
    guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 3,
        fetchedCount: 3,
    });

    guard.reset();

    const next = guard.evaluate({
        allModeWithoutDateFilter: true,
        dedupedCount: 3,
        fetchedCount: 3,
    });
    expect(next.streak).toBe(1);
    expect(next.shouldStop).toBeFalse();
});
