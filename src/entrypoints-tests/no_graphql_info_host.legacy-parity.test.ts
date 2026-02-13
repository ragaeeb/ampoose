import { expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const listFiles = (root: string) => {
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
};

it('should not contain graphql-info.ampoose.local references in runtime source', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const files = listFiles(path.join(root, 'src'));
    const selfPath = fileURLToPath(import.meta.url);

    const offenders: string[] = [];
    for (const file of files) {
        if (file === selfPath) {
            continue;
        }
        const source = fs.readFileSync(file, 'utf8');
        if (source.includes('graphql-info.ampoose.local')) {
            offenders.push(file);
        }
    }

    expect(offenders).toEqual([]);
});
