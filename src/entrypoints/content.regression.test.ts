import { describe, expect, it } from 'bun:test';
import script from '@/entrypoints/content';

describe('content script mounting', () => {
    it('should use cssInjectionMode=ui so App styles apply inside the shadow root UI', () => {
        // When using createShadowRootUi + CSS modules, styles must be injected into the shadow root.
        expect((script as any).cssInjectionMode).toBe('ui');
    });
});

