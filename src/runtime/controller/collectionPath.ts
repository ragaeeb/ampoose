import type { GraphqlArtifactV1 } from '@/domain/types';

const TIMELINE_QUERY_NAME = 'ProfileCometTimelineFeedRefetchQuery';
const DOWNLOAD_DEFAULT_FILENAME = 'posts.json';
const DOWNLOAD_DEFAULT_FOLDER = 'collection';
const FORBIDDEN_PATH_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

const RESERVED_PROFILE_SEGMENTS = new Set([
    'about',
    'ads',
    'business',
    'events',
    'friends',
    'gaming',
    'groups',
    'help',
    'home.php',
    'login',
    'marketplace',
    'messages',
    'notifications',
    'pages',
    'people',
    'permalink.php',
    'photo.php',
    'privacy',
    'profile.php',
    'reel',
    'search',
    'settings',
    'signup',
    'stories',
    'watch',
]);

function parseUrl(rawUrl: string | null | undefined): URL | null {
    if (!rawUrl) {
        return null;
    }
    const source = String(rawUrl).trim();
    if (!source) {
        return null;
    }
    try {
        return new URL(source);
    } catch {
        return null;
    }
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function getPathSegments(rawUrl: string | null | undefined): string[] {
    const url = parseUrl(rawUrl);
    if (!url) {
        return [];
    }
    return url.pathname
        .split('/')
        .map((segment) => decodeSegment(segment).trim())
        .filter(Boolean);
}

function sanitizePathToken(value: string): string {
    const raw = String(value).trim();
    if (!raw) {
        return '';
    }

    let out = '';
    for (const ch of raw) {
        const code = ch.codePointAt(0) ?? 0;
        // Replace control chars + filesystem-invalid tokens with underscores.
        if (code <= 31 || code === 127 || FORBIDDEN_PATH_CHARS.has(ch)) {
            out += '_';
            continue;
        }
        out += ch;
    }

    return out.replace(/\s+/g, ' ').replace(/^\.+$/, '');
}

function normalizeId(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.trunc(value));
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }
        return trimmed;
    }
    return '';
}

export function extractProfileUsername(rawUrl: string | null | undefined): string {
    const segments = getPathSegments(rawUrl);
    if (segments.length === 0) {
        return '';
    }
    const first = segments[0] ?? '';
    const lowered = first.toLowerCase();
    if (!first || RESERVED_PROFILE_SEGMENTS.has(lowered)) {
        return '';
    }
    if (/^\d+$/.test(first)) {
        return '';
    }
    return first;
}

export function extractProfileIdFromUrl(rawUrl: string | null | undefined): string {
    const url = parseUrl(rawUrl);
    if (!url) {
        return '';
    }
    const idFromQuery = normalizeId(url.searchParams.get('id'));
    if (idFromQuery) {
        return idFromQuery;
    }

    const segments = getPathSegments(rawUrl);
    if (segments.length === 0) {
        return '';
    }

    const first = segments[0] ?? '';
    if (/^\d+$/.test(first)) {
        return first;
    }

    if (first.toLowerCase() === 'people' && segments.length >= 3) {
        const third = normalizeId(segments[2]);
        if (third) {
            return third;
        }
    }

    return '';
}

export function extractProfileIdFromArtifact(artifact: GraphqlArtifactV1 | null | undefined): string {
    if (!artifact?.entries) {
        return '';
    }
    const entry = artifact.entries[TIMELINE_QUERY_NAME];
    if (!entry || typeof entry.variables !== 'object' || !entry.variables) {
        return '';
    }
    return normalizeId(entry.variables.id);
}

export function resolveCollectionContext(input: {
    currentUrl: string | null | undefined;
    artifact: GraphqlArtifactV1 | null | undefined;
}): {
    collectionId: string;
    folderNames: string[];
    folderName: string;
    username: string;
    profileId: string;
} {
    const usernameRaw = extractProfileUsername(input.currentUrl);
    const urlIdRaw = extractProfileIdFromUrl(input.currentUrl);
    const artifactIdRaw = extractProfileIdFromArtifact(input.artifact);

    const username = sanitizePathToken(usernameRaw);
    const profileId = sanitizePathToken(artifactIdRaw || urlIdRaw);
    const folderName = username || profileId || DOWNLOAD_DEFAULT_FOLDER;
    const collectionId = profileId || folderName;

    return {
        collectionId,
        folderName,
        folderNames: [folderName],
        profileId,
        username,
    };
}

export function resolveCollectionFolderName(
    folderNames: string[] | undefined,
    collectionId: string | undefined,
): string {
    const fromFolders = Array.isArray(folderNames)
        ? folderNames
              .map((name) => sanitizePathToken(name))
              .filter(Boolean)
              .join('_')
        : '';

    const fromCollectionId = sanitizePathToken(collectionId ?? '');
    return fromFolders || fromCollectionId || DOWNLOAD_DEFAULT_FOLDER;
}

export function buildCollectionRelativeFilename(folderName: string, filename: string | null | undefined): string {
    const safeFolderName = sanitizePathToken(folderName) || DOWNLOAD_DEFAULT_FOLDER;
    const raw = String(filename ?? DOWNLOAD_DEFAULT_FILENAME).trim() || DOWNLOAD_DEFAULT_FILENAME;
    const normalized = raw.replace(/\\/g, '/').replace(/^Ampoose\/+/i, '');
    const safePath = normalized
        .replace(/^\/+/, '')
        .split('/')
        .map((segment) => sanitizePathToken(segment))
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');

    const leaf = safePath || DOWNLOAD_DEFAULT_FILENAME;
    return `${safeFolderName}/${leaf}`;
}
