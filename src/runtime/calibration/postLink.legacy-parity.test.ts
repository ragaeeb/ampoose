import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import {
    findFirstPostPermalinkLink,
    isLikelyPostPermalink,
    preparePostLinkForOpen,
} from '@/runtime/calibration/postLink';

it('should ignore profile tab links and keep concrete post links', () => {
    expect(isLikelyPostPermalink('/some.profile/posts')).toBeFalse();
    expect(isLikelyPostPermalink('/some.profile/posts/pfbid12345')).toBeTrue();
    expect(isLikelyPostPermalink('/permalink.php?story_fbid=123&id=456')).toBeTrue();
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
    expect(isLikelyPostPermalink('::not-a-url::', '::bad-base::')).toBeFalse();
    expect(isLikelyPostPermalink('/permalink.php?fbid=123')).toBeTrue();
    expect(isLikelyPostPermalink('/permalink.php')).toBeFalse();
    expect(isLikelyPostPermalink('/some.profile/photos')).toBeFalse();
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

        const blankLink = windowObj.document.createElement('a') as any;
        blankLink.setAttribute('target', '_blank');
        preparePostLinkForOpen(blankLink);
        expect(blankLink.getAttribute('target')).toBe('_self');
        const link = windowObj.document.createElement('a') as any;
        link.setAttribute('target', '_self');
        preparePostLinkForOpen(link);
        expect(link.getAttribute('target')).toBe('_self');
    } finally {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    }
});
