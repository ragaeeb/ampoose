import { buildGraphqlArtifact, getMissingRequiredQueries } from '@/domain/calibration/artifact';
import type { GraphqlArtifactEntry, GraphqlArtifactV1 } from '@/domain/types';

type CaptureMap = Map<string, GraphqlArtifactEntry>;
const SENSITIVE_REQUEST_KEYS = new Set([
    '__a',
    '__comet_req',
    '__csr',
    '__req',
    '__s',
    'fb_dtsg',
    'jazoest',
    'lsd',
    'access_token',
    'session_id',
    '__user',
]);
const VARIABLE_STRIP_KEYS = new Set([
    'cursor',
    'after',
    'before',
    'afterTime',
    'beforeTime',
    'story_id',
    'storyID',
    ...SENSITIVE_REQUEST_KEYS,
]);

function tryParseJson(value: unknown): Record<string, unknown> {
    if (!value) {
        return {};
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    if (typeof value === 'object') {
        return value as Record<string, unknown>;
    }
    return {};
}

function canonicalizeQueryName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
        return '';
    }
    const lowerName = normalized.toLowerCase();

    if (normalized === 'ProfileCometTimelineFeedRefetchQuery') {
        return 'ProfileCometTimelineFeedRefetchQuery';
    }
    if (normalized === 'CometSinglePostDialogContentQuery') {
        return 'CometSinglePostDialogContentQuery';
    }

    if (/profilecomettimelinefeedrefetchquery/i.test(normalized)) {
        return 'ProfileCometTimelineFeedRefetchQuery';
    }
    if (
        /timeline.*refetchquery/i.test(normalized) ||
        (lowerName.includes('timeline') && lowerName.includes('refetch'))
    ) {
        return 'ProfileCometTimelineFeedRefetchQuery';
    }
    if (/cometsinglepostdialogcontentquery/i.test(normalized)) {
        return 'CometSinglePostDialogContentQuery';
    }
    if (
        /singlepost/i.test(normalized) ||
        lowerName.includes('focusedstory') ||
        lowerName.includes('storydialogcontent') ||
        (lowerName.includes('storyview') && lowerName.includes('ufi'))
    ) {
        return 'CometSinglePostDialogContentQuery';
    }

    return '';
}

function stringBodyToSearchParams(body: string): URLSearchParams[] {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return bodyToSearchParams(tryParseJson(trimmed));
    }
    return [new URLSearchParams(body)];
}

function formDataToSearchParams(body: FormData): URLSearchParams[] {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
        params.append(key, String(value));
    }
    return [params];
}

function objectBodyToSearchParams(body: Record<string, unknown>): URLSearchParams[] {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
        params.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return [params];
}

function bodyToSearchParams(body: unknown): URLSearchParams[] {
    if (!body) {
        return [];
    }
    if (body instanceof URLSearchParams) {
        return [body];
    }
    if (typeof body === 'string') {
        return stringBodyToSearchParams(body);
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
        return formDataToSearchParams(body);
    }
    if (typeof body === 'object') {
        return objectBodyToSearchParams(body as Record<string, unknown>);
    }
    return [];
}

function urlToSearchParams(url: string): URLSearchParams[] {
    try {
        const parsed = new URL(url, window.location.origin);
        if (!parsed.search) {
            return [];
        }
        return [parsed.searchParams];
    } catch {
        return [];
    }
}

type RequestLike = {
    url: string;
    clone: () => { text: () => Promise<string> };
};

function isRequestLike(value: unknown): value is RequestLike {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<RequestLike>;
    return typeof candidate.url === 'string' && typeof candidate.clone === 'function';
}

async function readRequestBody(request: RequestLike): Promise<unknown> {
    try {
        // Clone so we never consume the body used by the actual network request.
        const text = await request.clone().text();
        return text;
    } catch {
        return undefined;
    }
}

function sanitizeVariables(value: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (VARIABLE_STRIP_KEYS.has(key) || key.startsWith('__spin_')) {
            continue;
        }
        output[key] = entry;
    }
    return output;
}

function extractRequestParams(params: URLSearchParams): Record<string, string> {
    const skipKeys = new Set([
        'variables',
        'doc_id',
        'docID',
        'docId',
        'fb_api_req_friendly_name',
        'operationName',
        'query_name',
        'queryName',
        'queries',
    ]);

    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        if (skipKeys.has(key)) {
            continue;
        }
        if (SENSITIVE_REQUEST_KEYS.has(key) || key.startsWith('__spin_')) {
            continue;
        }
        if (!value) {
            continue;
        }
        out[key] = value;
    }
    return out;
}

function captureDocIdEntry(
    capture: CaptureMap,
    name: string,
    docId: string,
    variables: Record<string, unknown>,
    unmatched: Map<string, string>,
    requestParams: Record<string, string>,
) {
    const canonicalName = canonicalizeQueryName(name);
    if (!docId) {
        return;
    }
    if (!canonicalName) {
        if (name) {
            unmatched.set(name, docId);
        }
        return;
    }
    const entry: GraphqlArtifactEntry = {
        docId,
        preload: [],
        queryName: canonicalName,
        variables: sanitizeVariables(variables),
    };
    if (Object.keys(requestParams).length > 0) {
        entry.requestParams = requestParams;
    }
    capture.set(canonicalName, entry);
}

function getParamsQueryName(params: URLSearchParams): string {
    return (
        params.get('fb_api_req_friendly_name') ??
        params.get('operationName') ??
        params.get('query_name') ??
        params.get('queryName') ??
        ''
    );
}

function getParamsDocId(params: URLSearchParams): string {
    return params.get('doc_id') ?? params.get('docID') ?? params.get('docId') ?? '';
}

type BatchedQueryEntry = { name: string; docId: string; variables: Record<string, unknown> };

function extractBatchedQueries(params: URLSearchParams): BatchedQueryEntry[] {
    const queries = params.get('queries');
    if (!queries) {
        return [];
    }

    const parsed = tryParseJson(queries);
    const out: BatchedQueryEntry[] = [];

    for (const value of Object.values(parsed)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const record = value as Record<string, unknown>;
        const name =
            (typeof record.queryName === 'string' && record.queryName) ||
            (typeof record.fb_api_req_friendly_name === 'string' && record.fb_api_req_friendly_name) ||
            (typeof record.operationName === 'string' && record.operationName) ||
            '';
        const docId =
            (typeof record.doc_id === 'string' && record.doc_id) ||
            (typeof record.docID === 'string' && record.docID) ||
            (typeof record.docId === 'string' && record.docId) ||
            '';
        out.push({ docId, name, variables: tryParseJson(record.variables ?? '{}') });
    }

    return out;
}

function captureFromParams(capture: CaptureMap, unmatched: Map<string, string>, params: URLSearchParams) {
    const name = getParamsQueryName(params);
    const docId = getParamsDocId(params);
    const requestParams = extractRequestParams(params);
    captureDocIdEntry(
        capture,
        name,
        docId,
        tryParseJson(params.get('variables') ?? '{}'),
        unmatched,
        requestParams,
    );

    const batched = extractBatchedQueries(params);
    if (batched.length === 0) {
        return;
    }

    for (const query of batched) {
        captureDocIdEntry(capture, query.name, query.docId, query.variables, unmatched, requestParams);
    }
}

export function createCalibrationCaptureManager() {
    const capture: CaptureMap = new Map();
    const unmatched = new Map<string, string>();
    let active = false;
    let installed = false;

    function handleRequest(url: unknown, body: unknown) {
        if (!active) {
            return;
        }
        if (typeof url !== 'string') {
            return;
        }

        const lowerUrl = url.toLowerCase();
        if (!lowerUrl.includes('graphql')) {
            return;
        }

        const params = [...urlToSearchParams(url), ...bodyToSearchParams(body)];
        for (const entry of params) {
            captureFromParams(capture, unmatched, entry);
        }
    }

    function installHooks() {
        if (installed) {
            return;
        }
        installed = true;

        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
            (window as any).fetch = function patchedFetch(
                input: RequestInfo | URL,
                init?: RequestInit,
            ): Promise<Response> {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

                // Covers common POST forms: fetch(url, { body: ... }).
                handleRequest(url, init?.body);

                // Some callers pass a Request object directly; capture that body too.
                // Fire-and-forget by design: capture is best-effort and should not block network flow.
                if (!init?.body && isRequestLike(input)) {
                    void readRequestBody(input).then((body) => {
                        if (!body) {
                            return;
                        }
                        handleRequest(url, body);
                    });
                }

                return originalFetch.call(this, input, init);
            };
        }

        const xhrProto = XMLHttpRequest?.prototype as (XMLHttpRequest & { __ampooseUrl?: string }) | undefined;
        if (xhrProto) {
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;

            xhrProto.open = function patchedOpen(method: string, url: string | URL, ...rest: unknown[]) {
                (this as XMLHttpRequest & { __ampooseUrl?: string }).__ampooseUrl = String(url);
                return (originalOpen as (...args: unknown[]) => unknown).call(this, method, url, ...rest);
            };

            xhrProto.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
                const url = (this as XMLHttpRequest & { __ampooseUrl?: string }).__ampooseUrl;
                handleRequest(url, body ?? undefined);
                return (originalSend as (...args: unknown[]) => unknown).call(this, body);
            };
        }
    }

    function start() {
        installHooks();
        active = true;
        capture.clear();
        unmatched.clear();
    }

    function stop() {
        active = false;
    }

    function getCaptureCount(): number {
        return capture.size;
    }

    function getMissing(): string[] {
        return getMissingRequiredQueries(buildArtifact());
    }

    function getCapturedNames(): string[] {
        return [...capture.keys()];
    }

    function getUnmatchedNames(): string[] {
        return [...unmatched.keys()];
    }

    function buildArtifact(): GraphqlArtifactV1 {
        const entries: Record<string, GraphqlArtifactEntry> = {};
        capture.forEach((value, key) => {
            const entry: GraphqlArtifactEntry = {
                docId: value.docId,
                preload: [],
                queryName: value.queryName,
                variables: value.variables,
            };
            if (value.requestParams) {
                entry.requestParams = value.requestParams;
            }
            entries[key] = entry;
        });
        return buildGraphqlArtifact(entries);
    }

    return {
        buildArtifact,
        getCaptureCount,
        getCapturedNames,
        getMissing,
        getUnmatchedNames,
        isActive: () => active,
        start,
        stop,
    };
}
