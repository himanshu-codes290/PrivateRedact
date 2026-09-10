# Redact Workspace — Implementation Plan

> Status: DRAFT — pending review
> Scope: lift upload state into a new `Redact` page, add a workspace UI that renders PDFs, lets the user draw redaction boxes, and applies *permanent* destructive redaction via pdf-lib + PDF.js + Fabric.js, with Web Worker processing.

---

## 1. Architecture Overview

```
Route /redact ──► pages/Redact.tsx  (state owner: uploaded files)
                    │
                    ├── [step 1] DocumentUpload (existing, now controlled via onProceedToRedact)
                    │              └─► onProceedToRedact(files) → lifted into Redact page state
                    │
                    └── [step 2] RedactWorkspace (new)
                                 ├── DocQueuePanel      — select / remove queued PDFs
                                 ├── PdfViewer          — PDF.js render → <canvas> + TextLayer overlay
                                 ├── FabricOverlay      — fabric.js canvas on top, redaction shapes
                                 ├── Toolbar            — draw / select / delete / zoom / page nav
                                 └── ExportBar          — "Apply Redactions"
                                     └─► RedactionEngine (pdf-lib destructive strip + burn + flatten)
                                        └─► [step 3] Confirm — per file, sequential
                                             ├── "Confirm" is shown for EVERY file with redactions
                                             │   (redaction count summary + destructive-intent warning
                                             │    + background flatten job w/ progress for that file)
                                             └─► once all files are confirmed
                                                 └─► [step 4] DownloadPage (single final stage)
                                                      └── lists ONLY confirmed files, Blob URL download(s)
```

### Key decisions
- **Single route, two internal steps.** Files live in `Redact` page state. No router-state gymnastics; the workspace is rendered in-place when files are ready. This also means "Open Redaction Workspace" in `UploadDocument` becomes functional.
- **Main thread renders, worker parses/processes.** Fabric + DOM canvas need the main thread; heavy parsing and final binary flattening go to a Web Worker.

---

## 2. Dependencies & Setup

| Package | Purpose |
|---|---|
| `pdfjs-dist` | PDF parsing + rendering + TextLayer (`TextLayer` class export) |
| `pdf-lib` | Destructive content-stream editing, vector burning, page flattening, save |
| `fabric` (v6, ESM) | Drawing overlay (`Canvas`, `Rect`, etc.) |

Setup steps:
1. `npm i pdfjs-dist pdf-lib fabric`
2. PDF.js worker wiring for Vite (both app worker and our own worker):

```ts
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
).toString();
```

3. PDF.js ships its own types; `fabric` v6 ships ESM types. No `@types/*` needed.

---

## 3. Data Flow (raw binary, ArrayBuffer ⇄ Blob)

1. **Read raw bytes** — `await file.arrayBuffer()` per queued file. No object URL for parsing; pass the `Uint8Array` directly to PDF.js (`getDocument({ data })`) to avoid blob lifecycle issues.
2. **Transfer to worker** — `postMessage({ buffer, fileId }, [buffer])` (transferable → zero-copy, main-thread GC pressure removed).
3. **Parse in worker** (PDF.js): page count, per-page text content items (with exact bounding boxes in PDF space), dimensions.
4. **Render on main thread** from the parsed data.
5. **Export** — pdf-lib `doc.save()` returns `Uint8Array` → wrap in `new Blob([bytes], { type: 'application/pdf' })` → `URL.createObjectURL(blob)` → the **Blob URL is collected per confirmed file** → **`DownloadPage` lists only the confirmed files** with download buttons → **`URL.revokeObjectURL(url)` after download / on unmount**.

---

## 4. Page & Component Breakdown

### 4.1 `src/pages/Redact.tsx` (new)
- Owns `files: UploadedFileItem[]` state.
- Renders `DocumentUpload` with `onProceedToRedact={setFiles}` when no files yet.
- Renders `<RedactWorkspace files={files} onReset={...} />` once files exist (with a "back to upload" affordance).

### 4.2 `src/Routes.tsx`
- Change `/redact` from `DocumentUpload` → `Redact` page.

### 4.3 `src/features/redact/components/`
- `RedactWorkspace.tsx` — container/layout + selected-file state + apply/export orchestration.
- `DocQueuePanel.tsx` — queue list, active selection, remove file.
- `PdfViewer.tsx` — PDF.js render into `<canvas>`, zoom + page nav, `page.cleanup()` on page change.
- `TextLayerOverlay.tsx` — absolutely-positioned `TextLayer` on top of the canvas (clickable text runs → auto-create redaction rect).
- `FabricOverlay.tsx` — fabric canvas sized 1:1 with the PDF canvas (CSS px); rectangle-draw tool, select/move/resize/delete, undo.
- `Toolbar.tsx` — tool selection, zoom, page controls.
- `ConfirmRedactionDialog.tsx` — shown **per file** after "Apply Redactions", one file at a time through the queue: destructive-intent warning (irreversible) + that file's redaction count, runs its background flatten job with progress, then advances to the next file. Files with no redactions are auto-skipped (treated as confirmed/pass-through).
- `DownloadPage.tsx` — **single final stage**, reached only after every file has been confirmed: lists the confirmed files, per-file download buttons wired to the **Blob URL** (`URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))`), and "download all". Revokes URLs on unmount / re-run.

### 4.4 `src/features/redact/lib/`
- `coordinates.ts` — PDF ⇄ canvas conversions.
- `pdfWorker.ts` — worker client wrapper (typed postMessage protocol).
- `redactionEngine.ts` — pdf-lib destructive stripping/burning/flattening.
- `memory.ts` — canvas/context disposal helpers, URL revoking.

### 4.5 `src/features/redact/workers/pdfProcessor.worker.ts`
- Receives transferred `ArrayBuffer`, runs PDF.js parse + (later) pdf-lib flattening, returns results; receives `Uint8Array` back with transfer list.

---

## 5. Rendering Pipeline (PDF.js + Canvas + Text Layer)

1. **Viewport / DPI math** — PDF user space is **72 DPI, origin bottom-left**; canvas CSS pixels are **~96 DPI, origin top-left**.
   - `BASE_SCALE = 1.5` (≈108 px/in — matches the "96+" target), multiplied by `devicePixelRatio` for rendering sharpness while layout stays in CSS px.
   - `page.getViewport({ scale })` produces the top-left-origin viewport — use its `convertToPdfPoint(x, y)` / `convertToViewportPoint(x, y)` for all conversions (handles rotation too).
2. **Render** — `page.render({ canvasContext, viewport })`, canvas sized `viewport.width × viewport.height`.
3. **Text layer** — `page.getTextContent()` + pdfjs-dist `TextLayer` class over the canvas (handles per-span transforms). Used for: PII scanning hooks + click-to-redact text runs (rect = item's bounding box converted via viewport).

---

## 6. Fabric Overlay & Coordinate Conversion

- Fabric canvas is **stacked directly above** the PDF canvas, identical CSS size → fabric coordinates are 1:1 with canvas CSS px. No fabric-side transform needed.
- **PDF ⇄ canvas conversion** (`coordinates.ts`), used when creating/exporting redactions:

```
canvasPoint → pdfPoint: viewport.convertToPdfPoint(x, y)   // canvas top-left → PDF bottom-left
pdfPoint   → canvasPoint: viewport.convertToViewportPoint(x, y)
```

- Redaction shapes stored in PDF-point space (source of truth), because that's what survives zoom/page changes; fabric objects are re-materialized from them.
- Tools: draw rectangle (left-drag), select/move/resize, delete, undo stack (fabric `Canvas#discardActiveObject` + manual undo array).

---

## 7. Web Worker & Transferable Objects

- **Parse worker**: `pdfProcessor.worker.ts`.
  - Input: `ArrayBuffer` (transferred, zero-copy).
  - Work: `pdfjsLib.getDocument({ data })` → page count, per-page `getTextContent()` items + transforms → **structured-clone-safe summary** (no PDF.js proxies leave the worker).
  - Output: transferred results; progress messages (`{ progress: 0..1 }`).
- **Flatten worker** (same file, different message type): receives redaction ops + transferred original buffer → runs pdf-lib pipeline → returns `Uint8Array` with transfer list.
- **Lifecycle**: keep one worker per active document; `worker.terminate()` when the file is removed or the workspace unmounts.

---

## 8. Destructive Redaction Engine (pdf-lib)

Order of operations per page:

1. **Coordinate mapping** — redaction rects stored in PDF points (from §6) → clamp to page bounds.
2. **Destructive text stripping (low-level content stream rewrite):**
   - Read the page's content streams: `page.node.Contents()` → `PDFRawStream`.
   - `parseContentStream(...)` → operator list; run a **text-position tracking mini-interpreter** to know where each text-showing op lands:
     - track `cm`/`Tm`/`Td`/`TD`/`T*`/`TL`/`Tf` (current text matrix + line matrix + font size),
     - strip text-showing ops (`Tj`, `TJ`, `'`, `"`) whose computed baseline box **intersects** a redaction rect,
     - rebuild + write back the filtered stream via pdf-lib `ContentStream` / `PDFOperator`.
   - **Accuracy cross-check:** PDF.js `getTextContent()` gives exact per-item boxes in PDF space — use it to compute expected intersections, and validate the interpreter's output during development (dev-mode assertion).
3. **Vector burning** — `page.drawRectangle({ x, y, width, height, color: black, opacity: 1 })` for every rect so the redacted area is a **permanent page-content fill**, independent of the stripped text.
4. **Page flattening** — normalize multi-part content (`page.node.normalize()`), strip now-empty annotations (`page.node.Annots()` cleanup) so nothing (incl. redaction annotations, links, highlights) can be lifted by later tools.
5. **Save** — `pdfDoc.save()` → `Uint8Array`.

> Trade-off to accept & document: pdf-lib re-serialization is destructive to *some* exotic PDF features (forms, signatures). Flagged as a known limitation; acceptable for a redaction tool.

---

## 9. Blob / ArrayBuffer Handling

- All parsing uses `Uint8Array` views over `ArrayBuffer`s (raw binary).
- Blob only at boundaries: export/download (`Blob → createObjectURL`), and re-fetching a file as `arrayBuffer()` when re-processing after queue edits.
- Every created object URL is revoked on unmount/file removal (memory.ts helper).

---

## 10. Memory Management

| Concern | Mitigation |
|---|---|
| PDF.js page objects | `page.cleanup()` when leaving a page / before re-render (frees worker-side structures & canvas textures) |
| 2D contexts are not GC-friendly | `canvas.width = 0; canvas.height = 0` (forces context teardown), never rely on `clearRect`/reassignment alone |
| Fabric instance | `fabricCanvas.dispose()` on page switch/unmount |
| Worker threads | `worker.terminate()` on remove/unmount |
| Transferred buffers | ArrayBuffers moved via transfer list (main thread doesn't retain copies) |
| Object URLs | `URL.revokeObjectURL(url)` after use |
| Large PDFs | Progressive render (render page only when visible); optional page-count cap warning |

---

## 11. Task List

### M1 — Setup & dependencies
- [x] Add `pdfjs-dist`, `pdf-lib`, `fabric`
- [x] Wire PDF.js worker for Vite (app + own worker)
- [x] Verify all three libs import cleanly under TS strict mode

### M2 — Redact page + state lift + routing
- [x] Create `src/pages/Redact.tsx` owning `files` state; render upload step or workspace
- [x] Pass `onProceedToRedact={setFiles}` to `DocumentUpload`
- [x] Update `/redact` route → `Redact` page

### M3 — Workspace skeleton
- [x] `RedactWorkspace` container: DocQueuePanel + canvas area + Toolbar + ExportBar layout
- [ ] `file.arrayBuffer()` reader + typed worker-client stub

### M4 — PDF rendering (PDF.js + canvas + TextLayer)
- [x] `PdfViewer`: render page to canvas at BASE_SCALE, page nav
- [x] `TextLayerOverlay` with pdfjs-dist `TextLayer`
- [x] `coordinates.ts`: viewport-based PDF ⇄ canvas conversion utilities

### M5 — Fabric overlay & tools
- [x] `FabricOverlay` synced 1:1 with canvas (CSS px)
- [x] Rectangle draw tool, select/move/resize/delete, undo
- [x] Persist shapes in PDF-point space; re-materialize fabric objects per page

### M6 — Web Worker parsing
- [x] Worker-safe engine refactor: PDF.js usage removed from the flatten engine (pure pdf-lib), DEV-only cross-check moved to main-thread `crossCheck.ts`; `computeClampedByPage` extracted for reuse
- [x] `pdfProcessor.worker.ts`: single pure-pdf-lib flatten worker per confirm session; typed postMessage protocol (`pdfWorkerProtocol.ts`); source ArrayBuffer transferred zero-copy in, result bytes (exact-length copy) transferred back
- [x] Worker lifecycle: lazy create on first job, `terminate()` on last-file done, skip-to-download, edit-again, back-to-upload, and unmount
- [x] Verified: `vite build` splits the worker chunk (433 kB pdf-lib only; PDF.js worker stays a separate main-thread chunk); functional smoke test (Vite SSR in Node) — file routing, zero-copy transfer, HELLO/WORLD stripped from the LIVE content stream, adjacent KEEP ME run preserved, opaque burn rect at `95 235 cm` + `h/f`, progress ≥ 1, strip/burn counters ≥ 1

> Note (plan §4.4 originally called for PDF.js parsing inside the worker): parse + render
> already run inside PDF.js's own worker (`pdf.ts` wires `GlobalWorkerOptions.workerPort`); the
> M6 worker pragmatically hosts the flatten job only, which is the heavy binary pass.
> Orphaned original content streams used to remain in the output (pdf-lib writes all registered
> objects); M10 now zeroes their payloads after replacement, so the pre-redaction text is byte-gone.

### M7 — pdf-lib destructive redaction
- [x] Content-stream rewrite: text-position interpreter + strip `Tj/TJ/'/"` intersecting rects
- [x] Vector burning (`drawRectangle`) + page flattening (`normalize` + annotation cleanup)
- [x] Dev-mode cross-check of stripped ops vs PDF.js text-item boxes
- [x] Save → `Uint8Array` → Blob → Blob URL (revoked after download)

> M7 verified by functional smoke test (Node, Vite SSR load of the real engine):
> HELLO run stripped from a shared content stream while adjacent WORLD / SECOND LINE runs and an
> untouched second page survive byte-identically; opaque burn rect present; output re-parses cleanly.

### M8 — Confirm (per file) & Download (final stage)
- [x] `ConfirmRedactionDialog`: destructive-intent warning (irreversible) + per-file redaction count summary
- [x] Sequential per-file confirm flow: file → confirm → background flatten job w/ progress → next file; files without redactions auto-skip
- [x] Per-confirmed-file Blob URLs collected as each file is processed
- [x] `DownloadPage` (single final stage, after ALL confirms): lists only confirmed files, per-file download buttons, "download all"
- [x] Flow transitions: workspace → confirm queue → download; "edit again" returns to the workspace with redactions intact; "back to upload" resets cleanly

> Note: the flatten job runs in the M6 worker (async `redactPdf` with per-page
> `onProgress` feeding the dialog, contract `onProgress: 0..1` worker-ready as-is). Skipped/cancelled files never reach
> the download page; Blob URLs are revoked on re-edit, unmount, and back-to-upload.

### M9 — Memory hardening
- [x] `page.cleanup()` (PdfViewer effect teardown), canvas backing-store zeroing (PdfViewer + FabricOverlay), fabric `dispose()`, worker termination (every exit path), URL revocation (incl. DownloadPage via parent-owned URLs) — all wired through lifecycle; `npx tsc -b` clean

### M10 — Edge cases & manual QA
- [x] Encrypted/password-protected PDFs — engine catch adds "password-protected or encrypted" hint; PdfViewer surfaces PDF.js error; no crash
- [x] Rotated pages — `viewportRectToPdf` converts both corners via `convertToPdfPoint` (rotation-safe); multi-content-stream pages handled via `PDFArray` walk in `processPage`
- [x] Large file (25MB) render responsiveness — async render with spinner; per-file progress bar in confirm dialog; worker offloads the binary pass
- [x] Double-redaction overlap (re-burn is visually idempotent — opaque black over black), zero-size rects rejected at draw time (FabricOverlay `<1px` guard) and in the engine (`> 0.01` filter)
- [x] "Back to upload" resets workspace cleanly — `onReset` clears files + bumps `workspaceSession` key → full remount, worker terminated, URLs revoked
- [x] Text is truly gone (not just covered): content-stream rewrite strips text-show ops AND the M6 orphaned-stream leak is fixed — original streams' payloads are zeroed after replacement. Verified by SSR smoke: re-parse output, scan EVERY registered object's bytes → `HELLO`/`WORLD` absent everywhere, `KEEP ME` survives, burn rect + counters correct (5/5)
- [x] Download page: already-started downloads survive URL revocation (anchor fetches blob synchronously); re-run after revocation works (new confirm session → fresh URLs)

---

## 12. Open Questions for Review

1. **BASE_SCALE value** — 1.5 proposed (≈108 px/in). OK, or fixed 96/1.333 / 2?
2. **Worker scope** — parse + flatten both in worker (recommended), or flatten on main thread first pass?
3. **Text stripping strategy** — accept "op-level strip + always burn a fill rect underneath" (recommended), i.e. burn as the guarantee, strip as the *permanent* removal?
4. **Export format** — same name + `_redacted` suffix? Batch export (zip) now or later?
5. **Scope guard** — should Home-page CTAs also link to `/redact` in this iteration, or strictly the workspace flow only?

> **Decided (2026-09-08):** Q6 — per-file confirm is shown sequentially for every redacted file (no-redaction files auto-skip), then a single final `DownloadPage` lists only the confirmed files. A file whose confirm is skipped/cancelled simply doesn't appear on the download page.
