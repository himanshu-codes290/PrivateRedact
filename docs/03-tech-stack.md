# 3. Tech stack

Each entry covers what the technology is, how this project uses it, why it was chosen over the
alternatives, and the gotchas worth mentioning in an interview. Versions are from
`PrivateRedact/package-lock.json`.

## At a glance

| Layer              | Choice                                                                   | Version       |
| ------------------ | ------------------------------------------------------------------------ | ------------- |
| UI                 | React                                                                    | 19.2          |
| Language           | TypeScript (strict, `noUncheckedIndexedAccess`)                          | 6.0           |
| Build / dev server | Vite (Rolldown bundler)                                                  | 8.2           |
| Styling            | Tailwind CSS                                                             | 4.3           |
| Routing            | React Router (declarative mode)                                          | 8.3           |
| File input         | react-dropzone                                                           | 20.1          |
| PDF rendering      | PDF.js (`pdfjs-dist`)                                                    | 6.3           |
| PDF writing        | pdf-lib (+ `@pdf-lib/standard-fonts`)                                    | 1.17          |
| Drawing layer      | Fabric.js                                                                | 7.4           |
| ZIP                | fflate                                                                   | 0.8           |
| Icons / font       | lucide-react, Inter (self-hosted via Fontsource)                         | 1.x / 5.x     |
| Offline            | vite-plugin-pwa (Workbox)                                                | 2.0           |
| Tests              | Vitest, Testing Library, happy-dom, V8 coverage                          | 5.0 / 16 / 21 |
| Quality            | ESLint 10 + typescript-eslint (type-aware), Prettier, Husky, lint-staged |               |
| CI                 | GitHub Actions                                                           |               |

## React 19

**Use here.** Function components and hooks throughout; `useReducer` for redaction history;
`React.lazy` + `Suspense` for route splitting; a class `ErrorBoundary` (still the only way to catch
render errors); `forwardRef` + `useImperativeHandle` to expose `deleteSelection()` from the overlay.

**Why.** Large ecosystem, first-class TypeScript, and the React Compiler lint rules
(`eslint-plugin-react-hooks` v7) catch real bugs. Two of them fired on the original code:
writing `ref.current` during render, and calling `setState` synchronously inside an effect.

**Gotchas worth knowing.**

- _Stale closures_ in long-lived listeners (Fabric events, `window` keydown). Solved with a
  `useLatest` hook that updates a ref in a layout effect, never during render.
- _StrictMode_ mounts, unmounts and remounts effects in development. Every effect here has a
  symmetric cleanup, which is why it works.
- _Imperative libraries that move DOM nodes_ (Fabric wraps its canvas in its own `<div>`) must own a
  DOM subtree React never reconciles.

## TypeScript 6

**Use here.** `strict`, `noUncheckedIndexedAccess` (array/record reads are `T | undefined`),
`noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Discriminated unions model the
worker protocol and reducer actions, so `switch (msg.type)` is exhaustively checked.

**Why `noUncheckedIndexedAccess`.** A PDF parser indexes arrays constantly. The flag forces every
`arr[i]` to handle `undefined`, which is exactly the class of bug malformed PDFs trigger.

## Vite 8

**Use here.**

- Dev server with HMR; production build with Rolldown.
- Workers: `new Worker(new URL('./pdfProcessor.worker.ts', import.meta.url), { type: 'module' })`
  for our worker, and the `?worker` import suffix for PDF.js' worker.
- Two small custom plugins in `build-plugins/`:
  - `csp.ts` injects the Content-Security-Policy `<meta>` with `transformIndexHtml` (build only).
  - `pdfjsAssets.ts` serves PDF.js CMaps, fonts and WASM from the app origin (dev middleware +
    `emitFile` at build), so no CDN is needed and the CSP can stay strict.
- `VITE_BASE_PATH` sets `base` for sub-path hosting; `ANALYZE=1` adds a bundle visualiser.

**Why over webpack / Next.js.** A static single-page app with no server rendering needs no
framework server. Vite's native worker and asset handling covers everything here with very little
configuration.

## Tailwind CSS 4

**Use here.** Utility classes; CSS-first configuration (`@theme` for animation tokens, `@utility`
for custom utilities like `glass` and `shimmer-text`). The PDF.js text-layer rules are plain CSS
because they mirror PDF.js' own stylesheet contract.

**Cleanup done.** The scaffold imported shadcn's theme CSS and a light colour palette that was never
used (and made the page background flash white). Both were removed; `body` now has an explicit dark
background.

## React Router 8

Declarative `<BrowserRouter>` + `<Routes>` with lazy route components and a catch-all 404. The
router `basename` comes from `import.meta.env.BASE_URL`, so the same build works under a sub-path.

## PDF.js

**What it is.** Mozilla's PDF renderer (the engine inside Firefox's viewer).

**Use here.**

- Rendering pages to `<canvas>` at device pixel ratio for crisp text.
- `TextLayer`: transparent, positioned `<span>`s over the canvas. The text tool turns a native
  browser selection inside this layer into boxes.
- `PageViewport.convertToPdfPoint` / `convertToViewportPoint` for coordinate conversion.
- **Verification:** after redaction, PDF.js re-extracts text from the output to confirm nothing is
  under a box.

**Gotchas.**

- `getDocument({ data })` takes ownership of (detaches) the buffer: pass a copy if you still need it.
- It needs URLs for CMaps (CJK text), standard fonts and WASM image decoders (JPEG 2000, JBIG2).
  Without them some scans and Asian-language files render wrong. They are self-hosted here.
- The worker is a module-level singleton; it is created lazily and terminated on leaving the
  workspace.

## pdf-lib

**What it is.** A pure-JavaScript library to create and modify PDFs, with a low-level object model
(`PDFDict`, `PDFArray`, `PDFRef`, `PDFStream`, `PDFContext`).

**Use here.** The redaction engine is built on its object model: reading page dictionaries and
resources, decoding streams, registering new Flate-compressed streams, deleting objects, flattening
forms, and saving.

**Why over alternatives.**

| Option                                   | Why not                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-side tools (qpdf, MuPDF, PyMuPDF) | Requires uploading the document: breaks the privacy promise.                                                                                                                  |
| MuPDF / PDFium compiled to WebAssembly   | Very capable, but several MB of WASM, and licensing (MuPDF is AGPL). A good future option for image redaction.                                                                |
| PDF.js for writing                       | PDF.js is a reader; it cannot write PDFs.                                                                                                                                     |
| pdf-lib                                  | Small, MIT-licensed, runs in a worker and in Node, exposes the raw object model. Missing pieces (content-stream interpretation, font metrics) are what the engine implements. |

**Gotchas.**

- Typed lookups like `dict.lookupMaybe(key, PDFName)` **throw** if the type differs. Real PDFs are
  messy, so the engine uses tolerant helpers (`engine/pdfObjects.ts`).
- `save()` writes **every registered object**, reachable or not. Replaced content streams and
  removed annotations would stay in the file. The engine garbage-collects unreachable objects
  before saving.
- `PDFDocument.load` updates the producer metadata unless `updateMetadata: false`.
- It cannot decrypt encrypted PDFs.

## Fabric.js 7

**Use here.** The interactive layer over the page: drawing boxes, selection, move/resize, marquee
multi-select.

**Why.** Hit-testing, selection handles, transforms and multi-selection are a lot of work to build
on a raw canvas. Fabric gives them for free and its objects are easy to sync with a store.

**Gotchas.**

- v7 defaults `originX/originY` to `'center'`; boxes pin `'left'/'top'`.
- `set()` does not refresh cached corner coordinates; call `setCoords()` before `getBoundingRect()`.
- `dispose()` is async. The original cleanup cleared the whole host after it resolved, which
  wiped the _new_ canvas after a zoom. It now removes only its own nodes (found by a browser
  smoke test).

## Web Workers and Transferables

The engine runs in a dedicated worker so a 25 MB PDF does not freeze the UI. Buffers are
transferred (ownership moves, no copy). Synchronous work cannot be interrupted, so cancellation is
`worker.terminate()` followed by a fresh worker.

## fflate

Fast, small (~8 KB) ZIP implementation. PDFs are already compressed internally, so entries are
stored with level 0: faster, and no meaningful size difference.

## Testing stack

- **Vitest**: Vite-native test runner, shares the Vite config and path aliases.
- **Node environment** for the engine (it has no DOM).
- **happy-dom** for component tests. jsdom 30 needs Node ≥ 22.22, and happy-dom keeps the suite
  runnable on Node 20 machines too.
- **Testing Library** queries by role and accessible name, so tests double as accessibility checks.
- **pdfjs-dist legacy build** in tests extracts text from engine output, as an independent oracle.
- **V8 coverage** via `@vitest/coverage-v8`.

## Code quality tooling

- **ESLint 10, flat config,** with `typescript-eslint` _type-aware_ rules (`recommendedTypeChecked`,
  `projectService`), React Hooks / React Compiler rules, React Refresh, `consistent-type-imports`,
  `no-misused-promises`, and `globals.worker` for worker files. `--max-warnings=0`.
  (`eslint-plugin-jsx-a11y` is not yet compatible with ESLint 10; a11y is covered by role-based
  tests.)
- **Prettier** for formatting; `eslint-config-prettier` turns off conflicting rules.
- **Husky + lint-staged**: pre-commit hook lints and formats only staged files.
- **GitHub Actions**: format check, lint, typecheck, tests with coverage, build, artifacts.

## Offline: vite-plugin-pwa

Generates a Workbox service worker that precaches the app shell, the PDF.js worker, WASM decoders,
CMaps and fonts (about 5.8 MB), plus a web manifest. The cache never contains user documents.
