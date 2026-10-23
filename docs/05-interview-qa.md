# 5. Interview Q&A

Answers are short on purpose: say the answer, then offer the detail if asked. File paths point to
where you can show the code.

## Pitch and motivation

**Q1. What is the project, in one sentence?**
A browser-only PDF redaction tool that deletes the marked content from the file (not just covers it)
and verifies the result with a second PDF engine, without the document ever leaving the device.

**Q2. Why build it? Aren't there existing tools?**
Most online tools require uploading the sensitive file, and many "redaction" features only draw
black boxes. I wanted something private by construction and honest about what it removes. It was
also a way to learn PDF internals properly.

**Q3. What was the hardest part?**
Mapping a rectangle on screen to the exact glyphs inside a content stream. PDFs have no "text box"
objects, just operators that place byte strings with a text matrix, so I re-implemented the parts of
the graphics model that decide where each glyph lands: CTM, text and line matrices, font size,
spacing, rise, horizontal scaling, and per-font glyph widths, including 2-byte CID fonts. Then I
rewrote the operators so removed glyphs become positioning adjustments and the remaining text does
not move. See `engine/interpreter.ts` and [04-redaction-engine-deep-dive.md](04-redaction-engine-deep-dive.md).

**Q4. What are you most proud of?**
The verification loop. The engine (pdf-lib, in a worker) writes the file, and PDF.js, an unrelated
parser, reads it back and counts characters still under a box. Combined with the test leak
scanner, which searches every object for the secret in plain, hex and UTF-16 forms, I can show
evidence rather than just claim the redaction works.

## Architecture

**Q5. Walk me through the architecture.**
Three threads in one tab. The main thread runs React, the Fabric drawing layer and PDF.js
rendering. A PDF.js worker parses and renders. A redaction worker runs the engine. Boxes live in a
reducer in PDF coordinates. On apply, each file's bytes are transferred to the worker, which returns
redacted bytes and a report. The main thread verifies with PDF.js, then offers download.
See [02-architecture.md](02-architecture.md).

**Q6. Why a Web Worker?**
Redaction of a large PDF is CPU-bound for seconds. On the main thread that freezes input and
rendering. A worker keeps the UI responsive, shows progress, and can be killed for cancellation or
if a hostile file makes it spin.

**Q7. How do you cancel work in a worker?**
You cannot interrupt synchronous JavaScript, so `cancel()` calls `worker.terminate()` and the
client lazily creates a fresh worker for the next job. On the main side a session counter is
incremented, and every `await` checks it, so a late result from the abandoned job is ignored.

**Q8. How do you avoid copying a 25 MB file between threads?**
`postMessage(msg, [buffer])` _transfers_ the `ArrayBuffer`: ownership moves and the sender's copy is
detached. The result buffer is transferred back the same way.

**Q9. Why does the engine not import any UI code?**
So it runs identically in the worker and in Node for tests, and so pdf-lib never lands in the main
bundle. The UI imports only _types_ from the engine (erased at compile time). I verified in the
build output that pdf-lib appears only in the worker chunk.

**Q10. How is state managed? Why not Redux or Zustand?**
Boxes are in a `useReducer` keyed by file and page, with immutable updates and undo/redo stacks of
previous states. It is local to one screen with a handful of actions; a pure reducer is the simplest
thing that is easy to test. If several screens needed it I would lift it into Zustand.

**Q11. How does undo/redo work, and what does it cost?**
Each change pushes the previous `byFile` object onto `past`. Updates copy only the changed file and
page, so snapshots share everything else (structural sharing). History is capped at 100. No-op
actions return the same state object so they do not pollute history.

**Q12. How do Fabric.js and React stay in sync?**
React state is the source of truth and Fabric is a view. User gestures dispatch actions; a
`reconcile()` function diffs the store against Fabric objects by id and adds, moves or removes
objects. Undo, redo, zoom and page changes then need no special code. The original code had the
opposite design, which is why undo only removed the last box and multi-select delete did nothing.

**Q13. Explain the coordinate systems.**
PDF user space has the origin at the bottom-left, in points. The screen has it at the top-left, in
CSS pixels, scaled by zoom and possibly rotated. Boxes are stored in PDF space because it is stable
across zoom and rotation. PDF.js' viewport gives the transforms (`convertToPdfPoint` and back); I
convert both corners and normalise with min/abs so rotated pages work.

## PDF and the engine

**Q14. What is a content stream?**
A postfix program of operators that paints the page, for example `BT /F1 12 Tf 72 700 Td (Hi) Tj ET`.
Text exists only as strings passed to text-showing operators.

**Q15. How do you compute where a glyph is?**
Glyph matrix = `[fontSize × hScale, 0, 0, fontSize, pen, rise] × textMatrix × CTM`. Apply it to the
glyph's box (width from the font, ascent and descent from the descriptor). The advance is
`(width × fontSize + charSpacing + wordSpacing if it is a single-byte space) × hScale`.

**Q16. How do you remove some glyphs of a `Tj` without moving the rest?**
Rewrite it as a `TJ` array. Kept glyphs go in hex strings; each removed glyph becomes a number equal
to minus its advance in thousandths of the font size. Example from the tests:
`(HELLO WORLD) Tj` becomes `[-3279 <20574f524c44>] TJ`, and WORLD stays at x = 171.14.

**Q17. What about CID / CJK fonts?**
Type0 fonts use multi-byte codes defined by a CMap. For `Identity-H` each glyph is 2 bytes and
CID = code; for embedded CMaps I parse the codespace ranges and CID mappings. Widths come from the
descendant font's `/W` array. Reading 2-byte fonts byte by byte was one of the original bugs.

**Q18. What is a Form XObject and why does it matter?**
A reusable content stream drawn with `Do`, used for letterheads, stamps and flattened form fields.
Text inside one is still text. I recurse into forms under the right transform, and if anything is
removed I create a _copy_ of the form for that page, so other pages using the form are unaffected.

**Q19. Why did you need garbage collection?**
pdf-lib writes every registered object on save. After replacing a page's content stream, the
original (with the secret) is unreachable but still registered, so it would be written out. The
same applies to removed annotations and leftovers from incremental updates. I walk the graph from
the trailer and delete unreachable objects before saving.

**Q20. What else can leak besides page text?**
Document info and XMP metadata, bookmarks, attachments, JavaScript, form field values, annotation
contents, alt/actual text in the structure tree, page thumbnails, and old object versions. Each is
handled in `engine/sanitize.ts` or `engine/page.ts`.

**Q21. How do you handle images?**
An image is drawn into the unit square under the CTM, so its page box is known. If boxes cover at
least 98 % of it, the draw operator and the resource are removed. Partly covered images are kept
and the user is warned, because removing part of an image needs a decoder and encoder for each
format. That is the top roadmap item.

**Q22. What does "fail closed" mean in your engine?**
If something cannot be inspected safely it is either an error or removed, never silently left. An
undecodable page stream throws; a cyclic or undecodable form touching a box is removed; a font with
unknown widths makes the whole touched operator go; a box with nothing removable under it produces
a warning.

**Q23. How do you treat untrusted PDF input?**
As hostile. The tokenizer always advances and caps nesting, form recursion is depth-limited with
cycle detection, all parsing runs in a worker, and the client has a watchdog timeout. The original
tokenizer had three inputs that looped forever; they are regression tests now.

## Frontend and React

**Q24. How did you code-split, and what changed?**
Routes are `React.lazy`, PDF.js is dynamically imported on first use, and the engine only lives in
the worker. The landing page bundle went from 1,445 KB (489 KB gzip) to 252 KB (80 KB gzip).

**Q25. Give an example of a stale-closure problem and your fix.**
Fabric and `window` listeners are registered once but must see the latest tool, viewport and
callbacks. Re-registering every render is wasteful and racy. `useLatest` stores the latest values
in a ref updated in a layout effect (never during render, which the React Compiler lint flags), and
the long-lived handlers read from it.

**Q26. How did you integrate a library that mutates the DOM (Fabric)?**
Fabric wraps its canvas element in its own `<div>`, which confuses React reconciliation. I give it a
host `<div>` React never renders children into, and create the canvas imperatively. A browser smoke
test caught a subtle bug: the async `dispose()` of the old canvas cleared the host _after_ the new
canvas mounted, wiping it after zoom. Cleanup now removes only its own nodes.

**Q27. How did you handle accessibility?**
Dialogs have `role="dialog"`, `aria-modal`, labelled titles, a focus trap, Escape to close and focus
restore. Toolbar buttons have `aria-label`s and `aria-pressed`; progress uses `role="progressbar"`;
there is a skip link, keyboard shortcuts for every tool, and reduced-motion support. Component tests
query by role and name, so they fail if accessible names regress.

**Q28. How do you handle errors in the UI?**
Typed errors from the engine (`encrypted`, `unreadable`, `undecodable-content`) and the worker
client (`cancelled`, `timeout`, `crashed`) map to specific messages with retry, skip or edit
options. A route-level error boundary shows a recovery screen. There is deliberately no error
reporting SDK, because sending stack traces to a third party would contradict the privacy promise.

## Performance

**Q29. What were the main performance improvements?**

1. The PDF is parsed once per file instead of on every resize.
2. The tokenizer works directly on the decoded bytes instead of first building a latin-1 string copy of every stream.
3. Workers keep the main thread free.
4. Code splitting.
5. Buffers are transferred, not copied.
6. ZIP entries are stored, since PDFs are already compressed.

**Q30. How would you scale to a 500-page document?**
The page-thumbnail panel already renders each thumbnail only when it scrolls near view
(IntersectionObserver) and only once. Next: a virtualised continuous page view in the main area,
process only pages with boxes (already the case), and stream progress per page (already done).
Memory is the limit: keep one parsed document per file and release pages after rendering.

## Security and privacy

**Q31. How do you prove nothing is uploaded?**
There is no backend. Production builds include a CSP with `connect-src 'self'`, so even a
compromised dependency could not send data elsewhere. Fonts and PDF.js assets are self-hosted. In
the browser smoke test I record every request: none leave localhost. Anyone can check the Network
tab.

**Q32. Why `'wasm-unsafe-eval'` in the CSP?**
PDF.js decodes JPEG 2000 and JBIG2 images with WebAssembly. That directive allows compiling WASM
without allowing JavaScript `eval`.

**Q33. What are the residual risks?**
Partly covered images and scanned or vector text are covered but not removed (users are warned).
Context can still leak information, for example the length of a redacted name. A compromised
browser or extension is out of scope. See `SECURITY.md`.

## Testing and quality

**Q34. How did you test something like a PDF engine?**
Fixtures are generated in the tests with pdf-lib's low-level API, so each test hand-writes the
operators it needs (shared streams, forms, CID fonts, hostile input). Assertions use two oracles:
a leak scanner that decodes every object and searches for the secret in several encodings, and
PDF.js text extraction to check that kept text survives at the same coordinates. 84 tests;
about 90 % line coverage on the engine.

**Q35. How do you know your tests would catch the original bugs?**
I ran the original engine from git history against the same fixtures. It leaked text through a
second content stream and through Form XObjects, kept image pixels and the document title, wrote
orphaned annotations, deleted neighbouring text, and hung forever on a `[/X (y)] TJ` operator. All of
these are regression tests now. See [06-audit-and-changes.md](06-audit-and-changes.md).

**Q36. What does CI do?**
GitHub Actions on Node 22 runs format check, type-aware lint with zero warnings, strict typecheck,
tests with coverage, and the production build, then uploads `dist` and the coverage report.

**Q37. Did you test the real UI?**
Yes, with a scripted browser run (playwright-core driving local Edge) against the production build:
upload a 3-page PDF, draw boxes on pages 1 and 3, undo, redo, zoom, apply, check the Verified badge,
download, and scan the output for the secrets. It also asserts zero console errors and zero
requests leaving localhost. That run found the Fabric dispose bug from Q26.

## Trade-offs and what's next

**Q38. What would you do differently or next?**

1. Pixel-level redaction for partly covered images.
2. Search-and-redact with regex/PII patterns.
3. Optional OCR, or a "rasterise page" mode, for scans.
4. Ship CJK CMaps to the worker.
5. Virtualised multi-page view.
6. Promote the scripted browser run to a Playwright test in CI.

**Q39. Why not render server-side or use a native app?**
Server-side breaks the privacy promise. A native app adds install friction and per-OS builds. A
static web app with a strict CSP is private, zero-install, and works offline as a PWA.

**Q40. What did you learn?**
That "it looks redacted" and "it is redacted" are different claims, and only the second can be
tested. That invariants (no secret bytes anywhere in the output) make better tests than examples.
And that a feature list in a design doc means nothing until each item has a test.
