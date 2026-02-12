import { describe, expect, it } from 'bun:test';
import { createInitialProgress, isTerminalStep } from '@/runtime/state/runState';

describe('runState', () => {
    it('should create an initial progress structure', () => {
        expect(createInitialProgress()).toEqual({
            cursor: null,
            duplicateStreak: 0,
            lastBatchCount: 0,
            nextCursor: null,
            pagesFetched: 0,
            totalPosts: 0,
        });
    });

    it('should mark DONE as a terminal step', () => {
        expect(isTerminalStep('DONE')).toBe(true);
        expect(isTerminalStep('START')).toBe(false);
        expect(isTerminalStep('DOWNLOADING')).toBe(false);
    });
});

