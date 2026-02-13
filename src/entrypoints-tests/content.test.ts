import { describe, expect, it, mock } from 'bun:test';
import { createContentMain } from '@/entrypoints/content';

describe('content entrypoint', () => {
    it('should create shadow-root UI and auto mount with mount callback', async () => {
        const autoMount = mock(() => {});
        const mountApp = mock((_container: HTMLElement) => mock(() => {}));
        let capturedOptions: Record<string, unknown> = {};

        const createShadowRootUi = mock(async (_ctx: unknown, options: Record<string, unknown>) => {
            capturedOptions = options;
            return { autoMount };
        });

        const main = createContentMain({
            createShadowRootUi: createShadowRootUi as any,
            mountApp: mountApp as any,
        });

        const ctx = { foo: 'bar' } as any;
        await main(ctx);

        expect(createShadowRootUi).toHaveBeenCalledTimes(1);
        expect(createShadowRootUi).toHaveBeenCalledWith(ctx, expect.any(Object));
        expect(autoMount).toHaveBeenCalledTimes(1);
        expect(capturedOptions?.name).toBe('ampoose-ui');
        expect(capturedOptions?.position).toBe('inline');
        expect(capturedOptions?.anchor).toBe('body');
        expect(capturedOptions?.append).toBe('last');

        const onMount = capturedOptions?.onMount as ((container: HTMLElement) => unknown) | undefined;
        expect(typeof onMount).toBe('function');
        const container = document.createElement('div');
        const unmount = onMount?.(container);
        expect(mountApp).toHaveBeenCalledWith(container);
        expect(typeof unmount).toBe('function');
    });
});
