# Ampoose

![Ampoose Icon](icon.png)

[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/b242e6f4-8e78-494d-b0fa-775531afed9c.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/b242e6f4-8e78-494d-b0fa-775531afed9c)
[![codecov](https://codecov.io/gh/ragaeeb/ampoose/graph/badge.svg?token=MPIZITMBJJ)](https://codecov.io/gh/ragaeeb/ampoose)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/chrome-extension-brightgreen.svg)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Minimum Chrome](https://img.shields.io/badge/chrome-%3E%3D103-blue.svg)](https://www.google.com/chrome/)
[![Bun](https://img.shields.io/badge/runtime-bun%201.3.9-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/react-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![WXT](https://img.shields.io/badge/wxt-0.20.x-111827)](https://wxt.dev/)

Private WXT + React successor for Ampoose.

## Purpose

- Export Facebook posts to JSON with a minimal runtime.
- Keep export contracts stable with legacy parity tests.
- Keep calibration/docIds local to extension storage.

## Feature Contract

- Filter by count or date filter mode.
- JSON-only export envelope:
  - top-level keys: `profile`, `author`, `posts`
  - post keys: `id`, `content`, `createdAt`
- Drop posts with attachments or empty text.
- Large `ALL` runs use run-scoped chunks:
  - `posts-run-<runId>-part-<NNNN>.json`
  - `posts-run-<runId>-index.json`
- Duplicate-loop guard stops after 5 fully duplicate pages.
- Download path is namespaced:
  - `~/Downloads/Ampoose/<username-or-id>/...`
- Resume support from previously exported JSON parts.
- Probe mode to detect earliest accessible post without writing export files.
- Popup includes log-level control for runtime verbosity.

## Project Layout

```text
ampoose/
├── src/
│   ├── entrypoints/
│   │   ├── background.ts
│   │   ├── content.tsx
│   │   └── main-world.content.ts
│   ├── ui/
│   ├── runtime/
│   └── domain/
├── public/src/assets/logo/
├── tests/legacy-parity/
└── docs/
    ├── chrome-web-store-submission.md
    └── privacy-policy.md
```

## Commands

- `bun run dev`
- `bun run build`
- `bun run zip`
- `bun run test`
- `bun run test:coverage`
- `bun run check`

## Documentation

- `docs/chrome-web-store-submission.md` — listing, permissions, and CWS scope notes.
- `docs/privacy-policy.md` — extension privacy disclosure.
