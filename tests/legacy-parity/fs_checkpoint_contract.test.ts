import { expect, test } from "bun:test";
import { buildFsSessionCheckpoint } from "../../src/domain/fs/checkpoint";

test("fs checkpoint contract", () => {
  const checkpoint = buildFsSessionCheckpoint({
    collectionId: "collection-1",
    folderNames: ["folder-1"],
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:10:00.000Z",
    profileUrl: "https://www.facebook.com/author",
    author: { id: "a1", name: "Author" },
    totalPosts: 120,
    nextCursor: "cursor-123",
    status: "running",
    lastError: null
  });

  expect(checkpoint).toEqual({
    format: "ampoose-fs-session-v1",
    version: 1,
    collectionId: "collection-1",
    folderNames: ["folder-1"],
    createdAt: "2026-02-11T00:00:00.000Z",
    updatedAt: "2026-02-11T00:10:00.000Z",
    profileUrl: "https://www.facebook.com/author",
    author: { id: "a1", name: "Author" },
    totalPosts: 120,
    nextCursor: "cursor-123",
    status: "running",
    lastError: null
  });
});
