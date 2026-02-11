import "@wxt-dev/module-react";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "Ampoose Next",
    description: "Maintainable Facebook posts exporter",
    version: "0.1.0",
    icons: {
      "16": "src/assets/logo/favicon-16.png",
      "19": "src/assets/logo/favicon-19.png",
      "32": "src/assets/logo/favicon-32.png",
      "38": "src/assets/logo/favicon-38.png",
      "48": "src/assets/logo/favicon-48.png",
      "128": "src/assets/logo/favicon-128.png"
    },
    minimum_chrome_version: "103",
    host_permissions: ["https://www.facebook.com/*", "https://web.facebook.com/*"],
    permissions: ["scripting", "storage", "downloads", "downloads.ui", "declarativeNetRequest"],
    externally_connectable: {
      matches: ["https://www.facebook.com/*", "https://web.facebook.com/*"]
    },
    web_accessible_resources: [
      {
        resources: ["main-world.js", "src/assets/logo/icon.svg"],
        matches: ["https://www.facebook.com/*", "https://web.facebook.com/*"]
      }
    ],
    incognito: "not_allowed"
  }
});
