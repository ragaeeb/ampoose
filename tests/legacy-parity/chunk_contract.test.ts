import { expect, test } from "bun:test";
import {
  buildChunkIndex,
  createChunkState,
  flushPostsChunk,
  getChunkSignature
} from "../../src/domain/chunk/chunking";
import type { ExportPost } from "../../src/domain/types";

function createPosts(count: number): ExportPost[] {
  return Array.from({ length: count }).map((_, idx) => ({
    id: `p-${idx}`,
    content: `post ${idx}`
  }));
}

test("chunk contract: filenames and index format", () => {
  const state = createChunkState(21);
  const first = flushPostsChunk(state, createPosts(550), false);

  expect(first.parts.length).toBe(1);
  expect(first.parts[0]?.filename).toBe("posts-run-000021-part-0001.json");
  expect(first.remaining.length).toBe(50);

  const second = flushPostsChunk(first.state, first.remaining, true);
  expect(second.parts[0]?.filename).toBe("posts-run-000021-part-0002.json");

  const index = buildChunkIndex(second.state, {
    collectionId: "collection-1",
    folderNames: ["folder-1"],
    totalPosts: 550,
    createdAt: "2026-02-11T00:00:00.000Z"
  });

  expect(index.format).toBe("ampoose-post-chunks-v1");
  expect(index.partFiles).toEqual([
    "posts-run-000021-part-0001.json",
    "posts-run-000021-part-0002.json"
  ]);
  expect(getChunkSignature(second.state)).toBe("2:posts-run-000021-part-0002.json:550");
});
