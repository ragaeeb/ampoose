export type FetchingCountType = 0 | 1 | 2 | 3;

export const FETCH_MODE = {
  ALL: 0,
  BY_POST_COUNT: 1,
  BY_DAYS_COUNT: 2,
  PACK: 3
} as const;

export type RuntimeSettings = {
  fetchingCountType: FetchingCountType;
  fetchingCountByPostCountValue: number;
  fetchingCountByPostDaysValue: number;
  isUsePostsFilter: boolean;
  requestDelay: number;
  fetchLimit: number;
};

export function createDefaultSettings(): RuntimeSettings {
  return {
    fetchingCountType: FETCH_MODE.ALL,
    fetchingCountByPostCountValue: 10,
    fetchingCountByPostDaysValue: 3,
    isUsePostsFilter: false,
    requestDelay: 0,
    fetchLimit: Number.MAX_SAFE_INTEGER
  };
}
