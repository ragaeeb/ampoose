import { describe, expect, it } from 'bun:test';

const CSS_PATH = new URL('../../src/ui/styles.css', import.meta.url);

describe('UI styles regression', () => {
    it('should define design tokens on :host so CSS variables work inside the shadow root', async () => {
        const css = await Bun.file(CSS_PATH).text();
        expect(css).toMatch(/^\s*:host\b/m);
    });

    it('should define font stacks as real font-family lists (not a single quoted string)', async () => {
        const css = await Bun.file(CSS_PATH).text();
        expect(css).toMatch(/--font-family-base:\s*system-ui,/);
        expect(css).toMatch(/--font-family-mono:\s*Menlo,/);
        expect(css).not.toMatch(/--font-family-base:\s*'/);
        expect(css).not.toMatch(/--font-family-mono:\s*'/);
    });
});

