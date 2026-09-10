import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  rgb,
  type PDFObject,
} from 'pdf-lib';
import type { PdfRect } from './coordinates';

/**
 * Destructive redaction engine (pdf-lib).
 *
 * For every page that has redaction rects (stored in PDF user space,
 * 72 DPI, bottom-left origin) this engine:
 *
 *  1. Decodes each original content stream and runs a text-position
 *     tracking mini-interpreter (`cm` / `BT..ET` / `Td` / `TD` / `T*`
 *     / `Tm` / `Tf` / `Tc` / `Tw` / `Tz` / `TL` / `Ts`), computes the
 *     bounding box of every text-showing run (`Tj` / `TJ` / `'` / `"`)
 *     and REMOVES the run bytes when its box intersects a rect. This is
 *     the permanent, content-level strip — the text is gone from the
 *     file, not merely covered.
 *  2. Re-writes the filtered content back as an uncompressed stream
 *     (byte-faithful: everything except the stripped runs is preserved
 *     verbatim, including inline images).
 *  3. Burns an opaque black `drawRectangle` over every rect — a new
 *     content stream appended last, so it paints on top of everything
 *     (the visual guarantee, independent of the strip).
 *  4. Removes annotations (links/highlights/redact marks) whose `Rect`
 *     intersects a redaction rect, and normalizes the page.
 *  5. `doc.save()` → `Uint8Array` for the caller to wrap in a Blob.
 *
 * Coordinate notes: PdfRect is in PDF user space (bottom-left origin),
 * which is exactly the space `drawRectangle` and the page MediaBox use,
 * so no rotation handling is needed here — the viewport conversions
 * already happened when the rects were created.
 *
 * Known limitations (documented in the plan, §8): pdf-lib
 * re-serialization is destructive to some exotic features (forms,
 * signatures); text inside Form XObjects is not stripped (still burned
 * over visually).
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RedactPdfOptions {
  /** Progress callback, 0..1 across all pages. */
  onProgress?: (progress: number) => void;
}

export interface RedactPdfResult {
  bytes: Uint8Array;
  /** Number of text-showing runs permanently stripped. */
  strippedRunCount: number;
  /** Number of rectangles burned onto pages. */
  burnedRectCount: number;
}

/** Strip + burn + flatten. `pageRedactions[i]` = rects for page i (1-based
 *  friendly: index 0 = page 1). Undefined entries are left untouched. */
export async function redactPdf(
  source: Uint8Array | ArrayBuffer | string,
  pageRedactions: (PdfRect[] | undefined)[],
  options: RedactPdfOptions = {},
): Promise<RedactPdfResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false });
  } catch (err) {
    throw new Error(
      `Unable to open PDF for redaction${
        err instanceof Error && /encrypt/i.test(err.message)
          ? ' — the document appears to be password-protected or encrypted'
          : ''
      }.`,
      { cause: err },
    );
  }

  const totalPages = doc.getPageCount();
  const { clampedByPage, burnedRectCount } = computeClampedByPage(doc, pageRedactions);

  let strippedRunCount = 0;
  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const clamped = clampedByPage[pageIndex];
    if (clamped) {
      const { stripped } = processPage(doc, pageIndex, clamped);
      strippedRunCount += stripped;
    }
    options.onProgress?.((pageIndex + 1) / totalPages);
  }

  const bytes = await doc.save();

  return { bytes, strippedRunCount, burnedRectCount };
}

/** Wrap a saved PDF's bytes in a Blob URL. Revoke after the download
 *  finishes (or on unmount) with `URL.revokeObjectURL(url)`.
 *  The bytes are copied into an exact-length buffer so a subarray view's
 *  padded underlying buffer can never leak garbage into the Blob. */
export function bytesToObjectUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

/** Clamp every rect to its page bounds, dropping degenerate (zero-size)
 *  entries. Runs once up front so progress stays smooth and burning is
 *  deterministic. Shared by `redactPdf` and the DEV cross-check. */
export function computeClampedByPage(
  doc: PDFDocument,
  pageRedactions: (PdfRect[] | undefined)[],
): { clampedByPage: (PdfRect[] | null)[]; burnedRectCount: number } {
  const totalPages = doc.getPageCount();
  const clampedByPage: (PdfRect[] | null)[] = new Array(totalPages).fill(null);
  let burnedRectCount = 0;
  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const rects = pageRedactions[pageIndex];
    if (!rects || rects.length === 0) continue;
    const page = doc.getPage(pageIndex);
    const bounds = pageBounds(page);
    const clamped = rects
      .map((r) => clampRect(r, bounds))
      .filter((r) => r.width > 0.01 && r.height > 0.01);
    if (clamped.length === 0) continue;
    clampedByPage[pageIndex] = clamped;
    burnedRectCount += clamped.length;
  }
  return { clampedByPage, burnedRectCount };
}

// ---------------------------------------------------------------------------
// Page-level processing
// ---------------------------------------------------------------------------

function pageBounds(page: import('pdf-lib').PDFPage): { x: number; y: number; width: number; height: number } {
  const crop = page.node.CropBox();
  if (crop) return crop.asRectangle();
  return page.node.MediaBox().asRectangle();
}

function clampRect(
  r: PdfRect,
  bounds: { x: number; y: number; width: number; height: number },
): PdfRect {
  const x0 = Math.max(r.x, bounds.x);
  const y0 = Math.max(r.y, bounds.y);
  const x1 = Math.min(r.x + r.width, bounds.x + bounds.width);
  const y1 = Math.min(r.y + r.height, bounds.y + bounds.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Resolve a Contents entry reference to its raw stream. `lookup` with a
 *  single argument never throws (a dangling ref yields undefined) and the
 *  instanceof narrow keeps exotic stream subtypes safe — such entries are
 *  kept byte-identical instead of crashing the whole page. */
function resolveRawStream(doc: PDFDocument, ref: PDFRef): PDFRawStream | undefined {
  const resolved = doc.context.lookup(ref);
  return resolved instanceof PDFRawStream ? resolved : undefined;
}

function processPage(doc: PDFDocument, pageIndex: number, rects: PdfRect[]): { stripped: number } {
  const page = doc.getPage(pageIndex);
  const node = page.node;
  const fonts = buildFontResolver(page);
  let stripped = 0;

  // 1) Destructive text strip: rewrite every content stream.
  const contents = node.Contents();
  if (contents) {
    // Resolve each Contents entry, keeping its original reference so
    // unmodified streams stay byte-identical and modified ones are swapped
    // for freshly-registered replacement streams.
    const entries: { entry: PDFObject; stream?: PDFRawStream }[] = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const entry = contents.get(i);
        const stream =
          entry instanceof PDFRef ? resolveRawStream(doc, entry) : entry instanceof PDFRawStream ? entry : undefined;
        entries.push({ entry, stream });
      }
    } else if (contents instanceof PDFRawStream) {
      entries.push({ entry: contents, stream: contents });
    }

    const rewritten: PDFObject[] = [];
    let anyChanged = false;
    for (const { entry, stream } of entries) {
      if (!stream) {
        // Not a rewritable raw stream (e.g. exotic stream subtype) — keep
        // the original entry untouched.
        rewritten.push(entry);
        continue;
      }
      const result = rewriteStream(stream, rects, fonts);
      if (result) {
        anyChanged = true;
        stripped += result.stripped;
        rewritten.push(doc.context.register(doc.context.stream(result.bytes)));
        // Destructively empty the ORIGINAL stream's payload. The object
        // itself stays registered (so no dangling refs can corrupt the
        // output), but its bytes are gone — the pre-redaction text can no
        // longer be recovered from the file by any viewer or examiner.
        // `contents` is `readonly` in pdf-lib's types but mutable at runtime.
        (stream as unknown as { contents: Uint8Array }).contents = new Uint8Array(0);
      } else {
        rewritten.push(entry);
      }
    }

    if (anyChanged) {
      let newContents: PDFObject = rewritten[0];
      if (rewritten.length > 1) {
        const arr = PDFArray.withContext(doc.context);
        for (const item of rewritten) arr.push(item);
        newContents = arr;
      }
      node.set(PDFName.Contents, newContents);
    }
  }

  // 2) Vector burning — appended content stream paints on top.
  for (const r of rects) {
    page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: rgb(0, 0, 0), opacity: 1 });
  }

  // 3) Annotation cleanup + flattening.
  const annots = node.Annots();
  if (annots) {
    const toRemove: PDFRef[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const el = annots.get(i);
      if (!(el instanceof PDFRef)) continue;
      try {
        const dict = doc.context.lookup(el, PDFDict);
        const rectArr = dict.lookupMaybe(PDFName.of('Rect'), PDFArray);
        if (!rectArr) continue;
        const r = rectArr.asRectangle();
        if (rects.some((rect) => rectsIntersect(rect, r))) toRemove.push(el);
      } catch {
        // Malformed annotation — leave it alone; the burn rect still
        // covers its region visually.
      }
    }
    for (const ref of toRemove) node.removeAnnot(ref);
  }

  node.normalize();
  return { stripped };
}

// ---------------------------------------------------------------------------
// Content-stream tokenizer (byte-faithful, latin-1)
// ---------------------------------------------------------------------------

type TokenValue =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: string }
  | { t: 'array'; v: TokenValue[] }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'opaque' }
  | { t: 'keyword'; v: string };

interface Token {
  kind: 'operand' | 'keyword';
  value: TokenValue;
  /** Byte offset where this token starts (in the latin-1 string). */
  start: number;
  /** Byte offset just past the end of this token. */
  end: number;
}

const WS = new Set([' ', '\t', '\r', '\n', '\f', '\u0000']);
const DELIMS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function isWs(c: string): boolean {
  return WS.has(c);
}

/** Tokenize a decoded (uncompressed) content stream. The string is a 1:1
 *  byte map (latin-1), so token offsets are byte offsets and untouched
 *  ranges round-trip byte-exactly. Inline images (BI..EI) are consumed as
 *  a single opaque keyword token so their binary payload is never parsed
 *  or altered. */
function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    const c = content[i];

    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }

    // Literal string: ( ... )
    if (c === '(') {
      const start = i;
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        const ch = content[i];
        if (ch === '\\') {
          const next = content[i + 1];
          if (next === '\r' && content[i + 2] === '\n') {
            i += 3;
            continue;
          }
          if (next === '\n' || next === '\r') {
            i += 2;
            continue;
          }
          i++;
          const esc = content[i];
          const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (esc in simple) {
            out += simple[esc];
            i++;
          } else if (esc >= '0' && esc <= '7') {
            let oct = '';
            while (oct.length < 3 && i < n && content[i] >= '0' && content[i] <= '7') {
              oct += content[i];
              i++;
            }
            out += String.fromCharCode(parseInt(oct, 8));
          } else {
            out += esc;
            i++;
          }
        } else if (ch === ')') {
          i++;
          closed = true;
          break;
        } else {
          out += ch;
          i++;
        }
      }
      void closed;
      tokens.push({ kind: 'operand', value: { t: 'str', v: out }, start, end: i });
      continue;
    }

    // Hex string <..> or dictionary <<..>> / inline-image data is handled
    // inside the keyword branch for BI, so a plain '<<' here is a dict
    // operand (rare) — treat as opaque.
    if (c === '<') {
      if (content[i + 1] === '<') {
        const start = i;
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const d = content[i];
          if (d === '<' && content[i + 1] === '<') {
            depth++;
            i += 2;
          } else if (d === '>' && content[i + 1] === '>') {
            depth--;
            i += 2;
          } else if (d === '(') {
            i++;
            let bal = 1;
            while (i < n && bal > 0) {
              if (content[i] === '\\') i += 2;
              else if (content[i] === '(') bal++;
              else if (content[i] === ')') bal--;
              else i++;
            }
          } else if (d === '%') {
            while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
          } else {
            i++;
          }
        }
        tokens.push({ kind: 'operand', value: { t: 'opaque' }, start, end: i });
        continue;
      }
      const start = i;
      i++;
      let hex = '';
      while (i < n && content[i] !== '>') {
        const h = content[i];
        if (!isWs(h)) hex += h;
        i++;
      }
      i++; // '>'
      if (hex.length % 2 === 1) hex += '0';
      let out = '';
      for (let k = 0; k < hex.length; k += 2) {
        out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16) || 0);
      }
      tokens.push({ kind: 'operand', value: { t: 'str', v: out }, start, end: i });
      continue;
    }

    // Array [ ... ] — elements are strings / hex / numbers / nested arrays.
    if (c === '[') {
      const start = i;
      i++;
      const elems: TokenValue[] = [];
      while (i < n && content[i] !== ']') {
        const d = content[i];
        if (isWs(d) || d === '%') {
          if (d === '%') while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
          else i++;
          continue;
        }
        if (d === '(') {
          // Reuse the literal-string scanner inline.
          const s0 = i;
          i++;
          let out = '';
          while (i < n) {
            const ch = content[i];
            if (ch === '\\') {
              const next = content[i + 1];
              if (next === '\n' || next === '\r') {
                i += next === '\r' && content[i + 2] === '\n' ? 3 : 2;
                continue;
              }
              i++;
              const esc = content[i];
              const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
              if (esc in simple) {
                out += simple[esc];
                i++;
              } else if (esc >= '0' && esc <= '7') {
                let oct = '';
                while (oct.length < 3 && i < n && content[i] >= '0' && content[i] <= '7') {
                  oct += content[i];
                  i++;
                }
                out += String.fromCharCode(parseInt(oct, 8));
              } else {
                out += esc;
                i++;
              }
            } else if (ch === ')') {
              i++;
              break;
            } else {
              out += ch;
              i++;
            }
          }
          void s0;
          elems.push({ t: 'str', v: out });
        } else if (d === '<') {
          if (content[i + 1] === '<') {
            // Nested dict inside array — skip opaquely.
            i += 2;
            let depth = 1;
            while (i < n && depth > 0) {
              if (content[i] === '<' && content[i + 1] === '<') {
                depth++;
                i += 2;
              } else if (content[i] === '>' && content[i + 1] === '>') {
                depth--;
                i += 2;
              } else i++;
            }
            elems.push({ t: 'opaque' });
          } else {
            i++;
            let hex = '';
            while (i < n && content[i] !== '>') {
              if (!isWs(content[i])) hex += content[i];
              i++;
            }
            i++;
            if (hex.length % 2 === 1) hex += '0';
            let out = '';
            for (let k = 0; k < hex.length; k += 2) {
              out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16) || 0);
            }
            elems.push({ t: 'str', v: out });
          }
        } else if (d === '[') {
          // Nested array — scan to matching ']' and treat opaquely.
          i++;
          let depth = 1;
          while (i < n && depth > 0) {
            if (content[i] === '[') depth++;
            else if (content[i] === ']') depth--;
            else if (content[i] === '(') {
              i++;
              let bal = 1;
              while (i < n && bal > 0) {
                if (content[i] === '\\') i += 2;
                else if (content[i] === '(') bal++;
                else if (content[i] === ')') bal--;
                else i++;
              }
            }
            if (i < n && depth > 0) i++;
          }
          if (i < n) i++;
          elems.push({ t: 'opaque' });
        } else {
          // Number / name / keyword inside array.
          let word = '';
          while (i < n && !isWs(content[i]) && !DELIMS.has(content[i])) {
            word += content[i];
            i++;
          }
          if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) elems.push({ t: 'num', v: parseFloat(word) });
          else if (word.startsWith('/')) elems.push({ t: 'name', v: word.slice(1) });
          else if (word === 'true') elems.push({ t: 'bool', v: true });
          else if (word === 'false') elems.push({ t: 'bool', v: false });
          else elems.push({ t: 'opaque' });
        }
      }
      if (i < n) i++; // ']'
      tokens.push({ kind: 'operand', value: { t: 'array', v: elems }, start, end: i });
      continue;
    }

    // Name: /Name
    if (c === '/') {
      const start = i;
      i++;
      let name = '';
      while (i < n && !isWs(content[i]) && !DELIMS.has(content[i])) {
        if (content[i] === '#' && i + 2 < n && /^[0-9a-fA-F]{2}$/.test(content.slice(i + 1, i + 3))) {
          name += String.fromCharCode(parseInt(content.slice(i + 1, i + 3), 16));
          i += 3;
        } else {
          name += content[i];
          i++;
        }
      }
      tokens.push({ kind: 'operand', value: { t: 'name', v: name }, start, end: i });
      continue;
    }

    // Number or keyword.
    if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      const start = i;
      let numStr = '';
      while (i < n && /[0-9+\-.eE]/.test(content[i])) {
        numStr += content[i];
        i++;
      }
      tokens.push({ kind: 'operand', value: { t: 'num', v: parseFloat(numStr) }, start, end: i });
      continue;
    }

    // Keyword. Special-case BI (inline image): consume dict + ID + binary
    // payload + EI as a single opaque keyword token.
    const start = i;
    let word = '';
    while (i < n && !isWs(content[i]) && !DELIMS.has(content[i])) {
      word += content[i];
      i++;
    }

    if (word === 'BI') {
      let depth = 0;
      let sawID = false;
      while (i < n && !sawID) {
        const d = content[i];
        if (d === '<' && content[i + 1] === '<') {
          depth++;
          i += 2;
        } else if (d === '>' && content[i + 1] === '>') {
          depth--;
          i += 2;
        } else if (d === 'I' && content[i + 1] === 'D' && depth === 0) {
          // ID keyword terminates the dict.
          i += 2;
          sawID = true;
        } else if (d === '(') {
          i++;
          let bal = 1;
          while (i < n && bal > 0) {
            if (content[i] === '\\') i += 2;
            else if (content[i] === '(') bal++;
            else if (content[i] === ')') bal--;
            else i++;
          }
        } else if (d === '%') {
          while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
        } else {
          i++;
        }
      }
      // Binary payload runs to the first whitespace-delimited `EI`.
      while (i < n) {
        if (content[i] === 'E' && content[i + 1] === 'I') {
          const before = i > 0 ? content[i - 1] : ' ';
          const after = i + 2 < n ? content[i + 2] : ' ';
          if (isWs(before) && isWs(after)) {
            i += 2;
            break;
          }
        }
        i++;
      }
      tokens.push({ kind: 'keyword', value: { t: 'keyword', v: 'BI' }, start, end: i });
      continue;
    }

    if (word === 'true') {
      tokens.push({ kind: 'operand', value: { t: 'bool', v: true }, start, end: i });
    } else if (word === 'false') {
      tokens.push({ kind: 'operand', value: { t: 'bool', v: false }, start, end: i });
    } else if (word === 'null') {
      tokens.push({ kind: 'operand', value: { t: 'null' }, start, end: i });
    } else if (word) {
      tokens.push({ kind: 'keyword', value: { t: 'keyword', v: word }, start, end: i });
    }
  }

  return tokens;
}

interface Op {
  name: string;
  args: TokenValue[];
  /** Byte range covering args + keyword (removed entirely when stripped). */
  start: number;
  end: number;
}

function groupOps(tokens: Token[]): Op[] {
  const ops: Op[] = [];
  let pending: Token[] = [];
  for (const tok of tokens) {
    if (tok.kind === 'keyword') {
      const start = pending.length > 0 ? pending[0].start : tok.start;
      ops.push({
        name: tok.value.t === 'keyword' ? tok.value.v : '',
        args: pending.map((p) => p.value),
        start,
        end: tok.end,
      });
      pending = [];
    } else {
      pending.push(tok);
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Text-position interpreter (mirrors the PDF.js engine math)
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Row-vector matrix multiply (same convention as PDF.js Util.transform). */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Translate a matrix by (x, y) in its own space (text-space Td/Tj advance). */
function translate(m: Matrix, x: number, y: number): Matrix {
  return [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface TextState {
  charSpacing: number;
  wordSpacing: number;
  hScale: number; // Tz in percent (100 = normal)
  leading: number;
  rise: number;
  fontSize: number;
  fontName: string | null;
}

const INITIAL_TEXT_STATE: TextState = {
  charSpacing: 0,
  wordSpacing: 0,
  hScale: 100,
  leading: 0,
  rise: 0,
  fontSize: 0,
  fontName: null,
};

interface RunBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface StreamRewriteResult {
  bytes: Uint8Array;
  stripped: number;
}

/** Rewrite one decoded content stream: return null when nothing was
 *  stripped (caller keeps the original stream). */
function rewriteStream(
  stream: PDFRawStream,
  rects: PdfRect[],
  fonts: (name: string) => PDFDict | undefined,
): StreamRewriteResult | null {
  let decoded: Uint8Array;
  try {
    decoded = decodePDFRawStream(stream).decode();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[redaction] Unsupported content-stream filter, burn-only for this stream.', err);
    }
    return null;
  }

  // latin-1: byte -> char 1:1 so offsets and strings round-trip exactly.
  let content = '';
  for (let i = 0; i < decoded.length; i++) content += String.fromCharCode(decoded[i]);

  const ops = groupOps(tokenize(content));
  if (ops.length === 0) return null;

  let ctm: Matrix = IDENTITY;
  let textMatrix: Matrix = IDENTITY;
  let textLineMatrix: Matrix = IDENTITY;
  const textState: TextState = { ...INITIAL_TEXT_STATE };
  const ctmStack: Matrix[] = [];
  const removeRanges: [number, number][] = [];
  let stripped = 0;

  const num = (v: TokenValue | undefined, fallback = 0): number =>
    v && v.t === 'num' ? v.v : fallback;
  const isStr = (v: TokenValue | undefined): v is Extract<TokenValue, { t: 'str' }> =>
    !!v && v.t === 'str';

  for (const op of ops) {
    const a = op.args;
    switch (op.name) {
      case 'q':
        ctmStack.push(ctm);
        break;
      case 'Q':
        ctm = ctmStack.pop() ?? ctm;
        break;
      case 'cm':
        if (a.length >= 6) {
          ctm = multiply(ctm, [
            num(a[0], 1),
            num(a[1]),
            num(a[2]),
            num(a[3], 1),
            num(a[4]),
            num(a[5]),
          ]);
        }
        break;
      case 'BT':
        textMatrix = IDENTITY;
        textLineMatrix = IDENTITY;
        break;
      case 'Tf':
        if (a.length >= 2 && a[0].t === 'name' && a[1].t === 'num') {
          textState.fontName = a[0].v;
          textState.fontSize = a[1].v;
        }
        break;
      case 'Tc':
        textState.charSpacing = num(a[0]);
        break;
      case 'Tw':
        textState.wordSpacing = num(a[0]);
        break;
      case 'Tz':
        textState.hScale = num(a[0], 100);
        break;
      case 'TL':
        textState.leading = num(a[0]);
        break;
      case 'Ts':
        textState.rise = num(a[0]);
        break;
      case 'Td':
        if (a.length >= 2) {
          textLineMatrix = translate(textLineMatrix, num(a[0]), num(a[1]));
          textMatrix = textLineMatrix;
        }
        break;
      case 'TD':
        if (a.length >= 2) {
          textLineMatrix = translate(textLineMatrix, num(a[0]), num(a[1]));
          textState.leading = -num(a[1]);
          textMatrix = textLineMatrix;
        }
        break;
      case 'T*':
        textLineMatrix = translate(textLineMatrix, 0, -textState.leading);
        textMatrix = textLineMatrix;
        break;
      case 'Tm':
        if (a.length >= 6) {
          textMatrix = [
            num(a[0], 1),
            num(a[1]),
            num(a[2]),
            num(a[3], 1),
            num(a[4]),
            num(a[5]),
          ];
          textLineMatrix = textMatrix;
        }
        break;
      case 'Tj':
        if (isStr(a[0])) {
          const advance = runAdvance(a[0].v, textState, fonts);
          const box = runBox(ctm, textMatrix, advance, textState.fontSize);
          if (intersectsAny(box, rects)) {
            removeRanges.push([op.start, op.end]);
            stripped++;
          }
          // Advance regardless: subsequent inline runs are positioned after
          // this one in the PDF, even when this run is being removed.
          textMatrix = translate(textMatrix, advance, 0);
        }
        break;
      case 'TJ':
        if (a[0] && a[0].t === 'array') {
          const advance = runAdvanceTJ(a[0].v, textState, fonts);
          const box = runBox(ctm, textMatrix, advance, textState.fontSize);
          if (intersectsAny(box, rects)) {
            removeRanges.push([op.start, op.end]);
            stripped++;
          }
          textMatrix = translate(textMatrix, advance, 0);
        }
        break;
      case "'":
        if (isStr(a[0])) {
          textLineMatrix = translate(textLineMatrix, 0, -textState.leading);
          textMatrix = textLineMatrix;
          const advance = runAdvance(a[0].v, textState, fonts);
          const box = runBox(ctm, textMatrix, advance, textState.fontSize);
          if (intersectsAny(box, rects)) {
            removeRanges.push([op.start, op.end]);
            stripped++;
          }
          textMatrix = translate(textMatrix, advance, 0);
        }
        break;
      case '"':
        if (a.length >= 3 && isStr(a[2])) {
          textState.wordSpacing = num(a[0]);
          textState.charSpacing = num(a[1]);
          textLineMatrix = translate(textLineMatrix, 0, -textState.leading);
          textMatrix = textLineMatrix;
          const advance = runAdvance(a[2].v, textState, fonts);
          const box = runBox(ctm, textMatrix, advance, textState.fontSize);
          if (intersectsAny(box, rects)) {
            removeRanges.push([op.start, op.end]);
            stripped++;
          }
          textMatrix = translate(textMatrix, advance, 0);
        }
        break;
      default:
        break;
    }
  }

  if (removeRanges.length === 0) return null;

  const filtered = removeRangesSorted(content, removeRanges);
  const bytes = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) bytes[i] = filtered.charCodeAt(i);

  return { bytes, stripped };
}

/** Sum the horizontal advance (text-space units) of a Tj string. */
function runAdvance(
  str: string,
  state: TextState,
  fonts: (name: string) => PDFDict | undefined,
): number {
  const hScale = state.hScale / 100;
  const font = state.fontName ? fonts(state.fontName) : undefined;
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    let adv = glyphAdvance(font, code, state) + state.charSpacing * hScale;
    if (code === 32) adv += state.wordSpacing * hScale;
    total += adv;
  }
  return total;
}

/** Sum the advance of a TJ array (strings advance, numbers adjust). */
function runAdvanceTJ(
  elems: TokenValue[],
  state: TextState,
  fonts: (name: string) => PDFDict | undefined,
): number {
  const hScale = state.hScale / 100;
  const font = state.fontName ? fonts(state.fontName) : undefined;
  let total = 0;
  for (const el of elems) {
    if (el.t === 'str') {
      for (let i = 0; i < el.v.length; i++) {
        const code = el.v.charCodeAt(i);
        let adv = glyphAdvance(font, code, state) + state.charSpacing * hScale;
        if (code === 32) adv += state.wordSpacing * hScale;
        total += adv;
      }
    } else if (el.t === 'num') {
      total += (-el.v / 1000) * state.fontSize * hScale;
    }
  }
  return total;
}

/** Axis-aligned bounding box of a run in PDF user space.
 *  Uses the exact ctm·textMatrix geometry; vertical extent is the em box
 *  (ascent = fontSize, descent = -0.25·fontSize) so the box is slightly
 *  conservative (over-strip direction — the burn rect is the guarantee). */
function runBox(ctm: Matrix, textMatrix: Matrix, advance: number, fontSize: number): RunBox {
  const m = multiply(ctm, textMatrix);
  const bx = m[4];
  const by = m[5];
  const ux = [m[0], m[1]];
  const uy = [m[2], m[3]];
  const ascent = fontSize;
  const descent = -0.25 * fontSize;

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };

  add(bx, by);
  add(bx + ux[0] * advance, by + ux[1] * advance);
  add(bx + uy[0] * descent, by + uy[1] * descent);
  add(bx + ux[0] * advance + uy[0] * descent, by + ux[1] * advance + uy[1] * descent);
  add(bx + uy[0] * ascent, by + uy[1] * ascent);
  add(bx + ux[0] * advance + uy[0] * ascent, by + ux[1] * advance + uy[1] * ascent);

  return { x0, y0, x1, y1 };
}

/** A run is removed when its (conservative) box intersects any rect. The
 *  box spans from the run's origin through the advance and its em
 *  ascent/descent, so the exact start point is always covered by the box —
 *  no separate point check is needed. */
function intersectsAny(box: RunBox, rects: PdfRect[]): boolean {
  for (const r of rects) {
    const rx1 = r.x + r.width;
    const ry1 = r.y + r.height;
    if (box.x0 < rx1 && box.x1 > r.x && box.y0 < ry1 && box.y1 > r.y) return true;
  }
  return false;
}

function removeRangesSorted(content: string, ranges: [number, number][]): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = '';
  let last = 0;
  for (const [s, e] of sorted) {
    if (s >= last) {
      out += content.slice(last, s);
      last = e;
    }
  }
  out += content.slice(last);
  return out;
}

// ---------------------------------------------------------------------------
// Font width resolution (for exact per-glyph advances)
// ---------------------------------------------------------------------------

function buildFontResolver(page: import('pdf-lib').PDFPage): (name: string) => PDFDict | undefined {
  const resources = page.node.Resources();
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const cache = new Map<string, PDFDict | undefined>();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    let font: PDFDict | undefined;
    if (fonts) {
      const maybe = fonts.lookupMaybe(PDFName.of(name), PDFDict);
      if (maybe) font = maybe;
    }
    cache.set(name, font);
    return font;
  };
}

/** Width of one glyph, in text-space units (already scaled by fontSize,
 *  FontMatrix and hScale). Falls back to a conservative full-em advance
 *  (fontSize·hScale) when the font is unavailable or its widths cannot be
 *  resolved — over-stripping slightly is safe because the burn rect is
 *  opaque. */
function glyphAdvance(font: PDFDict | undefined, code: number, state: TextState): number {
  const hScale = state.hScale / 100;
  const fontSize = state.fontSize;
  if (!font) return fontSize * hScale;

  const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString();
  if (subtype === 'Type0') {
    const w = type0Width(font, code);
    if (w !== undefined) return (w / 1000) * fontSize * hScale;
    return fontSize * hScale;
  }

  const scale = fontMatrixScale(font);
  const widths = font.lookupMaybe(PDFName.of('Widths'), PDFArray);
  if (widths) {
    const first = font.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber() ?? 0;
    const idx = code - first;
    if (idx >= 0 && idx < widths.size()) {
      const w = widths.lookupMaybe(idx, PDFNumber)?.asNumber();
      if (w !== undefined) return w * scale * fontSize * hScale;
    }
  }
  return fontSize * hScale;
}

function fontMatrixScale(font: PDFDict): number {
  const fm = font.lookupMaybe(PDFName.of('FontMatrix'), PDFArray);
  if (fm && fm.size() >= 1) {
    const s = fm.lookupMaybe(0, PDFNumber)?.asNumber();
    if (s !== undefined && s > 0) return s;
  }
  return 0.001; // standard Type1 / TrueType FontMatrix
}

/** Best-effort CID width for Type0 fonts: only when the CMap is
 *  Identity-H/V (code === CID) and the descendant font carries a W array.
 *  Returns undefined otherwise (caller falls back to conservative). */
function type0Width(font: PDFDict, code: number): number | undefined {
  const encoding = font.lookupMaybe(PDFName.of('Encoding'), PDFName)?.asString() ?? '';
  if (!encoding.includes('Identity')) return undefined;
  const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  if (!descendants || descendants.size() === 0) return undefined;
  const desc = descendants.lookupMaybe(0, PDFDict);
  if (!desc) return undefined;
  const w = desc.lookupMaybe(PDFName.of('W'), PDFArray);
  if (!w) return undefined;

  let i = 0;
  const numAt = (idx: number): number | undefined => w.lookupMaybe(idx, PDFNumber)?.asNumber();
  while (i < w.size()) {
    const start = numAt(i);
    if (start === undefined) return undefined;
    i++;
    const arr = w.lookupMaybe(i, PDFArray);
    if (arr) {
      if (code >= start && code < start + arr.size()) {
        return arr.lookupMaybe(code - start, PDFNumber)?.asNumber();
      }
      i += 1;
    } else {
      const lo = numAt(i);
      const hi = numAt(i + 1);
      const width = numAt(i + 2);
      if (lo === undefined || hi === undefined || width === undefined) return undefined;
      if (code >= lo && code <= hi) return width;
      i += 3;
    }
  }
  return undefined;
}

