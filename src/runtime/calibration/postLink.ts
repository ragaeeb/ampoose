const ARTICLE_SELECTOR_PREFIX = "div[role='article'] ";
const LINK_SELECTORS = ["a[href*='story_fbid=']", "a[href*='/permalink.php']", "a[href*='/posts/']"] as const;

function safeParseUrl(href: string, baseHref: string): URL | null {
    try {
        return new URL(href, baseHref);
    } catch {
        return null;
    }
}

function getPostsSegmentId(pathname: string): string | null {
    const parts = pathname.replace(/\/+$/g, '').split('/').filter(Boolean);
    const postsIndex = parts.lastIndexOf('posts');
    if (postsIndex < 0) {
        return null;
    }
    return parts[postsIndex + 1] ?? null;
}

export function isLikelyPostPermalink(href: string, baseHref = 'https://www.facebook.com/'): boolean {
    const parsed = safeParseUrl(href, baseHref);
    if (!parsed) {
        return false;
    }

    const pathname = parsed.pathname || '';
    const storyFbid = parsed.searchParams.get('story_fbid');
    if (storyFbid) {
        return true;
    }

    if (pathname.endsWith('/permalink.php') || pathname === '/permalink.php') {
        return Boolean(parsed.searchParams.get('fbid'));
    }

    const postsId = getPostsSegmentId(pathname);
    if (!postsId) {
        return false;
    }
    // Profile tab links are usually `/<profile>/posts` without a concrete post id segment.
    return postsId.length > 0;
}

type QueryRoot = {
    querySelectorAll: <T extends Element = Element>(selectors: string) => Iterable<T> | ArrayLike<T>;
};

function collectCandidates(root: QueryRoot, selector: string): HTMLAnchorElement[] {
    const nodes = root.querySelectorAll<HTMLAnchorElement>(selector);
    return Array.from(nodes);
}

export function findFirstPostPermalinkLink(root: QueryRoot = document): HTMLAnchorElement | null {
    const baseHref = typeof window !== 'undefined' ? window.location.href : 'https://www.facebook.com/';

    // Prefer links inside feed articles before global links.
    const selectors = [...LINK_SELECTORS.map((selector) => `${ARTICLE_SELECTOR_PREFIX}${selector}`), ...LINK_SELECTORS];

    for (const selector of selectors) {
        const candidates = collectCandidates(root, selector);
        for (const link of candidates) {
            const href = link.getAttribute('href') ?? link.href;
            if (!href) {
                continue;
            }
            if (!isLikelyPostPermalink(href, baseHref)) {
                continue;
            }
            return link;
        }
    }

    return null;
}

export function preparePostLinkForOpen(link: HTMLAnchorElement) {
    if (link.getAttribute('target') === '_blank') {
        link.setAttribute('target', '_self');
    }
}
