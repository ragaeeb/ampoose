import { getMissingRequiredQueries } from "@/domain/calibration/artifact";
import {
  buildChunkIndex,
  buildChunkIndexFilename,
  createChunkState,
  flushPostsChunk,
  getChunkSignature
} from "@/domain/chunk/chunking";
import { buildExportEnvelope, stringifyExportData } from "@/domain/export/envelope";
import { sanitizeExportPost } from "@/domain/export/sanitize";
import { createDuplicatePageGuard } from "@/runtime/state/duplicateGuard";
import { createInitialProgress } from "@/runtime/state/runState";
import { FETCH_MODE, createDefaultSettings } from "@/runtime/settings/types";
import { LogStore } from "@/runtime/logs/logStore";
import type { ControllerDeps, ControllerState, RuntimePost } from "@/runtime/controller/types";
import { findFirstPostPermalinkLink, preparePostLinkForOpen } from "@/runtime/calibration/postLink";
import type { GraphqlArtifactV1 } from "@/domain/types";
import {
  buildCollectionRelativeFilename,
  resolveCollectionContext,
  resolveCollectionFolderName
} from "@/runtime/controller/collectionPath";

function normalizeRunId(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export class RunController {
  private deps: ControllerDeps;
  private state: ControllerState;
  private logStore = new LogStore();
  private listeners = new Set<(state: ControllerState) => void>();
  private abortController: AbortController | null = null;
  private duplicateGuard = createDuplicatePageGuard(5);
  private calibrationAutoTask: Promise<void> | null = null;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.state = {
      step: "START",
      open: false,
      error: null,
      settings: createDefaultSettings(),
      progress: createInitialProgress(),
      isOnLimit: false,
      isStopManually: true,
      posts: [],
      chunkState: createChunkState(),
      logs: [],
      runId: 0,
      calibrationStatus: "missing",
      collectionId: "",
      folderNames: []
    };
  }

  subscribe(listener: (state: ControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): ControllerState {
    return {
      ...this.state,
      settings: { ...this.state.settings },
      progress: { ...this.state.progress },
      posts: [...this.state.posts],
      chunkState: { ...this.state.chunkState, partFiles: [...this.state.chunkState.partFiles] },
      logs: this.logStore.getAll()
    };
  }

  setOpen(open: boolean) {
    this.state.open = open;
    this.emit();
  }

  updateSettings(patch: Partial<ControllerState["settings"]>) {
    this.state.settings = {
      ...this.state.settings,
      ...patch
    };
    this.emit();
  }

  addLog(type: "info" | "warn" | "error", msg: string, payload?: unknown) {
    this.logStore.add(type, msg, payload);
    this.state.logs = this.logStore.getAll();
    this.emit();
  }

  async loadCalibrationStatus(): Promise<GraphqlArtifactV1 | null> {
    const artifact = await this.deps.loadCalibration();
    this.updateCollectionContext(artifact);
    const missing = getMissingRequiredQueries(artifact);
    this.state.calibrationStatus = missing.length ? "missing" : "ready";
    this.emit();
    return artifact;
  }

  async saveCalibrationFromCapture() {
    const status = await this.deps.calibrationClient.getStatus();
    if (status.missing.length > 0) {
      const captured = status.capturedNames?.length ? status.capturedNames.join(", ") : "none";
      const unmatched = status.unmatchedNames?.length ? status.unmatchedNames.join(", ") : "none";
      this.addLog(
        "warn",
        `calibration: missing entries ${status.missing.join(", ")} (captured=${captured}, unmatched=${unmatched}, count=${status.captureCount})`
      );
      return;
    }
    const artifact = await this.deps.calibrationClient.buildArtifact();
    await this.deps.saveCalibration(artifact as any);
    this.state.calibrationStatus = "ready";
    this.addLog("info", "calibration: saved from capture");
    await this.deps.calibrationClient.stopCapture();
    this.emit();
  }

  async startCalibrationCapture() {
    await this.deps.calibrationClient.startCapture();
    this.state.calibrationStatus = "capturing";
    this.addLog("info", "calibration: capture enabled");
    this.addLog("info", "calibration: start");
    this.emit();

    if (!this.calibrationAutoTask) {
      this.calibrationAutoTask = this.runCalibrationAutomation().finally(() => {
        this.calibrationAutoTask = null;
      });
    }
  }

  async stopCalibrationCapture() {
    await this.deps.calibrationClient.stopCapture();
    this.state.calibrationStatus = "missing";
    this.addLog("info", "calibration: capture disabled");
    this.emit();
  }

  async start() {
    await this.loadCalibrationStatus();
    if (this.state.calibrationStatus !== "ready") {
      throw new Error("DocId calibration required before export.");
    }

    this.abortController = new AbortController();
    this.duplicateGuard.reset();

    this.state.runId = normalizeRunId(this.state.runId + 1);
    this.state.step = "DOWNLOADING";
    this.state.isStopManually = false;
    this.state.error = null;
    this.state.isOnLimit = false;
    this.state.progress = createInitialProgress();
    this.state.chunkState = createChunkState(this.state.runId);
    this.state.posts = [];
    this.logStore.clear();

    this.addLog("info", "run: start");

    try {
      let cursor: string | null = null;
      while (!this.state.isStopManually) {
        const page = await this.deps.queryPage({
          cursor,
          settings: this.state.settings,
          signal: this.abortController.signal
        });

        const fetched = page.posts;
        const existing = new Set(this.state.posts.map((post) => String(post.post_id ?? "")).filter(Boolean));
        const deduped = fetched.filter((post) => {
          const id = String(post.post_id ?? "");
          if (!id) return true;
          if (existing.has(id)) return false;
          existing.add(id);
          return true;
        });
        this.addLog("info", `page(raw): fetched=${fetched.length} deduped=${deduped.length}`);

        const loopCheck = this.duplicateGuard.evaluate({
          fetchedCount: fetched.length,
          dedupedCount: fetched.length - deduped.length,
          allModeWithoutDateFilter:
            this.state.settings.fetchingCountType === FETCH_MODE.ALL && !this.state.settings.isUsePostsFilter
        });

        this.state.progress.duplicateStreak = loopCheck.streak;
        if (loopCheck.shouldStop) {
          this.addLog("warn", `stop: duplicate-page loop detected (streak=${loopCheck.streak})`);
          break;
        }

        const valid = deduped.filter((post) => Boolean(sanitizeExportPost(post)));
        const filteredOut = deduped.length - valid.length;
        if (filteredOut > 0) {
          this.addLog("info", `post: filtered non-text/attachments ${filteredOut}`);
        }
        this.state.posts = this.state.posts.concat(valid);

        this.state.progress = {
          cursor,
          nextCursor: page.nextCursor ?? null,
          lastBatchCount: valid.length,
          pagesFetched: this.state.progress.pagesFetched + 1,
          duplicateStreak: loopCheck.streak,
          totalPosts: this.state.progress.totalPosts + valid.length
        };

        this.addLog("info", `page: cursor=${cursor ?? "null"} next=${page.nextCursor ?? "null"} posts=${valid.length}`);

        if (this.state.settings.fetchingCountType === FETCH_MODE.BY_POST_COUNT) {
          if (this.state.progress.totalPosts >= this.state.settings.fetchingCountByPostCountValue) {
            this.state.posts = this.state.posts.slice(0, this.state.settings.fetchingCountByPostCountValue);
            this.state.progress.totalPosts = this.state.posts.length;
            break;
          }
        }

        if (this.state.settings.fetchingCountType === FETCH_MODE.ALL && !this.state.settings.isUsePostsFilter) {
          const sanitized = this.state.posts
            .map((post) => sanitizeExportPost(post))
            .filter((post): post is NonNullable<typeof post> => Boolean(post));

          const next = flushPostsChunk(this.state.chunkState, sanitized, false);
          this.state.chunkState = next.state;

          for (const part of next.parts) {
            const targetFilename = this.resolveDownloadFilename(part.filename);
            await this.deps.downloadClient.downloadTextAsFile(
              JSON.stringify(part.posts),
              targetFilename,
              "application/json",
              false
            );
            this.addLog("info", `chunk: downloaded ${targetFilename}`);
          }

          const remainingIds = new Set(next.remaining.map((post) => post.id));
          this.state.posts = this.state.posts.filter((post) => {
            const sanitizedPost = sanitizeExportPost(post);
            return sanitizedPost ? remainingIds.has(sanitizedPost.id) : false;
          });
        }

        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      this.state.step = "DONE";
      this.emit();
    } catch (error) {
      this.state.error = String(error instanceof Error ? error.message : error);
      this.state.step = "DONE";
      this.addLog("error", this.state.error);
      throw error;
    }
  }

  stop() {
    this.state.isStopManually = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.state.step = "DONE";
    this.addLog("info", "run: stopped manually");
  }

  async continue() {
    if (!this.state.progress.nextCursor) {
      this.addLog("warn", "run: no next cursor to continue");
      return;
    }
    this.state.isOnLimit = false;
    this.state.step = "DOWNLOADING";
    await this.start();
  }

  async downloadJson(options: { auto?: boolean } = {}) {
    if (this.state.chunkState.partFiles.length > 0) {
      const sanitized = this.state.posts
        .map((post) => sanitizeExportPost(post))
        .filter((post): post is NonNullable<typeof post> => Boolean(post));

      const force = flushPostsChunk(this.state.chunkState, sanitized, true);
      this.state.chunkState = force.state;
      for (const part of force.parts) {
        const targetFilename = this.resolveDownloadFilename(part.filename);
        await this.deps.downloadClient.downloadTextAsFile(
          JSON.stringify(part.posts),
          targetFilename,
          "application/json",
          false
        );
      }

      const signature = getChunkSignature(this.state.chunkState);
      if (options.auto && this.state.chunkState.lastAutoIndexSignature === signature) {
        this.addLog("info", `download: skip duplicate auto index signature=${signature}`);
        return;
      }

      const index = buildChunkIndex(this.state.chunkState, {
        collectionId: this.state.collectionId,
        folderNames: this.state.folderNames,
        totalPosts: this.state.progress.totalPosts
      });
      const indexFilename = this.resolveDownloadFilename(buildChunkIndexFilename(this.state.chunkState));
      await this.deps.downloadClient.downloadTextAsFile(
        JSON.stringify(index),
        indexFilename,
        "application/json",
        false
      );

      if (options.auto) this.state.chunkState.lastAutoIndexSignature = signature;
      this.addLog("info", "download: emitted chunk index");
      this.emit();
      return;
    }

    const envelope = buildExportEnvelope(this.state.posts);
    const targetFilename = this.resolveDownloadFilename("posts.json");
    await this.deps.downloadClient.downloadTextAsFile(
      stringifyExportData(envelope),
      targetFilename,
      "application/json",
      false
    );
    this.addLog("info", `download: direct posts.json path=${targetFilename}`);
  }

  async downloadLogsJson() {
    const filename = this.resolveDownloadFilename(`logs-${Date.now()}.json`);
    await this.deps.downloadClient.downloadTextAsFile(
      JSON.stringify(this.logStore.getAll()),
      filename,
      "application/json",
      false
    );
    this.addLog("info", "logs: downloaded json");
  }

  private resolveCurrentUrl(): string {
    if (typeof this.deps.getCurrentUrl === "function") {
      const url = this.deps.getCurrentUrl();
      if (typeof url === "string" && url.trim()) return url;
    }
    if (typeof window !== "undefined" && window.location?.href) return window.location.href;
    return "";
  }

  private updateCollectionContext(artifact: GraphqlArtifactV1 | null) {
    const context = resolveCollectionContext({
      currentUrl: this.resolveCurrentUrl(),
      artifact
    });
    this.state.collectionId = context.collectionId;
    this.state.folderNames = context.folderNames;
  }

  private resolveDownloadFilename(filename: string): string {
    const folder = resolveCollectionFolderName(this.state.folderNames, this.state.collectionId);
    return buildCollectionRelativeFilename(folder, filename);
  }

  private emit() {
    this.state.logs = this.logStore.getAll();
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  private async runCalibrationAutomation(): Promise<void> {
    try {
      await this.autoScrollPage();
      await this.autoOpenFirstPost();
      const complete = await this.waitForCalibrationCapture(12_000, 400);
      if (complete) {
        await this.saveCalibrationFromCapture();
      } else {
        this.addLog("warn", "calibration: capture incomplete; scroll/open post manually");
      }
    } catch (error) {
      this.addLog("error", `calibration: automation failed ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private async autoScrollPage(iterations = 4, pixels = 900, delayMs = 800): Promise<void> {
    this.addLog("info", "calibration: auto-scroll starting");
    for (let i = 0; i < iterations; i += 1) {
      window.scrollBy({ top: pixels, left: 0, behavior: "smooth" });
      await this.sleep(delayMs);
    }
  }

  private async autoOpenFirstPost(timeoutMs = 5_000, pollMs = 250): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const link = findFirstPostPermalinkLink(document);
      if (link) {
        const href = link.getAttribute("href") ?? link.href;
        this.addLog("info", `calibration: auto-opening post href=${href ?? "unknown"}`);
        preparePostLinkForOpen(link);
        link.click();
        return true;
      }
      await this.sleep(pollMs);
    }

    this.addLog("warn", "calibration: auto-open failed; open a post manually");
    return false;
  }

  private async waitForCalibrationCapture(timeoutMs: number, pollMs: number): Promise<boolean> {
    const startedAt = Date.now();
    let lastSignature = "";
    let lastStatus:
      | {
          active: boolean;
          captureCount: number;
          missing: string[];
          capturedNames?: string[];
          unmatchedNames?: string[];
        }
      | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      const status = await this.deps.calibrationClient.getStatus();
      lastStatus = status;
      const captured = status.capturedNames?.length ? status.capturedNames.join(", ") : "none";
      const missing = status.missing.length ? status.missing.join(", ") : "none";
      const unmatched = status.unmatchedNames?.length ? status.unmatchedNames.join(", ") : "none";
      const signature = `${status.captureCount}|${captured}|${missing}|${unmatched}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        this.addLog(
          "info",
          `calibration: status count=${status.captureCount} captured=${captured} missing=${missing} unmatched=${unmatched}`
        );
      }
      if (status.missing.length === 0) {
        this.addLog("info", "calibration: capture complete");
        return true;
      }
      await this.sleep(pollMs);
    }

    if (lastStatus) {
      const captured = lastStatus.capturedNames?.length ? lastStatus.capturedNames.join(", ") : "none";
      const missing = lastStatus.missing.length ? lastStatus.missing.join(", ") : "none";
      const unmatched = lastStatus.unmatchedNames?.length ? lastStatus.unmatchedNames.join(", ") : "none";
      this.addLog(
        "warn",
        `calibration: timeout waiting for capture (count=${lastStatus.captureCount}, captured=${captured}, missing=${missing}, unmatched=${unmatched})`
      );
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
