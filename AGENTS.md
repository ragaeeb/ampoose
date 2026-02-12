# AGENTS.md

## Purpose
This repo is the Ampoose WXT + React + TypeScript implementation.  
The runtime is Ampoose-owned and does not rely on upstream bundles.

## Read Order (Start Here)
1. `README.md` — project overview, constraints, and usage.
2. `docs/chrome-web-store-submission.md` — Chrome Web Store listing notes, single-purpose, permissions.
3. `privacy-policy.md` — privacy policy for store submission (canonical).
3. `src/runtime/controller/runController.ts` — active runtime orchestration.
4. `tests/legacy-parity/*` — runtime and contract suite.

## Repo Layout
- `wxt.config.ts` — WXT config and MV3 manifest fields.
- `src/entrypoints/` — extension entrypoints.
  - `src/entrypoints/background.ts` — background/service worker.
  - `src/entrypoints/content.tsx` — content script UI mount.
  - `src/entrypoints/main-world.content.ts` — main-world (MAIN world) capture/bridge entry.
- `src/ui/` — in-page React dialog and controls.
- `src/runtime/` — runtime controller, bridge, calibration, logs, state.
- `src/domain/` — pure typed domain modules (export/chunk/graphql/resume/checkpoint).
- `public/src/assets/logo/` — extension logos/icons.
- `docs/` — project documentation.
- `tests/legacy-parity/` — bun:test suites for runtime contracts and parity.

## Scripts
- `bun run dev` — start WXT dev server.
- `bun run build` — build Chrome MV3 extension.
- `bun run zip` — package extension zip.
- `bun run test` — run bun:test suite.
- `bun run test:coverage` — run tests with coverage.
- `bun run check` — strict TypeScript check.

## Minimal Feature Contract (Must Keep)
- Filter posts by date.
- Filter posts by count.
- JSON-only export:
  - default direct `posts.json` for small/medium runs,
  - durable large-run path (`ALL` without date filter): run-scoped chunk fallback (`posts-run-<runId>-part-*.json` + `posts-run-<runId>-index.json`).
- Text-only export: each post includes `id`, `content`, and `createdAt`.
- Posts with attachments or empty content are dropped.
- Failures on individual posts do not abort the run.

## Features Explicitly Removed
- Branding, pricing/FAQ, review prompts.
- Telemetry/analytics.
- CSV/HTML exports.
- Screenshots and attachments download flows.
- Comments export and translations.
- External support links or subscription UI.

## Regression Tests To Keep Green
- `tests/legacy-parity/export_contract.test.ts`
- `tests/legacy-parity/chunk_contract.test.ts`
- `tests/legacy-parity/run_controller_contract.test.ts`
- `tests/legacy-parity/profile_timeline_query.test.ts`
- `tests/legacy-parity/log_store_contract.test.ts`
- `tests/legacy-parity/no_graphql_info_host.test.ts`
