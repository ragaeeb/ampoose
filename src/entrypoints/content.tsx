import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { mountApp } from '@/ui/mount';

export type ContentMainDeps = {
    createShadowRootUi: typeof createShadowRootUi;
    mountApp: typeof mountApp;
};

export function createContentMain(deps: ContentMainDeps) {
    return async function main(ctx: any) {
        const ui = await deps.createShadowRootUi(ctx, {
            name: 'ampoose-next-ui',
            position: 'inline',
            anchor: 'body',
            append: 'last',
            onMount: (container) => {
                const unmount = deps.mountApp(container);
                return unmount;
            },
        });

        // At document_start, body may not exist yet. autoMount waits for anchor readiness.
        ui.autoMount();
    };
}

export const contentScriptDefinition = {
    matches: ['https://www.facebook.com/*', 'https://web.facebook.com/*'],
    cssInjectionMode: 'ui',
    runAt: 'document_start',
    main: createContentMain({ createShadowRootUi, mountApp }),
} as const;

export default defineContentScript(contentScriptDefinition);
