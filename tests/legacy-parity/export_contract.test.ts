import { expect, test } from "bun:test";
import { buildExportEnvelope, stringifyExportData } from "../../src/domain/export/envelope";

test("export contract: envelope keys and post whitelist", () => {
  const input = [
    {
      post_id: "p1",
      content: " hello ",
      createdAt: 123,
      author: {
        id: "a1",
        name: "Author Name",
        avatar: "https://cdn/avatar.jpg",
        profile: "https://www.facebook.com/author"
      },
      attachments: []
    },
    {
      post_id: "p2",
      content: "has attachment",
      attachments: [{ id: "raw-graph" }]
    },
    {
      post_id: "p3",
      content: "   "
    }
  ];

  const envelope = buildExportEnvelope(input);
  expect(Object.keys(envelope)).toEqual(["profile", "author", "posts"]);
  expect(envelope.profile).toBe("https://www.facebook.com/author");
  expect(envelope.author).toEqual({ id: "a1", name: "Author Name" });
  expect(envelope.posts).toEqual([{ id: "p1", content: "hello", createdAt: 123 }]);

  const pretty = stringifyExportData(envelope);
  expect(pretty.includes('\n  "posts": [\n')).toBe(true);
});
