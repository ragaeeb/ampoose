import { defineContentScript } from "wxt/utils/define-content-script";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { injectScript } from "wxt/utils/inject-script";
import { installContentBridge } from "@/runtime/bridge/contentBridge";
import { mountApp } from "@/ui/mount";

export default defineContentScript({
  matches: ["https://www.facebook.com/*", "https://web.facebook.com/*"],
  runAt: "document_start",
  async main(ctx) {
    const stopBridge = installContentBridge();

    await injectScript("/main-world.js", {
      keepInDom: true
    });

    const ui = await createShadowRootUi(ctx, {
      name: "ampoose-next-ui",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (container) => {
        const unmount = mountApp(container);
        return unmount;
      },
      onRemove: () => {
        stopBridge();
      }
    });

    // At document_start, body may not exist yet. autoMount waits for anchor readiness.
    ui.autoMount();
  }
});
