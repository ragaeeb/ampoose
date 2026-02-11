import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function listFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|json|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("runtime source contains no graphql-info.ampoose.local references", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files = listFiles(path.join(root, "src")).concat(listFiles(path.join(root, "src", "entrypoints")));

  const offenders: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (source.includes("graphql-info.ampoose.local")) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});
