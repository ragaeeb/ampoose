import { getMissingRequiredQueries, normalizeGraphqlArtifact } from '@/domain/calibration/artifact';
import {
    buildChunkIndex,
    buildChunkIndexFilename,
    createChunkState,
    flushPostsChunk,
    getChunkSignature,
} from '@/domain/chunk/chunking';
import { buildExportEnvelope, stringifyExportData } from '@/domain/export/envelope';
import { normalizePostContent, resolvePostId, sanitizeExportPost } from '@/domain/export/sanitize';
import type { ExportPost, GraphqlArtifactV1 } from '@/domain/types';
import { findFirstPostPermalinkLink, preparePostLinkForOpen } from '@/runtime/calibration/postLink';
import {
    buildCollectionRelativeFilename,
    resolveCollectionContext,
    resolveCollectionFolderName,
} from '@/runtime/controller/collectionPath';
import { shouldSuggestRecalibrationFromError } from '@/runtime/controller/errorHints';
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

type FilterReasonCounts = {
    missingId: number;
    emptyContent: number;
    invalidCreatedAt: number;
    outOfRange: number;
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
): { valid: RuntimePost[]; filteredOut: number; boundaryReached: boolean; reasons: FilterReasonCounts } {
    const reasons: FilterReasonCounts = {
        emptyContent: 0,
        invalidCreatedAt: 0,
        missingId: 0,
        outOfRange: 0,
    };
    const resolveCreatedAtMs = (post: RuntimePost, sanitized: ReturnType<typeof sanitizeExportPost>) => {
        return toEpochMs(post.createdAt ?? sanitized?.createdAt);
    };

    const valid = posts.filter((post) => {
        const id = resolvePostId(post);
        if (!id) {
            reasons.missingId += 1;
            return false;
        }

        const content = normalizePostContent(post.content);
        if (!content) {
            reasons.emptyContent += 1;
            return false;
        }

        const sanitized = sanitizeExportPost(post);
        if (!sanitized) {
            reasons.emptyContent += 1;
            return false;
        }
        if (!dateFilter.active) {
            return true;
        }
        const createdAtMs = resolveCreatedAtMs(post, sanitized);
        if (createdAtMs <= 0) {
            reasons.invalidCreatedAt += 1;
            return false;
        }
        if (createdAtMs < dateFilter.cutoffMs) {
            reasons.outOfRange += 1;
            return false;
        }
        return true;
    });

    const filteredOut = posts.length - valid.length;

    if (!dateFilter.active) {
        return { boundaryReached: false, filteredOut, reasons, valid };
    }

    const boundaryReached = posts.some((post) => {
        const sanitized = sanitizeExportPost(post);
        if (!sanitized) {
            return false;
        }
        const createdAtMs = resolveCreatedAtMs(post, sanitized);
        return createdAtMs > 0 && createdAtMs < dateFilter.cutoffMs;
    });

    return { boundaryReached, filteredOut, reasons, valid };
}

function isAllModeWithoutDateFilter(settings: RuntimeSettings, dateFilter: DateFilterWindow): boolean {
    return settings.fetchingCountType === FETCH_MODE.ALL && !dateFilter.active;
}

function formatCursor(value: string | null): string {
    if (!value) {
        return 'null';
    }
    const head = 20;
    const tail = 16;
    if (value.length <= head + tail + 3) {
        return value;
    }
    return `${value.slice(0, head)}...${value.slice(-tail)}(len=${value.length})`;
}

function formatFetchModeLabel(mode: RuntimeSettings['fetchingCountType']): string {
    if (mode === FETCH_MODE.ALL) {
        return 'ALL';
    }
    if (mode === FETCH_MODE.BY_POST_COUNT) {
        return 'BY_POST_COUNT';
    }
    if (mode === FETCH_MODE.BY_DAYS_COUNT) {
        return 'BY_DAYS_COUNT';
    }
    if (mode === FETCH_MODE.PACK) {
        return 'PACK';
    }
    return String(mode);
}

const LOG_LEVEL_PRIORITY = {
    debug: 3,
    error: 0,
    info: 2,
    warn: 1,
} as const;

type RunStopReason =
    | 'manual-stop'
    | 'duplicate-loop'
    | 'date-boundary'
    | 'post-count-limit'
    | 'no-next-cursor';

type RunLoopResult = {
    reason: RunStopReason;
};

const REDACTED_CONTENT_LIMIT = 96;
const RATE_LIMIT_RANDOM_WAIT_MIN_MS = 500;
const RATE_LIMIT_RANDOM_WAIT_MAX_MS = 5_000;
const RATE_LIMIT_RANDOM_WAIT_STRETCH_MS = 100;
const RATE_LIMIT_RANDOM_WAIT_BASE_MS = 200;
const RATE_LIMIT_RANDOM_WAIT_LOG_THRESHOLD_MS = 1_000;
const RESUME_WARMUP_DUPLICATE_PAGE_LIMIT = 300;
const RESUME_WARMUP_PAGE_LIMIT = 600;

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

function redactContentForDebug(value: string): { content: string; contentLength: number; redacted: boolean } {
    if (value.length <= REDACTED_CONTENT_LIMIT) {
        return { content: value, contentLength: value.length, redacted: false };
    }
    return {
        content: `${value.slice(0, REDACTED_CONTENT_LIMIT)}...`,
        contentLength: value.length,
        redacted: true,
    };
}

function isAbortLikeErrorMessage(message: string): boolean {
    const text = message.toLowerCase();
    return (
        text.includes('calibration action aborted') ||
        text.includes('aborted') ||
        text.includes('aborterror') ||
        text.includes('signal is aborted')
    );
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
    private probeTask: Promise<void> | null = null;
    private probeStopRequested = false;
    private probePageAbortController: AbortController | null = null;
    private rateLimitPacingCount = 0;
    private resumeSeedActive = false;
    private resumeWarmupDuplicatePages = 0;
    private resumeWarmupPages = 0;
    private collectedExportPosts: ExportPost[] = [];
    private firstExportSourcePost: RuntimePost | null = null;

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
        if (!this.shouldLog(type)) {
            return;
        }
        this.logStore.add(type, msg, payload);
        this.state.logs = this.logStore.getAll();
        this.emit();
    }

    private shouldLog(type: 'info' | 'warn' | 'error'): boolean {
        const current = this.state.settings.logLevel;
        return LOG_LEVEL_PRIORITY[type] <= LOG_LEVEL_PRIORITY[current];
    }

    private addDebugLog(msg: string, payload?: unknown) {
        if (this.state.settings.logLevel !== 'debug') {
            return;
        }
        this.addLog('info', `[debug] ${msg}`, payload);
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
        if (this.state.step !== 'DOWNLOADING') {
            this.state.step = 'START';
        }
        this.state.error = null;
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
        if (this.state.step !== 'DOWNLOADING') {
            this.state.step = 'START';
        }
        this.addLog('info', 'calibration: capture disabled');
        this.emit();
    }

    async start(options: { resume?: boolean; cursor?: string | null; seededResume?: boolean } = {}) {
        await this.loadCalibrationStatus();
        if (this.state.calibrationStatus !== 'ready') {
            throw new Error('DocId calibration required before export.');
        }

        if (options.seededResume) {
            this.prepareSeededResumeRun();
        } else if (options.resume) {
            this.prepareResumeRun();
        } else {
            this.prepareNewRun();
        }

        this.addLog(
            'info',
            `run: start collection=${this.state.collectionId || 'unknown'} mode=${formatFetchModeLabel(this.state.settings.fetchingCountType)} useDateFilter=${this.state.settings.isUsePostsFilter} count=${this.state.settings.fetchingCountByPostCountValue} days=${this.state.settings.fetchingCountByPostDaysValue} requestDelayMs=${this.state.settings.requestDelay} fetchLimit=${this.state.settings.fetchLimit} logLevel=${this.state.settings.logLevel} resume=${Boolean(options.resume || options.seededResume)} cursor=${formatCursor(options.cursor ?? null)}`,
        );

        try {
            const result = await this.runExportLoop(options.cursor ?? null);
            this.state.step = 'DONE';
            this.addLog(
                'info',
                `run: done reason=${result.reason} pages=${this.state.progress.pagesFetched} totalPosts=${this.state.progress.totalPosts} next=${formatCursor(this.state.progress.nextCursor)}`,
            );
            if (result.reason !== 'manual-stop' && this.state.chunkState.partFiles.length > 0) {
                await this.downloadJson({ auto: true });
            }
            this.emit();
        } catch (error) {
            const details = String(error instanceof Error ? error.message : error);
            if (this.state.isStopManually && isAbortLikeErrorMessage(details)) {
                this.state.error = null;
                this.state.step = 'DONE';
                this.addLog('info', 'stop: reason=manual-stop');
                this.emit();
                return;
            }

            this.state.error = details;
            this.state.step = 'DONE';
            if (shouldSuggestRecalibrationFromError(this.state.error)) {
                this.addLog(
                    'warn',
                    'run: calibration/session may be stale after GraphQL retry failure; click Recalibrate then Start again',
                );
            }
            this.addLog('error', `run: failed reason=error message=${this.state.error}`);
            throw error;
        }
    }

    private prepareNewRun() {
        this.abortController = new AbortController();
        this.duplicateGuard.reset();
        this.seenPostIds.clear();
        this.rateLimitPacingCount = 0;
        this.resumeSeedActive = false;
        this.resumeWarmupDuplicatePages = 0;
        this.resumeWarmupPages = 0;
        this.collectedExportPosts = [];
        this.firstExportSourcePost = null;

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

    private prepareSeededResumeRun() {
        this.abortController = new AbortController();
        this.duplicateGuard.reset();
        this.rateLimitPacingCount = 0;
        this.resumeWarmupDuplicatePages = 0;
        this.resumeWarmupPages = 0;

        this.state.runId = normalizeRunId(this.state.runId + 1);
        this.state.step = 'DOWNLOADING';
        this.state.isStopManually = false;
        this.state.error = null;
        this.state.isOnLimit = false;
        this.state.progress = createInitialProgress();
        this.state.chunkState = createChunkState(this.state.runId);
        this.state.posts = [];
    }

    private prepareResumeRun() {
        this.abortController = new AbortController();
        this.rateLimitPacingCount = 0;
        this.resumeWarmupPages = 0;
        this.state.step = 'DOWNLOADING';
        this.state.isStopManually = false;
        this.state.error = null;
    }

    private async runExportLoop(initialCursor: string | null = null): Promise<RunLoopResult> {
        if (!this.abortController) {
            throw new Error('abort controller missing');
        }

        const shouldStopForDuplicateLoop = (
            fetchedCount: number,
            dedupedCount: number,
            dateFilter: DateFilterWindow,
        ): RunLoopResult | null => {
            const loopCheck = this.duplicateGuard.evaluate({
                allModeWithoutDateFilter: isAllModeWithoutDateFilter(this.state.settings, dateFilter),
                dedupedCount,
                fetchedCount,
            });
            this.state.progress.duplicateStreak = loopCheck.streak;
            if (loopCheck.shouldStop) {
                this.addLog('warn', `stop: reason=duplicate-loop streak=${loopCheck.streak}`);
                return { reason: 'duplicate-loop' };
            }
            return null;
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
            await this.applyRateLimitPacing('run');

            const page = await this.deps.queryPage({
                cursor,
                settings: this.state.settings,
                signal: this.abortController.signal,
            });

            const fetched = page.posts;
            const { deduped, dedupedCount } = dedupeFetchedPosts(fetched, this.seenPostIds);
            this.addLog('info', `page(raw): fetched=${fetched.length} deduped=${deduped.length}`);
            this.addDebugLog(
                `page(debug): cursor=${formatCursor(cursor)} nextCandidate=${formatCursor(page.nextCursor ?? null)} fetched=${fetched.length} dedupedDropped=${dedupedCount}`,
            );

            if (deduped.length === 0) {
                this.addDebugLog(`page(empty): fetched=${fetched.length} deduped=0`);
            }

            const warmupActive =
                this.resumeSeedActive &&
                this.state.settings.fetchingCountType === FETCH_MODE.ALL &&
                !this.state.settings.isUsePostsFilter &&
                this.state.progress.totalPosts === 0;

            if (warmupActive) {
                this.resumeWarmupPages += 1;
                if (fetched.length > 0 && deduped.length === 0) {
                    this.resumeWarmupDuplicatePages += 1;
                    this.state.progress.duplicateStreak = this.resumeWarmupDuplicatePages;
                    this.addLog(
                        'info',
                        `resume: warmup duplicate page=${this.resumeWarmupDuplicatePages} cursor=${formatCursor(cursor)}`,
                    );
                    if (this.resumeWarmupDuplicatePages >= RESUME_WARMUP_DUPLICATE_PAGE_LIMIT) {
                        this.addLog(
                            'warn',
                            `resume: warmup stopped after ${RESUME_WARMUP_DUPLICATE_PAGE_LIMIT} duplicate pages`,
                        );
                        return { reason: 'duplicate-loop' };
                    }
                }
                if (this.resumeWarmupPages >= RESUME_WARMUP_PAGE_LIMIT) {
                    this.addLog('warn', `resume: warmup stopped after ${RESUME_WARMUP_PAGE_LIMIT} pages with no exportable posts`);
                    return { reason: 'duplicate-loop' };
                }
            } else {
                const duplicateStop = shouldStopForDuplicateLoop(fetched.length, dedupedCount, dateFilter);
                if (duplicateStop) {
                    return duplicateStop;
                }
            }

            const { valid, filteredOut, boundaryReached, reasons } = filterPostsForExport(deduped, dateFilter);
            const exportable = valid
                .map((post) => sanitizeExportPost(post))
                .filter((post): post is NonNullable<typeof post> => Boolean(post));
            if (exportable.length > 0) {
                this.collectedExportPosts.push(...exportable);
            }
            if (!this.firstExportSourcePost && valid[0]) {
                this.firstExportSourcePost = valid[0];
            }
            if (filteredOut > 0) {
                this.addLog(
                    'info',
                    dateFilter.active
                        ? `post: filtered non-text/out-of-range ${filteredOut}`
                        : `post: filtered non-text ${filteredOut}`,
                );
            }
            if (deduped.length > 0 || filteredOut > 0) {
                this.addDebugLog(
                    `page(filter): valid=${valid.length} filtered=${filteredOut} boundaryReached=${boundaryReached} cutoffMs=${dateFilter.cutoffMs}`,
                );
                if (filteredOut > 0) {
                    this.addDebugLog(
                        `page(filter-reasons): missingId=${reasons.missingId} emptyContent=${reasons.emptyContent} invalidCreatedAt=${reasons.invalidCreatedAt} outOfRange=${reasons.outOfRange}`,
                    );
                }
            }

            appendPageResults(cursor, page, valid);
            if (valid.length > 0) {
                this.addDebugLog(
                    `page(window): firstId=${formatCursor(resolvePostId(valid[0]))} lastId=${formatCursor(resolvePostId(valid[valid.length - 1]))} firstCreatedAt=${toEpochMs(valid[0]?.createdAt)} lastCreatedAt=${toEpochMs(valid[valid.length - 1]?.createdAt)}`,
                );
            }

            if (warmupActive && valid.length > 0) {
                this.resumeSeedActive = false;
                this.resumeWarmupDuplicatePages = 0;
                this.resumeWarmupPages = 0;
                this.addLog('info', `resume: warmup complete cursor=${formatCursor(cursor)}`);
            }

            if (boundaryReached) {
                this.addLog('info', `stop: reason=date-boundary days=${dateFilter.days}`);
                return { reason: 'date-boundary' };
            }

            if (this.applyPostCountLimitIfNeeded()) {
                this.addLog(
                    'info',
                    `stop: reason=post-count-limit limit=${this.state.settings.fetchingCountByPostCountValue} total=${this.state.progress.totalPosts}`,
                );
                return { reason: 'post-count-limit' };
            }

            await this.flushChunksIfNeeded();

            if (!page.nextCursor) {
                const lastFetchedId = resolvePostId(fetched[fetched.length - 1]);
                const lastValidId = resolvePostId(valid[valid.length - 1]);
                this.addLog(
                    'info',
                    `stop: reason=no-next-cursor cursor=${formatCursor(cursor)} fetched=${fetched.length} valid=${valid.length} lastFetchedId=${formatCursor(lastFetchedId)} lastValidId=${formatCursor(lastValidId)}`,
                );
                return { reason: 'no-next-cursor' };
            }
            cursor = page.nextCursor;
        }

        this.addLog('info', 'stop: reason=manual-stop');
        return { reason: 'manual-stop' };
    }

    private applyPostCountLimitIfNeeded(): boolean {
        if (this.state.settings.fetchingCountType !== FETCH_MODE.BY_POST_COUNT) {
            return false;
        }
        if (this.state.progress.totalPosts < this.state.settings.fetchingCountByPostCountValue) {
            return false;
        }
        this.state.isOnLimit = true;
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
        this.addLog('info', `run: continue from cursor=${formatCursor(cursor)}`);
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
            const packedEnvelope = this.buildPackedEnvelope();
            const packedFilename = this.resolveDownloadFilename('posts.json');
            await this.deps.downloadClient.downloadTextAsFile(
                stringifyExportData(packedEnvelope),
                packedFilename,
                'application/json',
                false,
            );
            this.addLog('info', `download: packed posts.json path=${packedFilename}`);
            this.emit();
            return;
        }

        const envelope = this.buildPackedEnvelope();
        const targetFilename = this.resolveDownloadFilename('posts.json');
        await this.deps.downloadClient.downloadTextAsFile(
            stringifyExportData(envelope),
            targetFilename,
            'application/json',
            false,
        );
        this.addLog('info', `download: direct posts.json path=${targetFilename}`);
    }

    private buildPackedEnvelope() {
        const sourcePost = this.firstExportSourcePost ?? this.state.posts[0] ?? null;
        const baseEnvelope = sourcePost ? buildExportEnvelope([sourcePost]) : buildExportEnvelope([]);
        if (this.collectedExportPosts.length === 0) {
            return buildExportEnvelope(this.state.posts);
        }
        return {
            ...baseEnvelope,
            posts: [...this.collectedExportPosts],
        };
    }

    async downloadJsonRedacted() {
        const envelope = buildExportEnvelope(this.state.posts);
        const redacted = {
            ...envelope,
            debug: {
                chunked: this.state.chunkState.partFiles.length > 0,
                partFiles: [...this.state.chunkState.partFiles],
                progress: { ...this.state.progress },
                settings: { ...this.state.settings },
                totalFlushed: this.state.chunkState.totalFlushed,
            },
            posts: envelope.posts.map((post) => {
                const next = redactContentForDebug(post.content);
                return {
                    ...post,
                    content: next.content,
                    contentLength: next.contentLength,
                    redacted: next.redacted,
                };
            }),
        };
        const targetFilename = this.resolveDownloadFilename('posts-redacted.json');
        await this.deps.downloadClient.downloadTextAsFile(
            JSON.stringify(redacted, null, 2),
            targetFilename,
            'application/json',
            false,
        );
        if (this.state.chunkState.partFiles.length > 0) {
            this.addLog(
                'warn',
                `download: redacted export includes buffered posts only (chunk parts=${this.state.chunkState.partFiles.length})`,
            );
        }
        this.addLog('info', `download: redacted posts path=${targetFilename}`);
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

    async resumeFromImportedPayloads(payloads: unknown[]) {
        if (this.state.step === 'DOWNLOADING') {
            this.addLog('warn', 'resume: cannot import while a run is active');
            return;
        }

        const imported = this.importKnownPostIds(payloads);
        if (imported.knownIds === 0) {
            this.addLog('warn', 'resume: no valid post ids found in imported payloads');
            return;
        }

        this.resumeSeedActive = true;
        this.resumeWarmupDuplicatePages = 0;
        this.resumeWarmupPages = 0;
        this.addLog(
            'info',
            `resume: imported known post ids=${imported.knownIds} from posts=${imported.posts} payloads=${imported.payloads}`,
        );
        await this.start({ seededResume: true });
    }

    logEarliestVisiblePost() {
        const sanitized = this.state.posts
            .map((post) => sanitizeExportPost(post))
            .filter((post): post is NonNullable<typeof post> => Boolean(post));

        if (sanitized.length === 0) {
            this.addLog('warn', 'probe: earliest-visible-post none');
            return;
        }

        let earliest = sanitized[sanitized.length - 1]!;
        for (const post of sanitized) {
            const candidate = toEpochMs(post.createdAt);
            const current = toEpochMs(earliest.createdAt);
            if (candidate > 0 && (current <= 0 || candidate < current)) {
                earliest = post;
            }
        }

        this.addLog(
            'info',
            `probe: earliest-visible-post id=${earliest.id} createdAt=${toEpochMs(earliest.createdAt)} totalPosts=${sanitized.length}`,
        );
    }

    async probeEarliestAccessiblePost() {
        if (this.probeTask) {
            this.addLog('warn', 'probe: already running');
            return;
        }

        this.probeStopRequested = false;
        this.probeTask = this.runProbeEarliestAccessiblePost().finally(() => {
            this.probePageAbortController = null;
            this.probeTask = null;
            this.probeStopRequested = false;
        });
        await this.probeTask;
    }

    stopProbe() {
        if (!this.probeTask) {
            this.addLog('warn', 'probe: no active probe');
            return;
        }
        this.probeStopRequested = true;
        this.probePageAbortController?.abort();
        this.addLog('info', 'probe: stop requested');
    }

    private async runProbeEarliestAccessiblePost() {
        await this.loadCalibrationStatus();
        if (this.state.calibrationStatus !== 'ready') {
            this.addLog('warn', 'probe: calibration required');
            return;
        }

        this.addLog('info', 'probe: start earliest-accessible-post');
        this.addLog('info', `probe: settings requestDelayMs=${this.state.settings.requestDelay}`);
        if (this.state.settings.requestDelay <= 0) {
            this.addLog('warn', 'probe: requestDelay is 0; probing may increase rate-limit risk');
        }

        const probeGuard = createDuplicatePageGuard(5);
        const probeSeen = new Set<string>();
        let cursor: string | null = null;
        let pages = 0;
        let earliest: { id: string; createdAt: number } | null = null;
        const PAGE_TIMEOUT_MS = 20_000;

        while (true) {
            if (this.probeStopRequested) {
                this.addLog('info', `probe: stop manual pages=${pages}`);
                break;
            }

            const shouldContinue = await this.applyRateLimitPacing('probe');
            if (!shouldContinue) {
                this.addLog('info', `probe: stop manual pages=${pages}`);
                break;
            }

            this.addLog('info', `probe: requesting page=${pages + 1} cursor=${formatCursor(cursor)}`);
            const controller = new AbortController();
            this.probePageAbortController = controller;
            let page: Awaited<ReturnType<typeof this.deps.queryPage>>;
            let timedOut = false;
            const timeoutController = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, PAGE_TIMEOUT_MS);
            try {
                page = await this.deps.queryPage({
                    cursor,
                    settings: this.state.settings,
                    signal: controller.signal,
                });
            } catch (error) {
                const details = String(error instanceof Error ? error.message : error);
                if (this.probeStopRequested) {
                    this.addLog('info', `probe: stop manual pages=${pages}`);
                    break;
                }
                if (timedOut) {
                    this.addLog(
                        'error',
                        `probe: page timeout page=${pages + 1} cursor=${formatCursor(cursor)} timeoutMs=${PAGE_TIMEOUT_MS}`,
                    );
                    return;
                }
                this.addLog(
                    'error',
                    `probe: page request failed page=${pages + 1} cursor=${formatCursor(cursor)} error=${details}`,
                );
                return;
            } finally {
                clearTimeout(timeoutController);
                this.probePageAbortController = null;
            }
            pages += 1;
            this.addLog(
                'info',
                `probe: page result page=${pages} fetched=${page.posts.length} next=${formatCursor(page.nextCursor ?? null)}`,
            );

            const { deduped, dedupedCount } = dedupeFetchedPosts(page.posts, probeSeen);
            const loopCheck = probeGuard.evaluate({
                allModeWithoutDateFilter: true,
                dedupedCount,
                fetchedCount: page.posts.length,
            });
            if (loopCheck.shouldStop) {
                this.addLog('warn', `probe: stop duplicate-loop pages=${pages} streak=${loopCheck.streak}`);
                break;
            }

            let pageSanitized = 0;
            for (const post of deduped) {
                const sanitized = sanitizeExportPost(post);
                if (!sanitized) {
                    continue;
                }
                pageSanitized += 1;
                const createdAt = toEpochMs(post.createdAt ?? sanitized.createdAt);
                if (createdAt <= 0) {
                    continue;
                }
                if (!earliest || createdAt < earliest.createdAt) {
                    earliest = { createdAt, id: sanitized.id };
                }
            }
            this.addLog(
                'info',
                `probe: page processed page=${pages} deduped=${deduped.length} sanitized=${pageSanitized} earliestId=${earliest?.id ?? 'none'}`,
            );

            if (!page.nextCursor) {
                this.addLog('info', `probe: stop no-next-cursor pages=${pages} cursor=${formatCursor(cursor)}`);
                break;
            }
            cursor = page.nextCursor;
        }

        if (!earliest) {
            this.addLog('warn', `probe: earliest-accessible-post none pages=${pages}`);
            return;
        }

        this.addLog(
            'info',
            `probe: earliest-accessible-post id=${earliest.id} createdAt=${earliest.createdAt} pages=${pages}`,
        );
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

    private importKnownPostIds(payloads: unknown[]): { knownIds: number; payloads: number; posts: number } {
        const knownIds = new Set<string>();
        let payloadCount = 0;
        let postCount = 0;

        for (const payload of payloads) {
            const posts = this.extractPostsFromPayload(payload);
            if (posts.length === 0) {
                continue;
            }
            payloadCount += 1;
            for (const post of posts) {
                postCount += 1;
                const sanitized = sanitizeExportPost(post);
                if (!sanitized) {
                    continue;
                }
                knownIds.add(sanitized.id);
            }
        }

        for (const id of knownIds) {
            this.seenPostIds.add(id);
        }

        return {
            knownIds: knownIds.size,
            payloads: payloadCount,
            posts: postCount,
        };
    }

    private extractPostsFromPayload(payload: unknown): unknown[] {
        if (Array.isArray(payload)) {
            return payload;
        }
        if (!payload || typeof payload !== 'object') {
            return [];
        }
        const data = payload as Record<string, unknown>;
        if (Array.isArray(data.posts)) {
            return data.posts;
        }
        return [];
    }

    private async applyRateLimitPacing(context: 'run' | 'probe'): Promise<boolean> {
        if (context === 'probe' && this.probeStopRequested) {
            return false;
        }

        this.rateLimitPacingCount += 1;

        const baseDelayMs = Math.max(0, Math.floor(this.state.settings.requestDelay));
        if (baseDelayMs > 0) {
            this.addLog('info', `rate-limit: base wait=${baseDelayMs}ms reason=configured-requestDelay`);
            if (context === 'probe') {
                const shouldContinue = await this.sleepProbeDelay(baseDelayMs);
                if (!shouldContinue) {
                    return false;
                }
            } else {
                await this.sleep(baseDelayMs);
            }
        }

        const randomWaitRawMs = Math.ceil(
            Math.random() * (this.rateLimitPacingCount * RATE_LIMIT_RANDOM_WAIT_STRETCH_MS + RATE_LIMIT_RANDOM_WAIT_BASE_MS) +
                RATE_LIMIT_RANDOM_WAIT_MIN_MS,
        );
        if (randomWaitRawMs > RATE_LIMIT_RANDOM_WAIT_MAX_MS) {
            this.rateLimitPacingCount = 0;
            return true;
        }
        if (randomWaitRawMs < RATE_LIMIT_RANDOM_WAIT_LOG_THRESHOLD_MS) {
            return true;
        }

        const waitSeconds = (randomWaitRawMs / 1000).toFixed(1);
        this.addLog(
            'warn',
            `rate-limit: pacing wait=${waitSeconds}s reason=avoid account restrictions pageCount=${this.rateLimitPacingCount}`,
        );

        if (context === 'probe') {
            return await this.sleepProbeDelay(randomWaitRawMs);
        }

        await this.sleep(randomWaitRawMs);
        return true;
    }

    private async sleepProbeDelay(ms: number): Promise<boolean> {
        let remaining = Math.max(0, Math.floor(ms));
        while (remaining > 0) {
            if (this.probeStopRequested) {
                return false;
            }
            const chunk = Math.min(remaining, 250);
            await this.sleep(chunk);
            remaining -= chunk;
        }
        return !this.probeStopRequested;
    }
}
