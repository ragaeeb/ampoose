import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { findFirstPostPermalinkLink, isLikelyPostPermalink } from "../../src/runtime/calibration/postLink";

test("post permalink detector ignores profile tab links and keeps concrete post links", () => {
  expect(isLikelyPostPermalink("/some.profile/posts")).toBe(false);
  expect(isLikelyPostPermalink("/some.profile/posts/pfbid12345")).toBe(true);
  expect(isLikelyPostPermalink("/permalink.php?story_fbid=123&id=456")).toBe(true);
});

test("post link finder prefers feed-article permalinks", () => {
  const windowObj = new Window({ url: "https://www.facebook.com/some.profile" });
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
    expect(selected?.id).toBe("post-link");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
