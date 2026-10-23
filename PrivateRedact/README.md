# PrivateRedact web app

Developer notes for the client-side PDF redaction app. For what the project is and how it works,
see the [documentation](../docs/README.md).

## Requirements

- Node.js 22.22+ (`../.nvmrc`)
- npm 10+

## Scripts

| Command                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server with hot reload (no CSP in dev).                             |
| `npm run build`                   | Typecheck, then production build into `dist/` (CSP injected, PWA generated). |
| `npm run preview`                 | Serve `dist/` locally to test the production build.                          |
| `npm test`                        | Run all tests once (Vitest).                                                 |
| `npm run test:watch`              | Tests in watch mode.                                                         |
| `npm run test:coverage`           | Tests with a V8 coverage report in `coverage/`.                              |
| `npm run test:e2e`                | Playwright end-to-end tests in Chromium against the dev server.              |
| `npm run test:e2e:ui`             | Same, in the Playwright UI runner.                                           |
| `npm run lint`                    | ESLint with type-aware rules; fails on any warning.                          |
| `npm run typecheck`               | `tsc -b` in strict mode.                                                     |
| `npm run format` / `format:check` | Prettier write / verify.                                                     |
| `npm run analyze`                 | Production build plus `stats.html` bundle treemap.                           |
| `npm run check`                   | Everything CI runs, in order.                                                |

## Source layout

```
src/
  main.tsx, Routes.tsx        app entry, lazy routes, error boundary
  config.ts                   repo/docs URLs (no secrets: there is no backend)
  components/                 Layout, ErrorBoundary
  hooks/                      useLatest, useFocusTrap
  pages/                      Home, Redact, Privacy, NotFound
  features/redact/
    engine/                   pdf-lib redaction engine (no DOM, runs in worker + Node)
      tokenizer.ts            content-stream lexer with byte ranges
      fonts.ts                glyph widths, code splitting, ascent/descent
      interpreter.ts          graphics/text state machine, glyph-level rewrite, XObjects, images
      page.ts                 per-page pipeline, burn boxes, annotation removal
      sanitize.ts             metadata scrub + garbage collection of unreachable objects
      redactPdf.ts            public entry point
      __tests__/              fixture builders, leak scanner, regression tests
    state/redactionsReducer.ts  boxes per file/page with undo/redo history
    workers/                  worker entry, typed protocol, main-thread client
    lib/                      PDF.js loader, coordinates, intake validation, verification, zip
    hooks/                    usePdfDocument, useWorkspaceShortcuts
    components/               workspace UI (viewer, Fabric overlay, toolbar, dialogs)
build-plugins/                CSP meta injection, same-origin PDF.js assets
```

## Environment variables

| Variable         | Used at | Purpose                                                                           |
| ---------------- | ------- | --------------------------------------------------------------------------------- |
| `VITE_BASE_PATH` | build   | Serve from a sub-path, e.g. `/PrivateRedact/` on GitHub Pages. Must end with `/`. |
| `ANALYZE=1`      | build   | Emit `stats.html` (bundle visualiser).                                            |

## Notes

- Engine tests run in Node; component tests run in happy-dom (`// @vitest-environment happy-dom`).
- End-to-end tests live in `e2e/` and build their PDF fixtures with pdf-lib at run time. They
  start the Vite dev server themselves; set `E2E_PREVIEW=1` to build and test the production
  bundle instead. First run: `npx playwright install chromium`.
- PDF.js runtime assets (CMaps, fonts, WASM decoders) are served from `/pdfjs/` by
  `build-plugins/pdfjsAssets.ts`, so no CDN is needed.
- `eslint-plugin-jsx-a11y` is not yet compatible with ESLint 10, so accessibility is covered by
  Testing Library role queries in component tests instead.
