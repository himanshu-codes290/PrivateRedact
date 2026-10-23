# 1. Project overview

## The problem

People redact PDFs before sharing them: court filings, medical records, HR documents, invoices. The
most common mistake is **covering** text instead of **removing** it. A black rectangle drawn on top
of a PDF hides the words from the eye, but the text is still in the file. Anyone can select it,
copy it, search for it, or run a text extractor. Real-world leaks from exactly this mistake are
well documented (court filings, government reports, corporate disclosures).

The second problem is privacy of the tool itself. Most online redaction services ask you to upload
the very document you are trying to protect.

## What PrivateRedact does

PrivateRedact is a web app that redacts PDFs **entirely in the browser**:

1. You choose one or more PDFs. They are read from disk into memory; nothing is uploaded.
2. You mark what to remove on any page (a thumbnail strip on the right shows every page and
   where your boxes are): draw boxes, or select text with the text tool. You can move, resize,
   delete, undo and redo, on any page, at any zoom level.
3. You apply. For each file, a Web Worker rewrites the PDF so that:
   - every glyph of text under a box is deleted from the page's content stream, while text next to
     the box keeps its exact position;
   - text inside reusable page templates (Form XObjects) is handled the same way;
   - images fully inside a box are deleted;
   - annotations, links and form fields touching a box are deleted;
   - document metadata, XMP, bookmarks, attachments and JavaScript are stripped;
   - opaque black boxes are painted on top, so the result also _looks_ redacted.
4. The output is re-opened with PDF.js, a different parser, which extracts text and checks that
   nothing is left under any box. The file is marked **Verified**, **Review** or **Text found**.
5. You preview and download each file, or download all of them as a ZIP.

## Who it is for

Anyone who needs to share a PDF with parts removed and does not want to send it to a third party:
individuals, small legal and HR teams, journalists, developers. It needs nothing installed beyond a
modern browser, and it can be installed as a PWA for offline use.

## The privacy model

| Promise                      | How it is enforced                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Files never leave the device | There is no backend. Files are read with `File.arrayBuffer()` and processed in memory.                                                      |
| Nothing phones home          | Production builds ship a Content-Security-Policy with `connect-src 'self'`. Fonts and PDF.js assets are self-hosted; there is no analytics. |
| Works offline                | A service worker (Workbox via `vite-plugin-pwa`) precaches the whole app, including PDF.js WASM decoders and CMaps.                         |
| Nothing lingers              | Blob URLs are revoked when you leave the workspace; the worker and the PDF.js worker are terminated.                                        |

## What "redacted" means here, precisely

| Content under a box                                           | Result                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Text drawn with a font (including invisible OCR text)         | **Removed** glyph by glyph; surrounding text unchanged.                                                    |
| Text inside a Form XObject (templates, flattened form fields) | **Removed** in a private copy of the form; other pages using the form are untouched.                       |
| An image entirely inside a box (≥ 98 % covered)               | **Removed** (the image object is no longer referenced and is garbage-collected).                           |
| An image partly inside a box                                  | **Covered only**, and the user gets a warning.                                                             |
| Vector drawings, text converted to outlines, scanned pages    | **Covered only**; a warning appears if nothing removable was found under a box.                            |
| Annotations (comments, links, highlights) touching a box      | **Removed**, with their pop-ups and replies.                                                               |
| Form field values                                             | Form is flattened first so values become page text; touching widgets are removed and their values cleared. |
| Document-level data                                           | Info dictionary, XMP, outlines, attachments, JavaScript, structure tree, thumbnails: **removed**.          |

## Known limitations

- **Partly covered images stay in the file.** Removing part of an image means decoding, editing and
  re-encoding pixels (JPEG, JPEG 2000, JBIG2, CCITT…). This is the top roadmap item.
- **No OCR.** A scanned page is an image; there is no text to remove. Covering it is the best the
  tool can do without OCR, and it says so.
- **Encrypted PDFs are refused** because pdf-lib cannot decrypt. PDF.js can still display them, so
  the app detects encryption at upload and explains how to remove protection.
- **No automatic PII detection.** The user decides what to mark. Pattern-based search-and-redact is
  a natural next feature.
- **Desktop first.** The workspace works on tablets, but drawing precise boxes is a desktop task.

## Elevator pitches

**30 seconds.** "PrivateRedact is a browser-only PDF redaction tool. The common failure in
redaction is drawing a black box over text that is still in the file. My app actually deletes the
text from the PDF's content streams, glyph by glyph, plus images, annotations and metadata, and then
verifies the result with a second PDF parser. It runs entirely client-side in a Web Worker, so the
document never leaves the user's machine."

**Two minutes.** Add: the stack (React 19, TypeScript, Vite, PDF.js for rendering, Fabric.js for the
drawing layer, pdf-lib as the low-level object model), the hardest problem (mapping a box on screen
to the glyphs in a content stream, which means re-implementing the PDF text matrix maths and font
metrics), the safety net (independent verification, fail-closed errors, garbage collection of
unreachable objects), and the engineering story (an audit that found real leaks, which are now
regression tests). See [05-interview-qa.md](05-interview-qa.md).
