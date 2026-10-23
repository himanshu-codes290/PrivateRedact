# 4. Redaction engine deep dive

Source: `PrivateRedact/src/features/redact/engine/`. Entry point: `redactPdf(bytes, pageRedactions)`.

## PDF in five minutes

A PDF is a graph of **objects**: numbers, strings, names (`/Font`), arrays, dictionaries
(`<< /Key value >>`), and **streams** (a dictionary plus binary data, usually Flate-compressed).
Objects are numbered (`12 0 obj … endobj`) and referenced (`12 0 R`). A cross-reference table maps
numbers to byte offsets; the trailer points to the **catalog** (`/Root`), which points to the page
tree.

A **page** is a dictionary with:

- `/MediaBox` (and optionally `/CropBox`) for its size,
- `/Resources`: fonts, images and forms it can use, by name,
- `/Contents`: one or more **content streams**,
- `/Annots`: annotations (comments, links, form widgets) drawn on top.

A **content stream** is a little postfix program: operands, then an operator.

```
q 1 0 0 1 72 700 cm          % save state; move origin to (72,700)
BT /F1 12 Tf 0 0 Td          % begin text; font F1 at 12 pt; position
(Hello) Tj                    % show the string "Hello"
[(W) 120 (orld)] TJ          % show with a kerning adjustment
ET Q                          % end text; restore state
/Im1 Do                       % draw image or form named Im1
```

The words on the page exist only as **byte strings inside these operators**. There is no "text box"
object to delete. To remove text you must work out where each byte string lands on the page, which
means re-running the PDF graphics model.

## Why covering is not redacting

Painting `0 0 0 rg x y w h re f` over text adds a black rectangle **after** the text. The text
operators are still in the stream; selecting, copying or extracting the page returns them.
Redaction must **delete or rewrite** the operators, then (optionally) paint the box.

## Pipeline

```
load ─▶ flatten form fields ─▶ for each page with boxes:
          concatenate /Contents ─▶ tokenize ─▶ interpret (strip text, images, forms)
          ─▶ write ONE new stream:  q <redacted content> Q…Q  <burn boxes>
          ─▶ delete touching annotations (+ popups, replies)
      ─▶ sanitise document (metadata, outlines, attachments, JS…)
      ─▶ garbage-collect unreachable objects ─▶ save
```

## Step 1: tokenizer (`tokenizer.ts`)

Turns decoded stream bytes into operators **with their byte ranges**:

```ts
{ name: 'Tj', operands: [{ t: 'str', bytes }], start: 120, end: 131 }
```

Byte ranges let the interpreter splice edits into the original bytes and leave everything else
byte-identical, including binary inline-image data it does not understand.

Robustness rules, because PDFs are hostile input:

- every loop iteration advances at least one byte (the old tokenizer looped forever on
  `[/X (y)] TJ` or a stray `)`);
- literal strings balance nested parentheses, as the spec allows: `(a(b)c)`;
- array nesting is capped;
- inline images (`BI … ID <binary> EI`) use the exact data length when computable
  (`W × H × components × bits / 8`), and otherwise a PDF.js-style heuristic for the `EI` marker.

## Step 2: the text model (`interpreter.ts`)

The interpreter tracks just enough state to know where every glyph lands:

| Operator                     | Effect on state                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `q` / `Q`                    | push / pop the graphics state (CTM **and** text state: font, size, Tc, Tw, Tz, TL, Ts) |
| `cm a b c d e f`             | `CTM = M × CTM`                                                                        |
| `BT` / `ET`                  | reset text matrix `Tm` and line matrix `Tlm` to identity                               |
| `Tf /F1 12`                  | font and size                                                                          |
| `Tc`, `Tw`, `Tz`, `TL`, `Ts` | char spacing, word spacing, horizontal scale, leading, rise                            |
| `Td tx ty`, `TD`, `T*`, `Tm` | move the text line matrix                                                              |
| `Tj`, `TJ`, `'`, `"`         | show text                                                                              |
| `Do /Name`                   | draw an image or a form                                                                |
| `BI … EI`                    | inline image                                                                           |
| `BDC` / `BMC` / `EMC`        | marked content (may carry `/ActualText`)                                               |

Matrices use the PDF row-vector convention, so "apply A, then B" is `A × B`. For each glyph:

```
glyph matrix  G = [Tfs·Th, 0, 0, Tfs, pen, Trise] × Tm × CTM
glyph box     = G applied to [0, descent] … [width, ascent]   (in em units)
advance       = (width · Tfs + Tc + Tw if single-byte space) · Th
```

`pen` is the running offset along the line, including `TJ` adjustments
(`-n/1000 · Tfs · Th` for each number `n`).

### Worked example (from the test suite)

`BT /F1 20 Tf 100 700 Td (HELLO WORLD) Tj ET` with Helvetica. Glyph widths (per 1000 em):
H 722, E 667, L 556, O 778, space 278.

- `H` starts at x = 100 and spans 722/1000 × 20 = 14.44 pt.
- `HELLO` spans (722 + 667 + 556 + 556 + 778) / 1000 × 20 = **65.58 pt**, ending at x = 165.58.
- The space ends at x = 171.14, so `WORLD` starts at **x = 171.14**.

A box over x ∈ [98, 166] covers the five glyphs of HELLO. The engine rewrites the operator as:

```
[-3279 <20574f524c44>] TJ
```

- `-3279` is a `TJ` adjustment equal to HELLO's advance: 65.58 pt ÷ 20 pt × 1000 = 3279 (negative
  numbers move right).
- `<20574f524c44>` is " WORLD" in hex, the glyphs that survive.

PDF.js then reads `WORLD` at x = 171.14, the same position as before. The test asserts this to two
decimal places.

### Glyph-level removal and why adjustments matter

The original engine deleted the **whole** `Tj`/`TJ` operator when any part touched a box, so
"WORLD" vanished too. Worse, deleting an operator also deletes its _advance_, so the **next**
operator in the same text block was drawn where the deleted one started, sliding under the box or
overlapping other text. Replacing removed glyphs with exact numeric adjustments fixes both problems.
`'` and `"` also move to the next line (and `"` sets spacing), so their rewrite keeps those side
effects: `T* [ … ] TJ`.

### When is a glyph "under" a box?

A glyph is removed when its box overlaps a redaction box **and** either its centre is inside the
box or at least **20 %** of its area is covered (the union of all boxes, computed without double
counting). Grazing the ascender of the next line does not wipe that line, and a glyph that is mostly
hidden is always removed.

### Fonts (`fonts.ts`)

Glyph widths come from the font dictionary:

| Font type                     | Codes                          | Widths                                                               |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Simple (Type1, TrueType)      | 1 byte                         | `/Widths` + `/FirstChar`, `/MissingWidth`                            |
| Standard 14 without `/Widths` | 1 byte                         | AFM metrics from `@pdf-lib/standard-fonts` + encoding/`/Differences` |
| Type0 / CID, `Identity-H/V`   | **2 bytes**                    | `/W` array by CID, `/DW` default                                     |
| Type0 with embedded CMap      | 1–4 bytes per codespace ranges | CID via `cidrange`/`cidchar`, then `/W`                              |
| Type3                         | 1 byte                         | `/Widths` × `/FontMatrix`                                            |

The original engine read CID fonts one byte at a time, so widths were wrong and positions drifted.
Ascent and descent come from the `FontDescriptor`, clamped to a sane band.

**Unknown metrics.** If widths cannot be determined (a broken font, or a predefined CJK CMap whose
tables are not shipped), positions are guesses. The engine then becomes conservative: if any glyph
of the operator touches a box, the whole operator is removed, and the user gets an info note.

## Step 3: beyond plain text

### Multiple content streams

A page's `/Contents` array is defined to behave like **one** concatenated stream. Stream 1 may set
`cm` or a font that stream 2 uses. The engine concatenates first, then interprets. The original
code reset state per stream and missed text positioned by an earlier stream.

### Form XObjects (`Do` on a form)

Forms are reusable mini-pages (letterheads, stamps, flattened form fields). The interpreter
recurses into a form with `CTM' = /Matrix × CTM`, after a quick bounding-box test to skip forms that
cannot reach a box. If anything inside changes:

- a **copy** of the form is created with the redacted content and registered under a new name;
- the original is never mutated, because other pages may use it unredacted;
- the page's resources are cloned on first write (`ResourceScope`), so shared resource
  dictionaries are never changed either.

Recursion is depth-limited (12) with cycle detection. A form that cannot be decoded, or that
references itself, is removed if it touches a box (fail closed) and reported.

### Images

An image is drawn into the unit square transformed by the CTM. If a box covers at least 98 % of the
image, the `Do` (or inline `BI … EI`) is deleted, and the resource entry is dropped so the image
data is garbage-collected. Partly covered images are kept and reported, because removing pixels
needs a decoder and encoder for every image format.

### Marked content

`/Span << /ActualText (John Smith) >> BDC … EMC` gives screen readers and copy-paste a replacement
string. If glyphs inside such a span are removed, the span is rewritten to `/Span BMC` (no property
list). Optional-content spans (`/OC`) are kept, because they control visibility, not text.

## Step 4: page output

The page gets **one new Flate stream**:

```
q
<redacted original content>
ET (if the original ended inside a text object)
Q … Q   (one per unbalanced q, plus our own)
q 0 0 0 rg 0 0 0 RG  x y w h re f …  Q     ← burn boxes in default user space
```

Wrapping in balanced `q … Q` guarantees the burn boxes are not shifted by a stray `cm` left in the
original content. The original streams are not modified (another page may share them). They become
unreachable and are dropped by garbage collection.

## Step 5: annotations and forms

- Forms are flattened first (`form.flatten()`), so field values become page content the interpreter
  can redact.
- Annotations whose `/Rect` (normalised: some files store corners reversed) touches a box are
  deleted, together with their `/Popup` and any replies (`/IRT`).
- A deleted form widget is also removed from its field's `/Kids`, and the field's value `/V` is
  cleared, because a reachable field would otherwise keep the value in the file.

## Step 6: document sanitisation (`sanitize.ts`)

| Location                              | Can contain                           | Action                                                          |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Trailer `/Info`                       | title, author, subject, keywords      | replaced with a minimal dict (Producer/Creator = PrivateRedact) |
| Catalog `/Metadata`                   | XMP copy of the above, edit history   | removed                                                         |
| `/Outlines`                           | bookmark titles                       | removed                                                         |
| `/Names`                              | embedded files, JavaScript, templates | only named destinations kept                                    |
| `/StructTreeRoot`                     | alt text, actual text                 | removed                                                         |
| `/AcroForm`                           | field values, XFA                     | removed (after flattening)                                      |
| `/OpenAction`, `/AA`                  | JavaScript actions                    | removed (a plain destination is kept)                           |
| Page `/Thumb`                         | a rendered image of the page          | removed                                                         |
| Page `/PieceInfo`, `/Metadata`, `/AA` | private app data, scripts             | removed                                                         |
| File-attachment and media annotations | embedded files                        | removed                                                         |

## Step 7: garbage collection

pdf-lib writes **every** registered object on save. Without a cleanup pass, the original content
stream (with the secret text), deleted annotations and old object versions from incremental
updates would all be written out. `collectGarbage()` walks the object graph from `/Root` and `/Info`
and deletes everything unreachable. The count is returned in the report as
`orphanObjectsRemoved`, and the leak scanner in the tests proves the dropped objects are gone.

## Fail-closed design

| Situation                                    | Behaviour                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Encrypted PDF                                | `RedactionError('encrypted')` with instructions                           |
| Not a PDF / unreadable                       | `RedactionError('unreadable')`                                            |
| Page content uses an unsupported compression | `RedactionError('undecodable-content')`: the page is not silently skipped |
| Undecodable or cyclic form touching a box    | removed and reported                                                      |
| Unknown font metrics                         | whole operator removed when touched, reported                             |
| Nothing removable under a box                | burned, and a "covered, not removed" warning                              |
| Worker hangs                                 | 3-minute watchdog, then terminate                                         |

## Verification (main thread, `lib/verifyRedaction.ts`)

After the worker returns, the main thread opens the output with **PDF.js**, a different code base
from pdf-lib, extracts text from every page that had boxes, splits each text item into per-character
cells, and counts non-space characters whose centre is inside a box. Zero means **Verified**. If any
remain, the file is flagged **Text found** and the user is told not to share it. Two independent
implementations agreeing is much stronger evidence than the engine checking itself.

## Known gaps and next steps

1. **Pixel-level image redaction** for partly covered images: decode (DCT via `createImageBitmap`
   in the worker, Flate directly), black out the region, re-encode. Needs care with SMasks,
   indexed colour and predictors.
2. **Vector text and scans:** optional OCR (Tesseract WASM) to find text; optional "rasterise the
   page" mode that guarantees removal at the cost of selectable text.
3. **Predefined CJK CMaps:** ship the binary CMaps to the worker for exact CID widths.
4. **Search-and-redact:** regex/PII patterns using PDF.js text content to propose boxes.
5. **Annotations' appearance streams** that merely _display_ sensitive text elsewhere on the page.
