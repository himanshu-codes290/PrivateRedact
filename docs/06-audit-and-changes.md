# 6. Audit and changes (October 2026)

This document records the evaluation of the project as it stood at commit `61849e9`, what was wrong,
what was changed, and the evidence. It is the "before and after" story.

## Summary

The app looked finished, and the design doc marked most milestones as done, but:

- it could only redact **page 1** of a PDF;
- the engine **leaked** redacted text through several routes and could **hang forever** on
  malformed input;
- the marketing copy made **claims the product did not meet** (AES-256, HIPAA/GDPR compliance, AI
  PII detection, pricing tiers);
- the repo had **no tests, no CI**, a broken `.gitignore`, and committed machine-local settings.

All of these are fixed, or are now documented limitations that the app warns about.

## Baseline vs. now

| Metric               | Before                                                                | After                                                                                                                             |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tsc -b` (strict)    | pass (strict implicit)                                                | pass, with explicit `strict` and `noUncheckedIndexedAccess`                                                                       |
| ESLint               | **6 errors, 3 warnings**                                              | 0 errors, 0 warnings, now with type-aware rules                                                                                   |
| Tests                | **none**                                                              | 84 tests in 7 files; ~90 % line coverage on the engine                                                                            |
| CI                   | none                                                                  | GitHub Actions: format, lint, typecheck, tests + coverage, build                                                                  |
| Landing-page JS      | **1,445 KB** (489 KB gzip), one chunk incl. PDF.js + Fabric + pdf-lib | **252 KB** (80 KB gzip); PDF.js and Fabric lazy; pdf-lib only in the worker                                                       |
| Third-party requests | Google Fonts on every page load                                       | none (CSP `connect-src 'self'`)                                                                                                   |
| Pages redactable     | page 1 only                                                           | all pages                                                                                                                         |
| Browser smoke test   | none                                                                  | upload → draw (pages 1 and 3) → undo/redo/zoom → apply → verified → download → scan output; 0 console errors, 0 external requests |

## Evidence: original engine vs. new engine

Both engines were run on the same generated PDFs. "Leaks" lists where the secret was still found
in the output (raw bytes or a decoded object).

| Case                                      | Original engine                          | New engine                                    |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Box over "HELLO" in `(HELLO WORLD) Tj`    | no leak, but **"WORLD" also deleted**    | only HELLO removed; WORLD stays at x = 171.14 |
| `[(SECRET) 12000 (x)] TJ` (large kerning) | no leak, but **"x" deleted**             | only SECRET removed                           |
| `cm` + font in stream 1, text in stream 2 | **SECRET in raw bytes and visible text** | removed                                       |
| Text inside a Form XObject                | **SECRET in raw bytes and visible text** | removed                                       |
| Image fully under a box                   | **pixel data still in file**             | removed                                       |
| Document title metadata                   | **kept in /Info**                        | scrubbed                                      |
| Annotation under a box                    | **orphaned annotation still written**    | removed                                       |
| `[/X (y)] TJ`                             | **never returns** (infinite loop)        | completes in milliseconds                     |

## Findings and resolutions

### A. Product and UI

| #   | Finding                                                                                                                                                                                                                                                                                | Resolution                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Only page 1 rendered and redacted (`getPage(1)` hard-coded; boxes stored per file).                                                                                                                                                                                                    | Page navigation; boxes stored per file **and page**; engine receives all pages.                                                                                 |
| A2  | No zoom despite the design doc.                                                                                                                                                                                                                                                        | Fit page, fit width, 25–400 % steps, keyboard shortcuts.                                                                                                        |
| A3  | "Undo" removed the last box only; no redo; Clear had no confirmation.                                                                                                                                                                                                                  | Reducer with full undo/redo history; Clear asks first and is undoable.                                                                                          |
| A4  | Delete with multiple boxes selected did nothing.                                                                                                                                                                                                                                       | Uses `getActiveObjects()`; removes all selected.                                                                                                                |
| A5  | Text tool turned _any_ selection on the page (e.g. sidebar text) into off-page boxes.                                                                                                                                                                                                  | Only selections inside the PDF text layer count.                                                                                                                |
| A6  | False claims: AES-256, "military-grade encryption", HIPAA/GDPR compliant, on-device AI, PII detection in Word/images, metadata destroyed, $12/month Pro and Enterprise tiers, a "Log in" button with no handler, footer links to `#`, a demo video that 404s, and a typo ("AdvanceS"). | Home page rewritten to describe what the tool really does, with a "Removed vs. know the limits" section; real Privacy page; footer links to source and licence. |
| A7  | Google Fonts loaded on every visit while claiming nothing leaves the device (Inter was already bundled).                                                                                                                                                                               | Removed; fonts self-hosted; CSP enforces it.                                                                                                                    |
| A8  | Whole PDF re-read and re-parsed on every resize; page flickered to a placeholder.                                                                                                                                                                                                      | Document parsed once per file and reused.                                                                                                                       |
| A9  | Confirm dialog not accessible (no role, focus trap, Escape); keys reached the canvas behind it.                                                                                                                                                                                        | Accessible modal; overlay and shortcuts disabled while open.                                                                                                    |
| A10 | "Download all" fired N timed clicks; possible Blob URL leak on unmount.                                                                                                                                                                                                                | ZIP download; every URL tracked and revoked; async work guarded by a session counter.                                                                           |
| A11 | Engine statistics never shown: a scanned page with 0 characters removed looked identical to success. No Cancel.                                                                                                                                                                        | Per-file report, warnings and verification badge; Cancel terminates the worker.                                                                                 |
| A12 | Upload accepted renamed non-PDFs; `any` types; fake progress fields; no duplicate or size limits; encrypted files failed only at the end.                                                                                                                                              | Signature check, duplicate and limit checks, typed rejections, encryption detected at upload.                                                                   |

### B. Redaction engine

| #   | Finding                                                                                                                          | Resolution                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| B1  | Tokenizer infinite loops on nested parentheses, stray delimiters and names inside arrays.                                        | New tokenizer always advances; nesting capped; regression tests.                                   |
| B2  | `q`/`Q` saved only the CTM, not text state.                                                                                      | Full graphics state on the stack.                                                                  |
| B3  | Each `/Contents` stream interpreted with fresh state.                                                                            | Streams concatenated, as the spec defines.                                                         |
| B4  | Whole text operator removed if any glyph touched a box.                                                                          | Glyph-level removal.                                                                               |
| B5  | Removing an operator shifted the following text; `'`/`"` side effects lost.                                                      | Removed glyphs become exact `TJ` adjustments; `T*`/`Tw`/`Tc` preserved.                            |
| B6  | `TJ` box used the net advance: large kerning hid glyphs from the box test.                                                       | Per-glyph boxes.                                                                                   |
| B7  | 2-byte CID fonts read byte by byte; CMap stream encodings crashed the job; `Ts` ignored.                                         | Codespace-aware code splitting, CID widths, embedded CMap parsing, tolerant lookups, rise applied. |
| B8  | Form XObjects never inspected.                                                                                                   | Recursive interpretation with copy-on-write forms and resources.                                   |
| B9  | Images under boxes never removed.                                                                                                | Fully covered images removed; partial coverage reported.                                           |
| B10 | Removed annotations still written as orphan objects; reversed `/Rect` and inline annotations missed; popups and replies kept.    | Normalised rects, inline support, popups and replies removed, objects deleted.                     |
| B11 | Metadata kept (`updateMetadata: false` and nothing else).                                                                        | Document sanitiser (see the engine deep dive).                                                     |
| B12 | Zeroing an original content stream blanked other pages sharing it.                                                               | Originals never mutated; unreachable ones garbage-collected.                                       |
| B13 | Undecodable streams silently skipped; progress hit 100 % before saving; output uncompressed; spliced tokens could glue together. | Typed fail-closed errors; weighted progress; Flate output; edits padded with spaces.               |
| B14 | pdf-lib in the main bundle; PDF.js worker created at import time and never terminated.                                           | Engine only in the worker; PDF.js loaded and released on demand.                                   |
| B15 | Worker jobs keyed by file id; no cancel, timeout or `onmessageerror`; crashed worker reused.                                     | Job ids, cancel, watchdog, crash handling.                                                         |
| B16 | No tests for 1,100 lines of security-critical parsing.                                                                           | 50 engine tests with a leak scanner and PDF.js as an independent oracle.                           |

### C. Repository and tooling

| #   | Finding                                                                                                                                                          | Resolution                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C1  | Root `.gitignore` and `README.md` saved as UTF-16, so git ignored nothing and GitHub showed the README as binary.                                                | Rewritten as UTF-8; `.gitattributes` and `.editorconfig` added.               |
| C2  | `.claude/settings.local.json` and two conflicting `launch.json` files committed.                                                                                 | Untracked (`git rm --cached`) and ignored.                                    |
| C3  | `shadcn` (a CLI) and `cn` (an unrelated package) as runtime dependencies; build tools in `dependencies`; unused `@base-ui/react` and `class-variance-authority`. | Removed or moved to `devDependencies`; `engines`, licence and metadata added. |
| C4  | Dead code: six unused UI components, empty `App.css`, duplicate favicon, icon set duplicating lucide, a video modal pointing at a missing file.                  | Deleted.                                                                      |
| C5  | Nested README was the Vite template; design doc mixed with source.                                                                                               | Developer README written; design doc archived with a divergence note.         |
| C6  | No tests, CI, formatter, error boundary, 404 page, code splitting, CSP, PWA, or meta description.                                                                | All added.                                                                    |

## Design doc vs. reality

The archived plan (`docs/archive/redact-workspace-plan.md`) marked these as done. They were not:

| Plan said                                            | Reality before this work                                 |
| ---------------------------------------------------- | -------------------------------------------------------- |
| Page navigation and zoom (M4)                        | Page 1 only, no zoom                                     |
| Undo stack (M5)                                      | Removed the last box only                                |
| Shapes persisted per page (M5)                       | Stored per file                                          |
| `TextLayerOverlay.tsx`, `memory.ts`, `ExportBar`     | Did not exist                                            |
| "Text is truly gone … every registered object" (M10) | Text in forms, images, annotations and metadata survived |
| Encrypted PDFs handled (M10)                         | Error at the very end only                               |

## Remaining limitations (by design, warned in the UI)

1. Partly covered images: hidden, not removed.
2. Scans and vector-outlined text: hidden, not removed.
3. Encrypted PDFs: refused.
4. Predefined CJK CMaps: conservative whole-operator removal.

## Not done in this pass

- `eslint-plugin-jsx-a11y` is not yet compatible with ESLint 10; accessibility is covered by
  role-based component tests instead.
- The browser smoke test is a script, not yet a Playwright test in CI.
- No deployment target was chosen; see [07-deployment.md](07-deployment.md).
