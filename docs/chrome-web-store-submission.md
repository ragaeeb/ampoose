# Chrome Web Store Submission Notes

## Listing Description
Ampoose helps people export their own Facebook posts into clean JSON files for backup, analysis, and migration workflows. The extension runs directly on Facebook profile and timeline pages and exports text-only post records with `id`, `content`, and `createdAt`.

Why install it:
- Keep a portable backup of your Facebook post history.
- Export machine-readable JSON for personal analytics, AI workflows, or migration to other tools.
- Use count-based or date-based limits to control export size.
- Automatically ignore non-text posts and attachment-heavy posts to keep output focused.

Note: Facebook is a trademark of Meta. Ampoose is not affiliated with or endorsed by Meta.

## Single Purpose Description
Ampoose has one narrow purpose: export a user's own Facebook timeline posts into local JSON files.

## Privacy Disclosure Summary (for CWS form)
- Personal data handled: Facebook post text/content, post IDs, post creation timestamps, profile/timeline identifiers needed for export context.
- Where processing happens: locally in the browser extension context on the user’s device.
- Data transfer: no transmission to Ampoose servers or third-party analytics/telemetry services.
- Data sharing/selling: none.
- User control: users can stop exports at any time and remove extension-local data by uninstalling the extension.

## Permission Justification
- `storage`
  - Required to store local extension state such as calibration artifacts and settings so exports continue to work across page reloads.
- `downloads`
  - Required to save JSON export files and run-scoped chunk/index files to the user’s Downloads folder.
- Host access (`https://www.facebook.com/*`, `https://web.facebook.com/*` via content script matches)
  - Required so the extension can run only on Facebook pages where timeline data is available.

Removed permissions not needed for single-purpose scope:
- `scripting`
- `downloads.ui`
- `declarativeNetRequest`
- `externally_connectable`
- explicit `host_permissions` manifest block

## Remote Code Statement
Ampoose does **not** execute remote-hosted code.

- No runtime execution of JavaScript/WASM loaded from external servers.
- No use of `eval`/`new Function` for remote payloads.
- Network requests are used only to request Facebook data endpoints required for export, not to fetch executable code.

## Pre-Submission Checklist
- `bun run test` passes
- `bun run check` passes
- `bun run build` passes
- Confirm listing assets/screenshots
- Provide privacy policy URL/content from `docs/privacy-policy.md`
