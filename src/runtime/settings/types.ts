export type FetchingCountType = 0 | 1 | 2 | 3;
export type RuntimeLogLevel = 'error' | 'warn' | 'info' | 'debug';

export const FETCH_MODE = {
    ALL: 0,
    BY_DAYS_COUNT: 2,
    BY_POST_COUNT: 1,
    PACK: 3,
} as const;

export type RuntimeSettings = {
    fetchingCountType: FetchingCountType;
    fetchingCountByPostCountValue: number;
    fetchingCountByPostDaysValue: number;
    isUsePostsFilter: boolean;
    requestDelay: number;
    fetchLimit: number;
    logLevel: RuntimeLogLevel;
};

export function createDefaultSettings(): RuntimeSettings {
    return {
        fetchingCountByPostCountValue: 10,
        fetchingCountByPostDaysValue: 3,
        fetchingCountType: FETCH_MODE.ALL,
        fetchLimit: Number.MAX_SAFE_INTEGER,
        isUsePostsFilter: false,
        logLevel: 'info',
        requestDelay: 250,
    };
}
