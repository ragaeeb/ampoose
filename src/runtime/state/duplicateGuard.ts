export type DuplicateGuardInput = {
    fetchedCount: number;
    dedupedCount: number;
    allModeWithoutDateFilter: boolean;
};

export type DuplicateGuardOutput = {
    streak: number;
    shouldStop: boolean;
};

export function createDuplicatePageGuard(maxStreak = 5) {
    let streak = 0;

    function evaluate(input: DuplicateGuardInput): DuplicateGuardOutput {
        if (input.allModeWithoutDateFilter && input.fetchedCount > 0 && input.dedupedCount === input.fetchedCount) {
            streak += 1;
            return {
                shouldStop: streak >= maxStreak,
                streak,
            };
        }

        streak = 0;
        return {
            shouldStop: false,
            streak,
        };
    }

    function reset() {
        streak = 0;
    }

    return {
        evaluate,
        reset,
    };
}
