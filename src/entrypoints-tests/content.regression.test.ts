import { describe, expect, it } from 'bun:test';
import { contentScriptDefinition } from '@/entrypoints/content';

describe('content script mounting', () => {
    it('should use cssInjectionMode=ui so App styles apply inside the shadow root UI', () => {
        // When using createShadowRootUi + CSS modules, styles must be injected into the shadow root.
        expect(contentScriptDefinition.cssInjectionMode).toBe('ui');
    });
});
