import { getMissingRequiredQueries } from '@/domain/calibration/artifact';
import type { GraphqlArtifactV1 } from '@/domain/types';

export type GraphqlRequestInput = {
    queryName: string;
    variables?: Record<string, unknown>;
    endpoint?: string;
    responseMode?: 'single' | 'all';
};

export type GraphqlFetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type GraphqlClientDeps = {
    loadArtifact: () => Promise<GraphqlArtifactV1 | null>;
    fetchImpl?: GraphqlFetchImpl;
};

function toPreview(value: string, max = 220): string {
    const text = value.trim();
    if (!text) {
        return '';
    }
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function stripJsonPrefix(value: string): string {
    let output = value.trim();

    // Facebook endpoints may prepend this anti-JSON-hijacking prefix.
    if (output.startsWith('for (;;);')) {
        output = output.slice('for (;;);'.length).trimStart();
    }

    // Some responses include this common non-JSON prefix.
    if (output.startsWith(")]}'")) {
        output = output.slice(4);
        if (output.startsWith('\n')) {
            output = output.slice(1);
        }
        output = output.trimStart();
    }

    return output;
}

function parseJsonLines(value: string): unknown[] {
    const lines = value
        .split(/\r?\n/g)
        .map((line) => stripJsonPrefix(line).trim())
        .filter((line) => line.length > 0);
    if (lines.length <= 1) {
        return [];
    }

    const payloads: unknown[] = [];
    for (const line of lines) {
        try {
            payloads.push(JSON.parse(line));
        } catch {
            return [];
        }
    }
    return payloads;
}

function pickJsonPayload(payloads: unknown[]): unknown {
    for (const payload of payloads) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            continue;
        }
        const record = payload as Record<string, unknown>;
        if ('data' in record || 'errors' in record) {
            return payload;
        }
    }
    return payloads[0];
}

function parseCookie(name: string): string {
    try {
        if (typeof document === 'undefined') {
            return '';
        }
        const target = `${name}=`;
        const items = document.cookie.split(';');
        for (const item of items) {
            const value = item.trim();
            if (!value.startsWith(target)) {
                continue;
            }
            return decodeURIComponent(value.slice(target.length));
        }
    } catch {
        // no-op
    }
    return '';
}

function readInputValue(name: string): string {
    try {
        if (typeof document === 'undefined') {
            return '';
        }
        const escapedName =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                ? CSS.escape(name)
                : name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const node = document.querySelector<HTMLInputElement>(`input[name='${escapedName}']`);
        return (node?.value ?? '').trim();
    } catch {
        return '';
    }
}

function computeJazoest(fbDtsg: string): string {
    if (!fbDtsg) {
        return '';
    }
    let acc = '2';
    for (let i = 0; i < fbDtsg.length; i += 1) {
        acc += String(fbDtsg.charCodeAt(i));
    }
    return acc;
}

function resolveDefaultEndpoint(): string {
    try {
        if (typeof window !== 'undefined' && /(^|\.)facebook\.com$/i.test(window.location.hostname)) {
            return `${window.location.origin}/api/graphql/`;
        }
    } catch {
        // no-op
    }
    return '/api/graphql/';
}

function resolveEndpointCandidates(inputEndpoint?: string): string[] {
    if (inputEndpoint) {
        return [inputEndpoint];
    }

    const candidates: string[] = [];
    const push = (value: string) => {
        if (!value) {
            return;
        }
        if (!candidates.includes(value)) {
            candidates.push(value);
        }
    };

    push('/api/graphql/');
    push('/graphql/query/');
    push(resolveDefaultEndpoint());

    try {
        if (typeof window !== 'undefined') {
            const origin = window.location.origin;
            push(`${origin}/api/graphql/`);
            push(`${origin}/graphql/query/`);

            if (/^https:\/\/web\.facebook\.com$/i.test(origin)) {
                push('https://www.facebook.com/api/graphql/');
                push('https://www.facebook.com/graphql/query/');
            }
        }
    } catch {
        // no-op
    }

    return candidates;
}

function createBaseAmbientRequestParams(): Record<string, string> {
    return {
        fb_api_caller_class: 'RelayModern',
        server_timestamps: 'true',
    };
}

function appendUserParams(params: Record<string, string>) {
    const cUser = parseCookie('c_user');
    if (cUser) {
        params.av = cUser;
        params.__user = cUser;
    }
}

function appendDtsgParams(params: Record<string, string>) {
    const fbDtsg = readInputValue('fb_dtsg');
    if (fbDtsg) {
        params.fb_dtsg = fbDtsg;
        const jazoest = computeJazoest(fbDtsg);
        if (jazoest) {
            params.jazoest = jazoest;
        }
    }

    const lsd = readInputValue('lsd');
    if (lsd) {
        params.lsd = lsd;
    }
}

function appendSpinParams(params: Record<string, string>) {
    try {
        if (typeof window !== 'undefined') {
            const spinB = (window as unknown as Record<string, unknown>).__spin_b;
            const spinR = (window as unknown as Record<string, unknown>).__spin_r;
            const spinT = (window as unknown as Record<string, unknown>).__spin_t;
            if (typeof spinB === 'string' && spinB) {
                params.__spin_b = spinB;
            }
            if ((typeof spinR === 'string' || typeof spinR === 'number') && spinR !== '') {
                params.__spin_r = String(spinR);
            }
            if ((typeof spinT === 'string' || typeof spinT === 'number') && spinT !== '') {
                params.__spin_t = String(spinT);
            }
            params.dpr = String(window.devicePixelRatio || 1);
        }
    } catch {
        // no-op
    }
}

function getAmbientRequestParams(): Record<string, string> {
    const params = createBaseAmbientRequestParams();
    appendUserParams(params);
    appendDtsgParams(params);
    appendSpinParams(params);
    return params;
}

async function parseGraphqlResponseBody(
    response: Response,
    responseMode: 'single' | 'all' = 'single',
): Promise<unknown> {
    const text = await response.text();
    const normalized = stripJsonPrefix(text);
    if (!normalized) {
        throw new Error(`GraphQL response body empty (status=${response.status})`);
    }

    try {
        return JSON.parse(normalized);
    } catch (error) {
        const payloads = parseJsonLines(normalized);
        if (payloads.length > 0) {
            if (responseMode === 'all') {
                return payloads;
            }
            return pickJsonPayload(payloads);
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `GraphQL response parse failed (status=${response.status}): ${message}. preview="${toPreview(normalized)}"`,
        );
    }
}

export function createGraphqlClient(deps: GraphqlClientDeps) {
    const fetchImpl = deps.fetchImpl ?? fetch;

    function requireCalibrationEntry(input: GraphqlRequestInput) {
        return deps.loadArtifact().then((artifact) => {
            const missing = getMissingRequiredQueries(artifact);
            if (!artifact || missing.length > 0) {
                throw new Error(`Calibration missing required entries: ${missing.join(', ')}`);
            }

            const entry = artifact.entries[input.queryName];
            if (!entry) {
                throw new Error(`Calibration missing query: ${input.queryName}`);
            }

            return { artifact, entry };
        });
    }

    async function requestEndpoint(
        endpoint: string,
        queryName: string,
        body: URLSearchParams,
        responseMode: 'single' | 'all',
    ): Promise<unknown> {
        const response = await fetchImpl(endpoint, {
            body,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-FB-Friendly-Name': queryName,
            },
            method: 'POST',
        });

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            const preview = toPreview(stripJsonPrefix(bodyText));
            throw new Error(`GraphQL request failed: ${response.status}${preview ? ` preview="${preview}"` : ''}`);
        }

        return await parseGraphqlResponseBody(response, responseMode);
    }

    function mergeVariables(
        captured: Record<string, unknown> | undefined,
        override: Record<string, unknown> | undefined,
    ): Record<string, unknown> {
        return {
            ...(captured ?? {}),
            ...(override ?? {}),
        };
    }

    function compactParams(input: Record<string, string>): Record<string, string> {
        const clean: Record<string, string> = {};
        for (const [key, value] of Object.entries(input)) {
            if (!value) {
                continue;
            }
            clean[key] = value;
        }
        return clean;
    }

    function paramsSignature(params: Record<string, string>): string {
        return JSON.stringify(
            Object.keys(params)
                .sort()
                .map((key) => [key, params[key]]),
        );
    }

    function buildParamsVariants(ambient: Record<string, string>, captured: Record<string, string>): Record<
        string,
        string
    >[] {
        const variants = [
            compactParams({ ...ambient, ...captured }),
            compactParams({ ...ambient }),
            {},
        ];

        const seen = new Set<string>();
        const deduped: Record<string, string>[] = [];
        for (const variant of variants) {
            const signature = paramsSignature(variant);
            if (seen.has(signature)) {
                continue;
            }
            seen.add(signature);
            deduped.push(variant);
        }
        return deduped;
    }

    function buildRequestBody(params: Record<string, string>, input: GraphqlRequestInput, docId: string): URLSearchParams {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            body.set(key, value);
        }
        body.set('fb_api_req_friendly_name', input.queryName);
        body.set('variables', JSON.stringify(input.variables ?? {}));
        body.set('doc_id', docId);
        return body;
    }

    function describeAttempt(endpoint: string, params: Record<string, string>, error: unknown): string {
        const details = String(error instanceof Error ? error.message : error);
        return `endpoint=${endpoint} params=${Object.keys(params).length} error=${details}`;
    }

    async function request<T = unknown>(input: GraphqlRequestInput): Promise<T> {
        const { entry } = await requireCalibrationEntry(input);

        const variables = mergeVariables(entry.variables, input.variables);
        const requestInput: GraphqlRequestInput = { ...input, variables };

        const ambientParams = getAmbientRequestParams();
        const capturedParams = entry.requestParams ?? {};
        const paramsVariants = buildParamsVariants(ambientParams, capturedParams);
        const endpoints = resolveEndpointCandidates(input.endpoint);
        const errors: string[] = [];

        for (const endpoint of endpoints) {
            for (const params of paramsVariants) {
                try {
                    return (await requestEndpoint(
                        endpoint,
                        requestInput.queryName,
                        buildRequestBody(params, requestInput, entry.docId),
                        requestInput.responseMode ?? 'single',
                    )) as T;
                } catch (error) {
                    errors.push(describeAttempt(endpoint, params, error));
                }
            }
        }

        throw new Error(`GraphQL request failed after retries. ${errors.slice(0, 3).join(' | ')}`);
    }

    return { request };
}
