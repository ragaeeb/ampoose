const DOWNLOAD_ROOT = 'Ampoose';

export function buildDownloadFilename(filename: string | undefined): string {
    const raw = String(filename ?? 'posts.json').trim() || 'posts.json';
    const normalizedSlash = raw.replace(/\\/g, '/');
    const withoutPrefix = normalizedSlash.replace(/^Ampoose\/+/i, '');
    const segments = withoutPrefix
        .replace(/^\/+/, '')
        .split('/')
        .filter((segment) => segment && segment !== '.' && segment !== '..');
    const leaf = segments.length > 0 ? segments.join('/') : 'posts.json';
    return `${DOWNLOAD_ROOT}/${leaf}`;
}

