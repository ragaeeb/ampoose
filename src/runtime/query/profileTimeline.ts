import type { GraphqlRequestInput } from '@/domain/graphql/client';
import type { RuntimePost } from '@/runtime/controller/types';

const TIMELINE_QUERY_NAME = 'ProfileCometTimelineFeedRefetchQuery';

type GraphqlRequester = {
    request: (input: GraphqlRequestInput) => Promise<unknown>;
};

type QueryInput = {
    cursor: string | null;
    signal?: AbortSignal;
};

type TimelinePage = {
    nextCursor: string | null;
    posts: RuntimePost[];
};

type GraphqlError = {
    message: string;
    code?: string | number;
    severity?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitPath(path: string): string[] {
    return path.split('.');
}

type PathStep =
    | { type: 'prop'; key: string }
    | { type: 'arrayProp'; key: string; index: number }
    | { type: 'arrayIndex'; index: number };

function parsePathStep(part: string): PathStep | null {
    const arrayMatch = /^([^[]+)\[(\d+)\]$/.exec(part);
    if (arrayMatch) {
        const key = arrayMatch[1] ?? '';
        const index = Number(arrayMatch[2]);
        if (!key || !Number.isInteger(index) || index < 0) {
            return null;
        }
        return { index, key, type: 'arrayProp' };
    }

    if (/^\d+$/.test(part)) {
        const index = Number(part);
        if (!Number.isInteger(index) || index < 0) {
            return null;
        }
        return { index, type: 'arrayIndex' };
    }

    if (!part) {
        return null;
    }
    return { key: part, type: 'prop' };
}

function stepIntoPath(current: unknown, step: PathStep): unknown {
    if (step.type === 'arrayIndex') {
        return Array.isArray(current) ? current[step.index] : undefined;
    }

    if (!isRecord(current)) {
        return undefined;
    }

    if (step.type === 'arrayProp') {
        const target = current[step.key];
        return Array.isArray(target) ? target[step.index] : undefined;
    }

    return current[step.key];
}

function getByPath(source: unknown, path: string): unknown {
    const parts = splitPath(path);
    let current: unknown = source;

    for (const part of parts) {
        const step = parsePathStep(part);
        if (!step) {
            return undefined;
        }
        current = stepIntoPath(current, step);
    }

    return current;
}

function firstPath(source: unknown, paths: string[]): unknown {
    for (const path of paths) {
        const value = getByPath(source, path);
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}

function collectPageInfoCandidatesDeep(source: unknown): unknown[] {
    const candidates: unknown[] = [];
    const visited = new Set<unknown>();

    const walk = (value: unknown) => {
        if (!value || typeof value !== 'object') {
            return;
        }
        if (visited.has(value)) {
            return;
        }
        visited.add(value);

        if (isRecord(value) && 'has_next_page' in value && 'end_cursor' in value) {
            candidates.push(value);
        }

        if (Array.isArray(value)) {
            for (const entry of value) {
                walk(entry);
            }
            return;
        }

        for (const entry of Object.values(value)) {
            walk(entry);
        }
    };

    walk(source);
    return candidates;
}

function normalizeString(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

function normalizeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return 0;
}

function getFirstNonNullFromList(list: unknown[], path: string): unknown {
    for (const entry of list) {
        const value = getByPath(entry, path);
        if (value != null) {
            return value;
        }
    }
    return undefined;
}

function getFirstPathMatch(target: unknown, paths: string[], fallback: unknown): unknown {
    for (const path of paths) {
        const value = getByPath(target, path);
        if (value) {
            return value;
        }
    }
    return fallback;
}

function resolveCreationTime(node: Record<string, unknown>): number {
    const primary = getByPath(
        node,
        'comet_sections.content.story.comet_sections.context_layout.story.comet_sections.metadata',
    );
    if (Array.isArray(primary)) {
        const createdAt = normalizeNumber(getFirstNonNullFromList(primary, 'story.creation_time'));
        if (createdAt > 0) {
            return createdAt;
        }
    }

    const fallback = getByPath(node, 'comet_sections.context_layout.story.comet_sections.metadata');
    if (Array.isArray(fallback)) {
        const createdAt = normalizeNumber(getFirstNonNullFromList(fallback, 'story.creation_time'));
        if (createdAt > 0) {
            return createdAt;
        }
    }

    return 0;
}

function normalizePostNode(node: unknown): RuntimePost | null {
    if (!isRecord(node)) {
        return null;
    }

    const postId = normalizeString(node.post_id ?? node.id);
    if (!postId) {
        return null;
    }

    const story = (getByPath(node, 'comet_sections.content.story') ?? {}) as Record<string, unknown>;
    const feedback = getFirstPathMatch(
        node,
        [
            'comet_sections.feedback.story.comet_feed_ufi_container.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback',
            'comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback',
        ],
        {},
    );
    const actor = firstPath(node, [
        'comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0]',
        'comet_sections.content.story.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0]',
    ]);

    const author = isRecord(actor)
        ? {
              id: normalizeString(actor.id),
              name: normalizeString(actor.name),
              profile: normalizeString(actor.profile_url),
          }
        : undefined;

    return {
        _attachedStoryOriginal: getByPath(node, 'attached_story'),
        _attachments: [],
        attached_story: isRecord(story.attached_story) ? story.attached_story : getByPath(node, 'attached_story'),
        attachments: getByPath(story, 'attachments'),
        attachmentsDetails: [],
        author,
        comments: [],
        content: normalizeString(
            firstPath(story, [
                'message.text',
                'comet_sections.message.story.message.text',
                'comet_sections.message_container.story.message.text',
            ]) ?? '',
        ),
        createdAt: resolveCreationTime(node),
        feedbackId: normalizeString(getByPath(story, 'feedback.id') ?? getByPath(node, 'feedback.id')),
        post_id: postId,
        reactionsCount: normalizeNumber(getByPath(feedback, 'reaction_count.count')),
        shareCount: normalizeNumber(getByPath(feedback, 'share_count.count')),
        storyId: normalizeString(node.id),
        url: normalizeString(getByPath(story, 'wwwURL')),
    };
}

function toPayloadArray(response: unknown): unknown[] {
    if (Array.isArray(response)) {
        return response;
    }
    if (response === undefined || response === null) {
        return [];
    }
    return [response];
}

function collectTimelineNodes(payload: unknown): unknown[] {
    const edges = getByPath(payload, 'data.node.timeline_list_feed_units.edges');
    if (Array.isArray(edges)) {
        const nodes: unknown[] = [];
        for (const edge of edges) {
            const node = isRecord(edge) ? edge.node : undefined;
            if (node) {
                nodes.push(node);
            }
        }
        return nodes;
    }

    const single =
        getByPath(payload, 'data.node.timeline_list_feed_units.edges[0].node') ?? getByPath(payload, 'data.node');
    return single ? [single] : [];
}

function findFirstPageInfoCandidate(payloads: unknown[]): unknown {
    const pathCandidates = payloads
        .map((payload) => firstPath(payload, ['data.page_info', 'data.node.timeline_list_feed_units.page_info']))
        .filter((value) => value !== undefined && value !== null);
    const deepCandidates = payloads.flatMap((payload) => collectPageInfoCandidatesDeep(payload));
    const candidates = [...pathCandidates, ...deepCandidates];

    for (const candidate of candidates) {
        if (!isRecord(candidate)) {
            continue;
        }
        const endCursor = normalizeString(candidate.end_cursor);
        if (Boolean(candidate.has_next_page) && Boolean(endCursor)) {
            return candidate;
        }
    }

    return candidates[0];
}

function normalizePageInfo(candidate: unknown): { endCursor: string | null; hasNextPage: boolean } {
    if (!isRecord(candidate)) {
        return { endCursor: null, hasNextPage: false };
    }
    return {
        endCursor: normalizeString(candidate.end_cursor) || null,
        hasNextPage: Boolean(candidate.has_next_page),
    };
}

function normalizeDedupedPosts(nodes: unknown[]): RuntimePost[] {
    const dedup = new Set<string>();
    const posts: RuntimePost[] = [];

    for (const node of nodes) {
        const normalized = normalizePostNode(node);
        if (!normalized) {
            continue;
        }
        const postId = normalizeString(normalized.post_id);
        if (!postId || dedup.has(postId)) {
            continue;
        }
        dedup.add(postId);
        posts.push(normalized);
    }

    return posts;
}

export function extractTimelinePageFromResponse(response: unknown): TimelinePage {
    const payloads = toPayloadArray(response);
    const nodes = payloads.flatMap((payload) => collectTimelineNodes(payload));
    const pageInfo = normalizePageInfo(findFirstPageInfoCandidate(payloads));
    const posts = normalizeDedupedPosts(nodes);

    return {
        nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
        posts,
    };
}

function normalizeGraphqlError(entry: unknown): GraphqlError | null {
    if (!isRecord(entry)) {
        return null;
    }
    const message = normalizeString(entry.message || entry.description || '');
    if (!message) {
        return null;
    }

    const code = normalizeString(entry.code || '');
    const severity = normalizeString(entry.severity || '');
    return {
        ...(code ? { code } : {}),
        ...(severity ? { severity } : {}),
        message,
    };
}

function extractErrorsFromPayload(payload: unknown): GraphqlError[] {
    const list = getByPath(payload, 'errors');
    if (!Array.isArray(list)) {
        return [];
    }

    const errors: GraphqlError[] = [];
    for (const entry of list) {
        const normalized = normalizeGraphqlError(entry);
        if (!normalized) {
            continue;
        }
        errors.push(normalized);
    }
    return errors;
}

function extractGraphqlErrors(response: unknown): GraphqlError[] {
    const payloads = toPayloadArray(response);
    return payloads.flatMap((payload) => extractErrorsFromPayload(payload));
}

export async function queryProfileTimelinePage(client: GraphqlRequester, input: QueryInput) {
    const requestInput: GraphqlRequestInput = {
        queryName: TIMELINE_QUERY_NAME,
        responseMode: 'all',
        ...(input.cursor ? { variables: { cursor: input.cursor } } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
    };

    const response = await client.request(requestInput);
    const page = extractTimelinePageFromResponse(response);
    if (page.posts.length === 0 && !page.nextCursor) {
        const errors = extractGraphqlErrors(response);
        if (errors.length > 0) {
            const summary = errors
                .slice(0, 3)
                .map((error) => `${error.code ? `[${error.code}] ` : ''}${error.message}`)
                .join(' | ');
            throw new Error(`timeline query returned GraphQL errors: ${summary}`);
        }
    }
    return page;
}
