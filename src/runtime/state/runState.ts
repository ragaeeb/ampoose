import type { RunProgress, RunStep } from "@/domain/types";

export function createInitialProgress(): RunProgress {
  return {
    cursor: null,
    nextCursor: null,
    lastBatchCount: 0,
    pagesFetched: 0,
    duplicateStreak: 0,
    totalPosts: 0
  };
}

export function isTerminalStep(step: RunStep): boolean {
  return step === "DONE";
}
