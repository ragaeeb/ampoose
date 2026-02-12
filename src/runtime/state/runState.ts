import type { RunProgress, RunStep } from '@/domain/types';

export function createInitialProgress(): RunProgress {
    return {
        cursor: null,
        duplicateStreak: 0,
        lastBatchCount: 0,
        nextCursor: null,
        pagesFetched: 0,
        totalPosts: 0,
    };
}

export function isTerminalStep(step: RunStep): boolean {
    return step === 'DONE';
}
