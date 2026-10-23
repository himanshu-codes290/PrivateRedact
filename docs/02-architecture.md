# 2. Architecture

## System view

There is no server. The "system" is three JavaScript threads inside one browser tab.

```
┌──────────────────────────── Browser tab ────────────────────────────┐
│                                                                      │
│  Main thread (React)                                                 │
│  ┌───────────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │ Upload / queue│──▶│  Workspace   │──▶│ Confirm → Download page │  │
│  └───────────────┘   │  PdfViewer   │   └─────────────────────────┘  │
│                      │  FabricOverlay│            ▲                  │
│                      │  Toolbar      │            │ bytes + report    │
│                      └──────┬───────┘            │                   │
│                 render/text │        redact job   │ verify (PDF.js)   │
│                             ▼            │        │                   │
│  PDF.js worker  ┌──────────────────┐     ▼        │                   │
│  (parse/render) │ pdf.worker.mjs   │   Redaction worker               │
│                 └──────────────────┘   ┌────────────────────────┐     │
│                                        │ engine/ (pdf-lib only) │     │
│                                        └────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Main thread:** React UI, Fabric.js canvas, PDF.js display layer (canvas + text layer), the
  verification pass.
- **PDF.js worker:** parsing, font loading and rendering work for display. Created lazily when the
  workspace opens; terminated when it closes.
- **Redaction worker:** the pdf-lib engine. One job at a time; terminated on cancel, timeout, crash,
  or when leaving the workspace.

## Routes and code splitting

| Route           | Loads                                                        | Notes                                          |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `/`             | `index` chunk (~252 KB, 80 KB gzip)                          | Landing page only.                             |
| `/redact`       | `Redact` chunk (Fabric + workspace) and `pdf` chunk (PDF.js) | Lazy via `React.lazy`. Workers load on demand. |
| `/privacy`, `/support`, `*` | Tiny chunks                                      | Support links out to GitHub Sponsors (plain link, no widget: the CSP forbids third-party scripts). 404 page for unknown routes. |

Before the refactor everything (PDF.js, Fabric, pdf-lib) shipped in one 1.45 MB chunk on the landing
page. Now pdf-lib lives only in the worker chunk.

## Folder structure (feature-sliced)

```
src/features/redact/
  engine/      pure redaction engine: no DOM, no React, no PDF.js
  workers/     worker entry + typed message protocol + main-thread client
  state/       redactions reducer (undo/redo)
  lib/         PDF.js loader, coordinates, file intake, verification, downloads
  hooks/       usePdfDocument, useWorkspaceShortcuts
  components/  UI
```

The dependency rule: `components → hooks/lib/state → engine (types only)`. The engine never imports
UI code, so it runs unchanged in the worker and in Node tests. The UI imports only _types_ from the
engine, which is why pdf-lib does not end up in the main bundle.

## The user flow as a state machine

`Redact.tsx` owns the file queue and switches between the upload screen and the workspace. Inside
the workspace a small phase machine drives the pipeline:

```
          beginApply()                runFrom(i)              last file done
  edit ───────────────▶ confirm ─────────────────▶ processing ───────────────▶ download
   ▲                      │  ▲                        │
   │   backToEditing()    │  │  next file / cancel /  │
   └──────────────────────┘  └──── error (retry/skip) ┘
```

- **edit:** draw boxes. Keyboard shortcuts active. The right-hand page panel shows a thumbnail
  of every page, with a badge and a preview of the boxes on it; clicking one opens that page.
- **confirm:** a modal per file (or "Apply to all"). Focus is trapped; Esc goes back to editing.
- **processing:** the worker job runs; Cancel terminates the worker. A **session counter** is
  incremented on cancel, edit-again and unmount; every `await` checks it, so late results from an
  abandoned job are ignored instead of being written into state.
- **download:** per-file report, verification badge, preview, download, ZIP. A thank-you card
  (`SupportDialog`) covers the results first, with a plain GitHub Sponsors link and a Continue
  button; "Don't show this again" is remembered in `localStorage` (wrapped in try/catch, so a
  private window simply shows it again).

## State management

### Redactions: a reducer with history

`state/redactionsReducer.ts` is the single source of truth for boxes:

```ts
byFile: { [fileId]: { [pageIndex]: Redaction[] } }   // Redaction = { id, rect: PdfRect }
past:   FileMap[]   // undo stack (max 100)
future: FileMap[]   // redo stack
```

Every update is immutable, so a history entry is just the previous `byFile` reference. Unchanged
files and pages are shared between snapshots (structural sharing), so 100 undo steps cost very
little memory. No-op actions (moving a box by zero, removing an unknown id) return the same state
object, so they do not create history entries.

Why `useReducer` and not Redux or Zustand: the state is local to one screen, the actions are few, and
a pure reducer is trivially unit-tested. Nothing else in the app needs it.

### The overlay is a view, not a store

The original code kept boxes inside Fabric.js and copied them into React state only sometimes,
which is why undo could only remove the last box and multi-select delete did nothing. Now:

```
user gesture ──▶ Fabric event ──▶ dispatch(action) ──▶ reducer ──▶ new props ──▶ reconcile()
                                                                       ▲
undo / redo / zoom / page change ──────────────────────────────────────┘
```

`reconcile()` diffs the store against the Fabric objects by id and adds, moves or removes objects.
Undo, redo, zoom and page changes therefore need no special code in the overlay.

### Other state

| State                                  | Where               | Why there                                                   |
| -------------------------------------- | ------------------- | ----------------------------------------------------------- |
| File queue                             | `pages/Redact.tsx`  | Survives switching between upload and workspace.            |
| Active file, page per file, tool, zoom | `RedactWorkspace`   | View state for one screen.                                  |
| Parsed PDF.js document                 | `usePdfDocument`    | Parsed once per file, reused for every page and zoom.       |
| Phase, confirm progress, results       | `RedactWorkspace`   | Drives the pipeline.                                        |
| Blob URLs                              | `urlsRef` (a `Set`) | Revoked in one place on edit-again, start-over and unmount. |

## Coordinate systems

Three spaces meet in this app, and getting them right is half the work.

| Space          | Origin                        | Units              | Used by                                   |
| -------------- | ----------------------------- | ------------------ | ----------------------------------------- |
| PDF user space | bottom-left of the page       | points (1/72 inch) | the engine, stored boxes                  |
| Viewport space | top-left of the rendered page | CSS pixels         | PDF.js canvas, text layer, Fabric         |
| Device pixels  | top-left                      | physical pixels    | canvas backing store (× devicePixelRatio) |

Boxes are **stored in PDF user space**, because that space does not change with zoom, rotation or
window size. Conversion uses the PDF.js viewport transform, which already includes page rotation
and the crop box offset:

```ts
viewport.convertToPdfPoint(x, y); // screen → PDF
viewport.convertToViewportPoint(x, y); // PDF → screen
```

Both corners are converted and normalised with `min`/`abs`, so a box stays correct on pages with
`/Rotate 90` or `270`, where "top-left" on screen is not "top-left" in the PDF.

## Worker protocol

`workers/pdfWorkerProtocol.ts` defines a discriminated union:

```ts
type WorkerRequest = {
  type: "redact";
  jobId;
  buffer: ArrayBuffer;
  pageRedactions;
};
type WorkerResponse =
  | { type: "progress"; jobId; progress }
  | { type: "redact-result"; jobId; bytes: ArrayBuffer; report }
  | { type: "redact-error"; jobId; message; code?; stack? };
```

- **Transferables:** the input `ArrayBuffer` and the output buffer are _transferred_ (moved), not
  copied, so a 25 MB PDF is not duplicated in memory.
- **Job ids:** every request has a unique id echoed back; messages from a cancelled job are ignored.
- **Cancellation:** a running synchronous job cannot be interrupted, so `cancel()` terminates the
  worker and the client creates a fresh one for the next job.
- **Watchdog:** jobs time out after 3 minutes; the worker is terminated.
- **Crash handling:** `onerror` and `onmessageerror` reject the job and discard the worker.

## Rendering pipeline

1. `usePdfDocument(file)` reads the file once and opens it with PDF.js (`getDocument`), with same-origin
   URLs for CMaps, standard fonts and WASM decoders.
2. `PdfViewer` asks for one page, computes the scale from the zoom mode (`fit-page`, `fit-width` or
   a number) and the available area, renders to a canvas at `devicePixelRatio`, then builds the
   transparent text layer used by the text tool.
3. `FabricOverlay` is mounted on top with the same CSS size. Its canvas is created imperatively
   inside a host `<div>` React never reconciles, because Fabric re-parents the canvas element.
4. Render tasks are cancelled when the page, zoom or file changes; `page.cleanup()` frees PDF.js
   page resources.

## Memory and resource lifecycle

| Resource             | Released when                                                                   |
| -------------------- | ------------------------------------------------------------------------------- |
| PDF.js document      | File removed or switched (`loadingTask.destroy()`).                             |
| PDF.js page          | Page/zoom change (`page.cleanup()`), render task cancelled.                     |
| Canvas backing store | Viewer unmount (`width = height = 0`, since 2D contexts are not GC friendly).   |
| Fabric canvas        | Size change or unmount (`dispose()`; only this canvas's DOM nodes are removed). |
| Redaction worker     | Cancel, timeout, crash, finish, edit-again, start-over, unmount.                |
| PDF.js worker        | Workspace unmount (`releasePdfjs()`).                                           |
| Blob URLs            | Edit-again, start-over, unmount; ZIP URL 30 s after the download starts.        |

## Security architecture

- **No backend** means no server-side attack surface and no data at rest.
- **CSP** (`build-plugins/csp.ts`) is injected at build time: `default-src 'self'`, `connect-src
'self'`, `object-src 'none'`, `form-action 'none'`, plus `'wasm-unsafe-eval'` for PDF.js decoders.
- **Untrusted input:** PDFs are hostile input. The tokenizer always advances and caps nesting;
  recursion into forms is depth-limited with cycle detection; work runs in a worker with a timeout.
- **Fail closed:** anything the engine cannot inspect safely raises a typed error or is removed and
  reported. It is never silently left in place.
- **Independent verification:** a second parser checks the output.
