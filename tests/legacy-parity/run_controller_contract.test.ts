import { expect, test } from "bun:test";
import { RunController } from "../../src/runtime/controller/runController";
import { buildGraphqlArtifact } from "../../src/domain/calibration/artifact";
import { FETCH_MODE } from "../../src/runtime/settings/types";

function createReadyArtifact() {
  return buildGraphqlArtifact({
    ProfileCometTimelineFeedRefetchQuery: {
      queryName: "ProfileCometTimelineFeedRefetchQuery",
      docId: "123",
      variables: { scale: 2, id: "100026362418520" },
      preload: []
    },
    CometSinglePostDialogContentQuery: {
      queryName: "CometSinglePostDialogContentQuery",
      docId: "456",
      variables: { scale: 2 },
      preload: []
    }
  });
}

function createCalibrationClient() {
  return {
    startCapture: async () => {},
    stopCapture: async () => {},
    getStatus: async () => ({ active: false, captureCount: 0, missing: [] as string[] }),
    buildArtifact: async () => createReadyArtifact()
  };
}

test("run controller blocks start when calibration missing", async () => {
  const controller = new RunController({
    queryPage: async () => ({ posts: [], nextCursor: null }),
    downloadClient: {
      downloadTextAsFile: async () => ({ ok: true })
    },
    loadCalibration: async () => null,
    saveCalibration: async () => {},
    calibrationClient: createCalibrationClient(),
    getCurrentUrl: () => "https://www.facebook.com/some.username"
  });

  await expect(controller.start()).rejects.toThrow("DocId calibration required before export.");
});

test("run controller exports direct posts.json when no chunk output", async () => {
  const downloads: Array<{ filename: string; data: string }> = [];

  const controller = new RunController({
    queryPage: async ({ cursor }) => {
      if (cursor) return { posts: [], nextCursor: null };
      return {
        posts: [
          {
            post_id: "p1",
            content: "hello",
            author: { id: "a1", name: "Author", profile: "https://www.facebook.com/author" }
          }
        ],
        nextCursor: null
      };
    },
    downloadClient: {
      downloadTextAsFile: async (data, filename) => {
        downloads.push({ filename, data });
        return { ok: true };
      }
    },
    loadCalibration: async () => createReadyArtifact(),
    saveCalibration: async () => {},
    calibrationClient: createCalibrationClient(),
    getCurrentUrl: () => "https://www.facebook.com/some.username"
  });

  controller.updateSettings({ fetchingCountType: FETCH_MODE.BY_POST_COUNT, fetchingCountByPostCountValue: 10 });
  await controller.start();
  await controller.downloadJson();

  expect(downloads.length).toBe(1);
  expect(downloads[0]?.filename).toBe("some.username/posts.json");
  const payload = JSON.parse(downloads[0]!.data) as { posts: Array<{ id: string; content: string }> };
  expect(payload.posts).toEqual([{ id: "p1", content: "hello" }]);
});

test("run controller emits chunk files and index in ALL mode", async () => {
  const downloads = new Map<string, string>();

  const controller = new RunController({
    queryPage: async ({ cursor }) => {
      if (cursor) return { posts: [], nextCursor: null };
      return {
        posts: Array.from({ length: 550 }).map((_, i) => ({ post_id: `p-${i}`, content: `post ${i}` })),
        nextCursor: null
      };
    },
    downloadClient: {
      downloadTextAsFile: async (data, filename) => {
        downloads.set(filename, data);
        return { ok: true };
      }
    },
    loadCalibration: async () => createReadyArtifact(),
    saveCalibration: async () => {},
    calibrationClient: createCalibrationClient(),
    getCurrentUrl: () => "https://www.facebook.com/permalink.php?story_fbid=1"
  });

  controller.updateSettings({ fetchingCountType: FETCH_MODE.ALL, isUsePostsFilter: false });
  await controller.start();
  await controller.downloadJson();

  expect(downloads.has("100026362418520/posts-run-000001-part-0001.json")).toBe(true);
  expect(downloads.has("100026362418520/posts-run-000001-part-0002.json")).toBe(true);
  expect(downloads.has("100026362418520/posts-run-000001-index.json")).toBe(true);
  const indexPayload = JSON.parse(downloads.get("100026362418520/posts-run-000001-index.json") ?? "{}") as {
    collectionId: string;
    folderNames: string[];
  };
  expect(indexPayload.collectionId).toBe("100026362418520");
  expect(indexPayload.folderNames).toEqual(["100026362418520"]);
});

test("run controller logs capture diagnostics when calibration entries are missing", async () => {
  const controller = new RunController({
    queryPage: async () => ({ posts: [], nextCursor: null }),
    downloadClient: {
      downloadTextAsFile: async () => ({ ok: true })
    },
    loadCalibration: async () => null,
    saveCalibration: async () => {},
    calibrationClient: {
      startCapture: async () => {},
      stopCapture: async () => {},
      getStatus: async () => ({
        active: true,
        captureCount: 1,
        missing: ["CometSinglePostDialogContentQuery"],
        capturedNames: ["ProfileCometTimelineFeedRefetchQuery"]
      }),
      buildArtifact: async () => createReadyArtifact()
    },
    getCurrentUrl: () => "https://www.facebook.com/some.username"
  });

  await controller.saveCalibrationFromCapture();

  const warnings = controller
    .getState()
    .logs.filter((entry) => entry.type === "warn")
    .map((entry) => entry.msg);
  expect(
    warnings.some(
      (msg) =>
        msg.includes("missing entries CometSinglePostDialogContentQuery") &&
        msg.includes("captured=ProfileCometTimelineFeedRefetchQuery") &&
        msg.includes("count=1")
    )
  ).toBe(true);
});

test("run controller downloads logs file in collection folder", async () => {
  const downloads: string[] = [];
  const controller = new RunController({
    queryPage: async () => ({ posts: [], nextCursor: null }),
    downloadClient: {
      downloadTextAsFile: async (_data, filename) => {
        downloads.push(filename);
        return { ok: true };
      }
    },
    loadCalibration: async () => createReadyArtifact(),
    saveCalibration: async () => {},
    calibrationClient: createCalibrationClient(),
    getCurrentUrl: () => "https://www.facebook.com/some.username"
  });

  await controller.loadCalibrationStatus();
  controller.addLog("info", "run: start");
  await controller.downloadLogsJson();

  expect(downloads.length).toBe(1);
  expect(downloads[0]!.startsWith("some.username/logs-")).toBe(true);
  expect(downloads[0]!.endsWith(".json")).toBe(true);
});
