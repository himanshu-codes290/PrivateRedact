# 8. Testing

## Strategy

```
             ┌──────────────────────────────┐
             │  Browser smoke run (manual/  │  real Edge, production build, CSP on
             │  scripted, not yet in CI)    │
             ├──────────────────────────────┤
             │  Component tests (happy-dom) │  dialogs, keyboard shortcuts, a11y roles
             ├──────────────────────────────┤
             │  Unit tests                  │  reducer, intake, coordinates, zip, worker client
             ├──────────────────────────────┤
             │  Engine tests (Node)         │  real PDFs in, leak scan + PDF.js oracle out
             └──────────────────────────────┘
```

Most of the value is in the engine tests, because a redaction bug is a privacy bug.

## Running

```bash
cd PrivateRedact
npm test                # all tests once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report in coverage/index.html
```

## Test files

| File                                    | What it covers                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/__tests__/redactPdf.test.ts`    | End-to-end engine behaviour: text removal and position preservation, kerning, multi-stream pages, `q`/`Q`, `'`/`"`, CID fonts, unknown fonts, ActualText, hostile streams, unbalanced `q`, encryption, shared streams, forms, images, inline images, annotations, form flattening, metadata, Type3 fonts, vertical text, widget values, fail-closed forms. |
| `engine/__tests__/units.test.ts`        | Tokenizer, geometry, serialisation, CMap parsing.                                                                                                                                                                                                                                                                                                          |
| `engine/__tests__/verification.test.ts` | The production verification heuristic finds text before redaction and none after.                                                                                                                                                                                                                                                                          |
| `state/redactionsReducer.test.ts`       | Add/update/remove, no-op detection, undo/redo, history cap, file removal, engine input.                                                                                                                                                                                                                                                                    |
| `lib/lib.test.ts`                       | File names, ZIP, PDF signature and encryption detection, intake limits, coordinates (incl. rotation), zoom, selection grouping, file status.                                                                                                                                                                                                               |
| `workers/pdfWorker.test.ts`             | Worker client with a fake Worker: job ids, concurrency guard, typed errors, cancel, timeout, crash.                                                                                                                                                                                                                                                        |
| `components/components.test.tsx`        | Confirm dialog (role, focus, Escape, focus trap, progress, retry), keyboard shortcuts, and the page-thumbnail panel (current page, click to navigate, box badges and previews).                                                                                                                                                                            |

## The two oracles

**1. `findLeaks(bytes, secret)`** (in `engine/__tests__/helpers.ts`) searches:

- the raw file bytes;
- every indirect object, with streams decoded;
- dictionaries and strings recursively;

for the secret as plain text, lower- and upper-case hex, and UTF-16BE hex. A test passes only if the
result is an empty list, so it also catches leaks in places nobody thought to check.

**2. `extractText(bytes)`** uses the PDF.js legacy build in Node to extract positioned text. It
checks that text _outside_ the boxes survives and has not moved (to 0.01 pt).

## Writing a regression test for a leak

1. Build a fixture with `buildPdf()`, hand-writing the content-stream operators that reproduce the
   problem. Use `formXObject()` and `grayImage()` for forms and images, or the `customize` callback
   for anything else (annotations, catalog entries).
2. Run `redactPdf(input, [[box]])`, where the box is in PDF points (origin bottom-left).
3. Assert `expect(await findLeaks(bytes, 'SECRET')).toEqual([])`.
4. If text should survive, assert it with `extractText()`.

```ts
it("removes text drawn inside a nested form", async () => {
  const input = await buildPdf([{ content: "/Fm1 Do" }], (doc, pages) => {
    const form = formXObject(doc, "BT /F1 20 Tf 100 700 Td (SECRET) Tj ET");
    pages[0]!.node
      .Resources()!
      .set(PDFName.of("XObject"), doc.context.obj({ Fm1: form }));
  });
  const { bytes } = await redactPdf(input, [
    [{ x: 98, y: 696, width: 82, height: 22 }],
  ]);
  expect(await findLeaks(bytes, "SECRET")).toEqual([]);
});
```

## Environments

- Engine and unit tests run in **Node** (`environment: 'node'`).
- Component tests opt into **happy-dom** with `// @vitest-environment happy-dom`.
- `src/test/setup.ts` registers jest-dom matchers, unmounts React trees after each test, and
  polyfills `Promise.withResolvers` (needed by PDF.js on Node < 22).

## Coverage

Coverage is measured for `engine/`, `state/` and `lib/`. The engine is at about 90 % of lines. The
uncovered parts are mostly defensive branches for malformed fonts. `lib/pdf.ts` and the PDF.js
loading half of `verifyRedaction.ts` only run in a browser; their logic is covered through the
browser smoke run and through `charactersInsideRects`.

## Browser smoke run

A scripted run (playwright-core driving the locally installed Edge) against `npm run preview`:

1. checks the CSP meta tag;
2. opens `/redact` directly (deep link);
3. uploads a 3-page PDF, draws boxes on pages 1 and 3, then undoes, redoes and zooms;
4. checks the overlay still shows the boxes after zoom (pixel probe);
5. applies, expects the **Verified** badge, downloads, and scans the output for the secrets;
6. records console errors and any request that leaves localhost (both must be empty).

Promoting this to a Playwright test in CI is the next step.
