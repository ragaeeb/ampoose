import { expect, test } from "bun:test";
import {
  buildResumeTransferPayload,
  normalizeImportedResumePayload
} from "../../src/domain/resume/transfer";

test("resume payload contract", () => {
  const payload = buildResumeTransferPayload(
    "collection-1",
    {
      a: { cursor: "cursor-a", timestamp: 10 },
      b: { cursor: "   ", timestamp: 20 }
    },
    99
  );

  expect(payload).toEqual({
    format: "ampoose-resume-cursors-v1",
    version: 1,
    collectionId: "collection-1",
    exportedAt: 99,
    resumeCursors: {
      a: { cursor: "cursor-a", timestamp: 10 }
    }
  });

  expect(normalizeImportedResumePayload(payload)).toEqual(payload);
  expect(normalizeImportedResumePayload({ format: "x" })).toBeNull();
});
