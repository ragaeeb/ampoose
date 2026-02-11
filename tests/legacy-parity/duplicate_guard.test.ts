import { expect, test } from "bun:test";
import { createDuplicatePageGuard } from "../../src/runtime/state/duplicateGuard";

test("duplicate guard stops after 5 full-duplicate pages", () => {
  const guard = createDuplicatePageGuard(5);

  for (let i = 1; i <= 4; i += 1) {
    const next = guard.evaluate({
      fetchedCount: 10,
      dedupedCount: 10,
      allModeWithoutDateFilter: true
    });
    expect(next.shouldStop).toBe(false);
    expect(next.streak).toBe(i);
  }

  const stop = guard.evaluate({
    fetchedCount: 10,
    dedupedCount: 10,
    allModeWithoutDateFilter: true
  });

  expect(stop.shouldStop).toBe(true);
  expect(stop.streak).toBe(5);

  const reset = guard.evaluate({
    fetchedCount: 8,
    dedupedCount: 2,
    allModeWithoutDateFilter: true
  });
  expect(reset.streak).toBe(0);
  expect(reset.shouldStop).toBe(false);
});
