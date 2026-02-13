import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { findFirstPostPermalinkLink, isLikelyPostPermalink, preparePostLinkForOpen } from '@/runtime/calibration/postLink';

it('should ignore profile tab links and keep concrete post links', () => {
    expect(isLikelyPostPermalink('/some.profile/posts')).toBe(false);
    expect(isLikelyPostPermalink('/some.profile/posts/pfbid12345')).toBe(true);
    expect(isLikelyPostPermalink('/permalink.php?story_fbid=123&id=456')).toBe(true);
});

it('should prefer feed-article permalinks', () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/some.profile' });
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    globalThis.window = windowObj as any;
    globalThis.document = windowObj.document as any;

    try {
        windowObj.document.body.innerHTML = `
      <a id="tab" href="/some.profile/posts">Posts Tab</a>
      <div role="article">
        <a id="post-link" href="/some.profile/posts/pfbid1234567890">Permalink</a>
      </div>
    `;

        const selected = findFirstPostPermalinkLink(windowObj.document.body);
        expect(selected?.id).toBe('post-link');
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
});

it('should handle invalid urls and permalink fallback variants', () => {
    expect(isLikelyPostPermalink('::not-a-url::', '::bad-base::')).toBe(false);
    expect(isLikelyPostPermalink('/permalink.php?fbid=123')).toBe(true);
    expect(isLikelyPostPermalink('/permalink.php')).toBe(false);
    expect(isLikelyPostPermalink('/some.profile/photos')).toBe(false);
});

it('should return null when no permalink candidates exist and keep non-blank targets unchanged', () => {
    const windowObj = new Window({ url: 'https://www.facebook.com/some.profile' });
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    globalThis.window = windowObj as any;
    globalThis.document = windowObj.document as any;

    try {
        windowObj.document.body.innerHTML = `<a id="tab" href="/some.profile/posts">Posts Tab</a>`;
        const selected = findFirstPostPermalinkLink(windowObj.document.body);
        expect(selected).toBeNull();

        const link = windowObj.document.createElement('a');
        link.setAttribute('target', '_self');
        preparePostLinkForOpen(link);
        expect(link.getAttribute('target')).toBe('_self');
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
});
