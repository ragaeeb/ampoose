import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DOMAIN_MATCHES } from '@/shared/constants';
import { mountApp } from '@/ui/mount';

export type ContentMainDeps = {
    createShadowRootUi: typeof createShadowRootUi;
    mountApp: typeof mountApp;
};

export function createContentMain(deps: ContentMainDeps) {
    return async function main(ctx: ContentScriptContext) {
        const ui = await deps.createShadowRootUi(ctx, {
            anchor: 'body',
            append: 'last',
            name: 'ampoose-ui',
            onMount: (container) => {
                const unmount = deps.mountApp(container);
                return unmount;
            },
            position: 'inline',
        });

        // At document_start, body may not exist yet. autoMount waits for anchor readiness.
        ui.autoMount();
    };
}

export const contentScriptDefinition = {
    cssInjectionMode: 'ui',
    main: createContentMain({ createShadowRootUi, mountApp }),
    matches: DOMAIN_MATCHES,
    runAt: 'document_start',
    world: 'ISOLATED',
} satisfies Parameters<typeof defineContentScript>[0];

export default defineContentScript(contentScriptDefinition);
