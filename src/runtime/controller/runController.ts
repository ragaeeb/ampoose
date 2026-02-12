import { getMissingRequiredQueries, normalizeGraphqlArtifact } from '@/domain/calibration/artifact';
import {
    buildChunkIndex,
    buildChunkIndexFilename,
    createChunkState,
    flushPostsChunk,
    getChunkSignature,
} from '@/domain/chunk/chunking';
import { buildExportEnvelope, stringifyExportData } from '@/domain/export/envelope';
import { resolvePostId, sanitizeExportPost } from '@/domain/export/sanitize';
import type { GraphqlArtifactV1 } from '@/domain/types';
import { findFirstPostPermalinkLink, preparePostLinkForOpen } from '@/runtime/calibration/postLink';
import {
    buildCollectionRelativeFilename,
    resolveCollectionContext,
    resolveCollectionFolderName,
} from '@/runtime/controller/collectionPath';
import type { ControllerDeps, ControllerState, RuntimePost } from '@/runtime/controller/types';
import { LogStore } from '@/runtime/logs/logStore';
import { createDefaultSettings, FETCH_MODE, type RuntimeSettings } from '@/runtime/settings/types';
import { createDuplicatePageGuard } from '@/runtime/state/duplicateGuard';
import { createInitialProgress } from '@/runtime/state/runState';

function normalizeRunId(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toEpochMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    if (value >= 1_000_000_000_000) {
        return Math.floor(value);
    }
    return Math.floor(value * 1000);
}

type DateFilterWindow = {
    active: boolean;
    cutoffMs: number;
    days: number;
};

function computeDateFilterWindow(settings: RuntimeSettings, nowMs = Date.now()): DateFilterWindow {
    const active = settings.fetchingCountType === FETCH_MODE.BY_DAYS_COUNT || settings.isUsePostsFilter;
    if (!active) {
        return { active: false, cutoffMs: 0, days: 0 };
    }
    const days = Math.max(1, Math.floor(settings.fetchingCountByPostDaysValue));
    return {
        active: true,
        cutoffMs: nowMs - days * DAY_MS,
        days,
    };
}

function dedupeFetchedPosts(fetched: RuntimePost[], seen: Set<string>): { deduped: RuntimePost[]; dedupedCount: number } {
    const deduped = fetched.filter((post) => {
        const id = resolvePostId(post);
        if (!id) {
            return true;
        }
        if (seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
    return { deduped, dedupedCount: fetched.length - deduped.length };
}

function filterPostsForExport(
    posts: RuntimePost[],
    dateFilter: DateFilterWindow,
): { valid: RuntimePost[]; filteredOut: number; boundaryReached: boolean } {
    const resolveCreatedAtMs = (post: RuntimePost, sanitized: ReturnType<typeof sanitizeExportPost>) => {
        return toEpochMs(post.createdAt ?? sanitized?.createdAt);
    };

    const valid = posts.filter((post) => {
        const sanitized = sanitizeExportPost(post);
        if (!sanitized) {
            return false;
        }
        if (!dateFilter.active) {
            return true;
        }
        const createdAtMs = resolveCreatedAtMs(post, sanitized);
        return createdAtMs > 0 && createdAtMs >= dateFilter.cutoffMs;
    });

    const filteredOut = posts.length - valid.length;

    if (!dateFilter.active) {
        return { boundaryReached: false, filteredOut, valid };
    }

    const boundaryReached = posts.some((post) => {
        const sanitized = sanitizeExportPost(post);
        if (!sanitized) {
            return false;
        }
        const createdAtMs = resolveCreatedAtMs(post, sanitized);
        return createdAtMs > 0 && createdAtMs < dateFilter.cutoffMs;
    });

    return { boundaryReached, filteredOut, valid };
}

function isAllModeWithoutDateFilter(settings: RuntimeSettings, dateFilter: DateFilterWindow): boolean {
    return settings.fetchingCountType === FETCH_MODE.ALL && !dateFilter.active;
}

function formatCursor(value: string | null): string {
    return value ?? 'null';
}

function formatCalibrationStatusParts(status: {
    captureCount: number;
    missing: string[];
    capturedNames?: string[];
    unmatchedNames?: string[];
}) {
    return {
        captured: status.capturedNames?.length ? status.capturedNames.join(', ') : 'none',
        missing: status.missing.length ? status.missing.join(', ') : 'none',
        unmatched: status.unmatchedNames?.length ? status.unmatchedNames.join(', ') : 'none',
    };
}

function calibrationStatusSignature(status: {
    captureCount: number;
    missing: string[];
    capturedNames?: string[];
    unmatchedNames?: string[];
}): string {
    const parts = formatCalibrationStatusParts(status);
    return `${status.captureCount}|${parts.captured}|${parts.missing}|${parts.unmatched}`;
}

export class RunController {
    private deps: ControllerDeps;
    private state: ControllerState;
    private logStore = new LogStore();
    private listeners = new Set<(state: ControllerState) => void>();
    private abortController: AbortController | null = null;
    private duplicateGuard = createDuplicatePageGuard(5);
    private seenPostIds = new Set<string>();
    private calibrationAutoTask: Promise<void> | null = null;

    constructor(deps: ControllerDeps) {
        this.deps = deps;
        this.state = {
            calibrationStatus: 'missing',
            chunkState: createChunkState(),
            collectionId: '',
            error: null,
            folderNames: [],
            isOnLimit: false,
            isStopManually: true,
            logs: [],
            open: false,
            posts: [],
            progress: createInitialProgress(),
            runId: 0,
            settings: createDefaultSettings(),
            step: 'START',
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
            chunkState: { ...this.state.chunkState, partFiles: [...this.state.chunkState.partFiles] },
            logs: this.logStore.getAll(),
            posts: [...this.state.posts],
            progress: { ...this.state.progress },
            settings: { ...this.state.settings },
        };
    }

    setOpen(open: boolean) {
        this.state.open = open;
        this.emit();
    }

    updateSettings(patch: Partial<ControllerState['settings']>) {
        this.state.settings = {
            ...this.state.settings,
            ...patch,
        };
        this.emit();
    }

    addLog(type: 'info' | 'warn' | 'error', msg: string, payload?: unknown) {
        this.logStore.add(type, msg, payload);
        this.state.logs = this.logStore.getAll();
        this.emit();
    }

    async loadCalibrationStatus(): Promise<GraphqlArtifactV1 | null> {
        const artifact = await this.deps.loadCalibration();
        this.updateCollectionContext(artifact);
        const missing = getMissingRequiredQueries(artifact);
        this.state.calibrationStatus = missing.length ? 'missing' : 'ready';
        this.emit();
        return artifact;
    }

    async saveCalibrationFromCapture() {
        const status = await this.deps.calibrationClient.getStatus();
        if (status.missing.length > 0) {
            const captured = status.capturedNames?.length ? status.capturedNames.join(', ') : 'none';
            const unmatched = status.unmatchedNames?.length ? status.unmatchedNames.join(', ') : 'none';
            this.addLog(
                'warn',
                `calibration: missing entries ${status.missing.join(', ')} (captured=${captured}, unmatched=${unmatched}, count=${status.captureCount})`,
            );
            return;
        }
        const artifactInput = await this.deps.calibrationClient.buildArtifact();
        const artifact = normalizeGraphqlArtifact(artifactInput);
        if (!artifact) {
            throw new Error('calibration: invalid artifact payload from capture');
        }
        await this.deps.saveCalibration(artifact);
        this.state.calibrationStatus = 'ready';
        this.addLog('info', 'calibration: saved from capture');
        await this.deps.calibrationClient.stopCapture();
        this.emit();
    }

    async startCalibrationCapture() {
        await this.deps.calibrationClient.startCapture();
        this.state.calibrationStatus = 'capturing';
        this.addLog('info', 'calibration: capture enabled');
        this.addLog('info', 'calibration: start');
        this.emit();

        if (!this.calibrationAutoTask) {
            this.calibrationAutoTask = this.runCalibrationAutomation().finally(() => {
                this.calibrationAutoTask = null;
            });
        }
    }

    async stopCalibrationCapture() {
        await this.deps.calibrationClient.stopCapture();
        this.state.calibrationStatus = 'missing';
        this.addLog('info', 'calibration: capture disabled');
        this.emit();
    }

    async start(options: { resume?: boolean; cursor?: string | null } = {}) {
        await this.loadCalibrationStatus();
        if (this.state.calibrationStatus !== 'ready') {
            throw new Error('DocId calibration required before export.');
        }

        if (options.resume) {
            this.prepareResumeRun();
        } else {
            this.prepareNewRun();
        }

        this.addLog('info', 'run: start');

        try {
            await this.runExportLoop(options.cursor ?? null);
            this.state.step = 'DONE';
            this.emit();
        } catch (error) {
            this.state.error = String(error instanceof Error ? error.message : error);
            this.state.step = 'DONE';
            this.addLog('error', this.state.error);
            throw error;
        }
    }

    private prepareNewRun() {
        this.abortController = new AbortController();
        this.duplicateGuard.reset();
        this.seenPostIds.clear();

        this.state.runId = normalizeRunId(this.state.runId + 1);
        this.state.step = 'DOWNLOADING';
        this.state.isStopManually = false;
        this.state.error = null;
        this.state.isOnLimit = false;
        this.state.progress = createInitialProgress();
        this.state.chunkState = createChunkState(this.state.runId);
        this.state.posts = [];
        this.logStore.clear();
    }

    private prepareResumeRun() {
        this.abortController = new AbortController();
        this.state.step = 'DOWNLOADING';
        this.state.isStopManually = false;
        this.state.error = null;
    }

    private async runExportLoop(initialCursor: string | null = null): Promise<void> {
        if (!this.abortController) {
            throw new Error('abort controller missing');
        }

        const shouldStopForDuplicateLoop = (
            fetchedCount: number,
            dedupedCount: number,
            dateFilter: DateFilterWindow,
        ): boolean => {
            const loopCheck = this.duplicateGuard.evaluate({
                allModeWithoutDateFilter: isAllModeWithoutDateFilter(this.state.settings, dateFilter),
                dedupedCount,
                fetchedCount,
            });
            this.state.progress.duplicateStreak = loopCheck.streak;
            if (loopCheck.shouldStop) {
                this.addLog('warn', `stop: duplicate-page loop detected (streak=${loopCheck.streak})`);
                return true;
            }
            return false;
        };

        const appendPageResults = (cursor: string | null, page: { nextCursor: string | null }, valid: RuntimePost[]) => {
            this.state.posts = this.state.posts.concat(valid);
            this.state.progress = {
                cursor,
                duplicateStreak: this.state.progress.duplicateStreak,
                lastBatchCount: valid.length,
                nextCursor: page.nextCursor ?? null,
                pagesFetched: this.state.progress.pagesFetched + 1,
                totalPosts: this.state.progress.totalPosts + valid.length,
            };
            this.addLog(
                'info',
                `page: cursor=${formatCursor(cursor)} next=${formatCursor(page.nextCursor ?? null)} posts=${valid.length}`,
            );
        };

        let cursor: string | null = initialCursor;
        while (!this.state.isStopManually) {
            const dateFilter = computeDateFilterWindow(this.state.settings);

            const page = await this.deps.queryPage({
                cursor,
                settings: this.state.settings,
                signal: this.abortController.signal,
            });

            const fetched = page.posts;
            const { deduped, dedupedCount } = dedupeFetchedPosts(fetched, this.seenPostIds);
            this.addLog('info', `page(raw): fetched=${fetched.length} deduped=${deduped.length}`);

            if (shouldStopForDuplicateLoop(fetched.length, dedupedCount, dateFilter)) {
                break;
            }

            const { valid, filteredOut, boundaryReached } = filterPostsForExport(deduped, dateFilter);
            if (filteredOut > 0) {
                this.addLog(
                    'info',
                    dateFilter.active
                        ? `post: filtered non-text/attachments/out-of-range ${filteredOut}`
                        : `post: filtered non-text/attachments ${filteredOut}`,
                );
            }

            appendPageResults(cursor, page, valid);

            if (boundaryReached) {
                this.addLog('info', `stop: reached date boundary days=${dateFilter.days}`);
                break;
            }

            if (this.applyPostCountLimitIfNeeded()) {
                break;
            }

            await this.flushChunksIfNeeded();

            if (!page.nextCursor) {
                break;
            }
            cursor = page.nextCursor;
        }
    }

    private applyPostCountLimitIfNeeded(): boolean {
        if (this.state.settings.fetchingCountType !== FETCH_MODE.BY_POST_COUNT) {
            return false;
        }
        if (this.state.progress.totalPosts < this.state.settings.fetchingCountByPostCountValue) {
            return false;
        }
        this.state.posts = this.state.posts.slice(0, this.state.settings.fetchingCountByPostCountValue);
        this.state.progress.totalPosts = this.state.posts.length;
        return true;
    }

    private async flushChunksIfNeeded(): Promise<void> {
        if (this.state.settings.fetchingCountType !== FETCH_MODE.ALL || this.state.settings.isUsePostsFilter) {
            return;
        }

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
                'application/json',
                false,
            );
            this.addLog('info', `chunk: downloaded ${targetFilename}`);
        }

        const remainingIds = new Set(next.remaining.map((post) => post.id));
        this.state.posts = this.state.posts.filter((post) => {
            const sanitizedPost = sanitizeExportPost(post);
            return sanitizedPost ? remainingIds.has(sanitizedPost.id) : false;
        });
    }

    stop() {
        this.state.isStopManually = true;
        if (this.abortController) {
            this.abortController.abort();
        }
        this.state.step = 'DONE';
        this.addLog('info', 'run: stopped manually');
    }

    async continue() {
        const cursor = this.state.progress.nextCursor;
        if (!cursor) {
            this.addLog('warn', 'run: no next cursor to continue');
            return;
        }
        this.state.isOnLimit = false;
        this.state.step = 'DOWNLOADING';
        await this.start({ cursor, resume: true });
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
                    'application/json',
                    false,
                );
            }

            const signature = getChunkSignature(this.state.chunkState);
            if (options.auto && this.state.chunkState.lastAutoIndexSignature === signature) {
                this.addLog('info', `download: skip duplicate auto index signature=${signature}`);
                return;
            }

            const index = buildChunkIndex(this.state.chunkState, {
                collectionId: this.state.collectionId,
                folderNames: this.state.folderNames,
                totalPosts: this.state.progress.totalPosts,
            });
            const indexFilename = this.resolveDownloadFilename(buildChunkIndexFilename(this.state.chunkState));
            await this.deps.downloadClient.downloadTextAsFile(
                JSON.stringify(index),
                indexFilename,
                'application/json',
                false,
            );

            if (options.auto) {
                this.state.chunkState.lastAutoIndexSignature = signature;
            }
            this.addLog('info', 'download: emitted chunk index');
            this.emit();
            return;
        }

        const envelope = buildExportEnvelope(this.state.posts);
        const targetFilename = this.resolveDownloadFilename('posts.json');
        await this.deps.downloadClient.downloadTextAsFile(
            stringifyExportData(envelope),
            targetFilename,
            'application/json',
            false,
        );
        this.addLog('info', `download: direct posts.json path=${targetFilename}`);
    }

    async downloadLogsJson() {
        const filename = this.resolveDownloadFilename(`logs-${Date.now()}.json`);
        await this.deps.downloadClient.downloadTextAsFile(
            JSON.stringify(this.logStore.getAll()),
            filename,
            'application/json',
            false,
        );
        this.addLog('info', 'logs: downloaded json');
    }

    private resolveCurrentUrl(): string {
        if (typeof this.deps.getCurrentUrl === 'function') {
            const url = this.deps.getCurrentUrl();
            if (typeof url === 'string' && url.trim()) {
                return url;
            }
        }
        if (typeof window !== 'undefined' && window.location?.href) {
            return window.location.href;
        }
        return '';
    }

    private updateCollectionContext(artifact: GraphqlArtifactV1 | null) {
        const context = resolveCollectionContext({
            artifact,
            currentUrl: this.resolveCurrentUrl(),
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
                this.addLog('warn', 'calibration: capture incomplete; scroll/open post manually');
            }
        } catch (error) {
            this.addLog(
                'error',
                `calibration: automation failed ${String(error instanceof Error ? error.message : error)}`,
            );
        }
    }

    private async autoScrollPage(iterations = 4, pixels = 900, delayMs = 800): Promise<void> {
        this.addLog('info', 'calibration: auto-scroll starting');
        for (let i = 0; i < iterations; i += 1) {
            window.scrollBy({ behavior: 'smooth', left: 0, top: pixels });
            await this.sleep(delayMs);
        }
    }

    private async autoOpenFirstPost(timeoutMs = 5_000, pollMs = 250): Promise<boolean> {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const link = findFirstPostPermalinkLink(document);
            if (link) {
                const href = link.getAttribute('href') ?? link.href;
                this.addLog('info', `calibration: auto-opening post href=${href ?? 'unknown'}`);
                preparePostLinkForOpen(link);
                link.click();
                return true;
            }
            await this.sleep(pollMs);
        }

        this.addLog('warn', 'calibration: auto-open failed; open a post manually');
        return false;
    }

    private async waitForCalibrationCapture(timeoutMs: number, pollMs: number): Promise<boolean> {
        const startedAt = Date.now();
        let lastSignature = '';
        let lastStatus: {
            active: boolean;
            captureCount: number;
            missing: string[];
            capturedNames?: string[];
            unmatchedNames?: string[];
        } | null = null;

        while (Date.now() - startedAt < timeoutMs) {
            const status = await this.deps.calibrationClient.getStatus();
            lastStatus = status;
            const signature = calibrationStatusSignature(status);
            if (signature !== lastSignature) {
                lastSignature = signature;
                const parts = formatCalibrationStatusParts(status);
                this.addLog(
                    'info',
                    `calibration: status count=${status.captureCount} captured=${parts.captured} missing=${parts.missing} unmatched=${parts.unmatched}`,
                );
            }
            if (status.missing.length === 0) {
                this.addLog('info', 'calibration: capture complete');
                return true;
            }
            await this.sleep(pollMs);
        }

        if (lastStatus) {
            const parts = formatCalibrationStatusParts(lastStatus);
            this.addLog(
                'warn',
                `calibration: timeout waiting for capture (count=${lastStatus.captureCount}, captured=${parts.captured}, missing=${parts.missing}, unmatched=${parts.unmatched})`,
            );
        }

        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    }
}
