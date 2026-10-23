import { PDFName, type PDFContext, type PDFDict, type PDFStream } from 'pdf-lib';
import {
  IDENTITY,
  boxesOverlap,
  coveredFraction,
  multiply,
  transformBox,
  type Box,
  type Matrix,
} from './geometry';
import { getFontInfo, type FontInfo } from './fonts';
import { arrayNumbers, cloneDict, getArray, getDict, getName, streamBytes } from './pdfObjects';
import { ResourceScope } from './resources';
import { parseContentStream, type Op, type Operand } from './tokenizer';
import type { RedactReport, RedactionWarning, WarningCode } from './types';

/**
 * Content-stream interpreter that REMOVES what lies under redaction boxes.
 *
 * It replays the PDF graphics model just far enough to know where every
 * glyph, image and form lands on the page:
 *
 *   glyph space ─[Tfs·Th 0 0 Tfs pen rise]─▶ text space ─Tm─▶ user space (via CTM)
 *
 * and then edits the original bytes in place:
 *
 *  - Text-showing operators (Tj, TJ, ', ") that contain a glyph under a box
 *    are rewritten glyph by glyph into a TJ array. Each removed glyph is
 *    replaced by a numeric adjustment equal to its advance, so text that is
 *    NOT under a box keeps its exact position (no reflow, no shifting).
 *  - Images (XObject or inline) fully under boxes are deleted. Partially
 *    covered images are reported (they stay in the file, burned over).
 *  - Form XObjects that reach a box are interpreted recursively and replaced
 *    by a redacted copy; the shared original is never mutated.
 *  - Marked-content spans that lost glyphs drop their property list, so
 *    /ActualText or /Alt cannot leak the removed words.
 */

/** Minimum share of a glyph's box that must be covered to remove it. */
const GLYPH_COVERAGE_THRESHOLD = 0.2;
/** Share of an image that must be covered to delete it outright. */
const IMAGE_COVERAGE_THRESHOLD = 0.98;
/** Maximum Form XObject nesting before failing closed. */
const MAX_FORM_DEPTH = 12;

export interface TextGState {
  ctm: Matrix;
  charSpacing: number;
  wordSpacing: number;
  /** Horizontal scaling as a fraction (Tz 100 → 1). */
  hScale: number;
  leading: number;
  fontSize: number;
  rise: number;
  font: FontInfo;
}

export function initialGState(ctm: Matrix = IDENTITY): TextGState {
  return {
    ctm,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    fontSize: 0,
    rise: 0,
    font: getFontInfo(undefined),
  };
}

/** Shared, mutable state for one redaction job. */
export interface InterpreterEnv {
  ctx: PDFContext;
  /** Redaction boxes in default user space of the page being processed. */
  boxes: readonly Box[];
  /** 1-based page number, for warnings. */
  pageNumber: number;
  report: RedactReport;
  /** Per-page counters used to decide on the "nothing removed" warning. */
  pageStats: { glyphs: number; images: number; forms: number };
}

export interface InterpretResult {
  bytes: Uint8Array;
  changed: boolean;
  /** Unbalanced `q` depth at the end of the stream. */
  qDepth: number;
  /** True when the stream ends inside BT … ET. */
  inText: boolean;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface MarkedContent {
  tag: string;
  op: Op;
  hasProperties: boolean;
  touched: boolean;
}

export function warn(
  env: InterpreterEnv,
  code: WarningCode,
  severity: RedactionWarning['severity'],
  message: string,
): void {
  const exists = env.report.warnings.some((w) => w.code === code && w.page === env.pageNumber);
  if (!exists) env.report.warnings.push({ code, page: env.pageNumber, severity, message });
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

function hexString(bytes: Uint8Array): string {
  let s = '<';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return `${s}>`;
}

export function formatName(name: string): string {
  let s = '/';
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c < 0x21 || c > 0x7e || '()<>[]{}/%#'.includes(ch)) {
      s += `#${c.toString(16).padStart(2, '0')}`;
    } else {
      s += ch;
    }
  }
  return s;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function applyEdits(data: Uint8Array, edits: Edit[]): Uint8Array {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const chunks: Uint8Array[] = [];
  let last = 0;
  let total = 0;
  for (const e of sorted) {
    if (e.start < last) continue; // overlapping edit (cannot happen for disjoint ops)
    const keep = data.subarray(last, e.start);
    const repl = latin1(` ${e.text} `); // pad so tokens never glue together
    chunks.push(keep, repl);
    total += keep.length + repl.length;
    last = e.end;
  }
  const tail = data.subarray(last);
  chunks.push(tail);
  total += tail.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

const num = (o: Operand | undefined, fallback = 0): number => (o?.t === 'num' ? o.v : fallback);

function matrixFrom(operands: Operand[]): Matrix | undefined {
  if (operands.length < 6) return undefined;
  const m = operands.slice(-6).map((o) => num(o, NaN));
  return m.every(Number.isFinite) ? (m as unknown as Matrix) : undefined;
}

/**
 * Redact one content stream. `scope` resolves names used by the stream;
 * `gs` is the graphics state in effect when the stream starts.
 */
export function interpretContent(
  data: Uint8Array,
  scope: ResourceScope,
  gs0: TextGState,
  env: InterpreterEnv,
  depth = 0,
  path: ReadonlySet<PDFStream> = new Set(),
): InterpretResult {
  const ops = parseContentStream(data);
  const edits: Edit[] = [];
  const stack: TextGState[] = [];
  const marked: MarkedContent[] = [];
  let gs: TextGState = { ...gs0 };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let inText = false;
  let qDepth = 0;

  const touchMarked = () => {
    for (const m of marked) m.touched = true;
  };

  /** A glyph is removed when ≥20 % of its box is covered, or its centre is. */
  const shouldRemove = (box: Box): boolean => {
    if (!env.boxes.some((b) => boxesOverlap(box, b))) return false;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    if (env.boxes.some((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)) return true;
    return coveredFraction(box, env.boxes) >= GLYPH_COVERAGE_THRESHOLD;
  };

  const nextLine = () => {
    tlm = multiply([1, 0, 0, 1, 0, -gs.leading], tlm);
    tm = tlm;
  };

  const showText = (op: Op, elements: Operand[], prefix: string) => {
    const font = gs.font;
    const fs = gs.fontSize;
    const th = gs.hScale;
    const textToUser = multiply(tm, gs.ctm);
    let pen = 0; // text-space displacement along the writing direction

    interface Glyph {
      bytes: Uint8Array;
      remove: boolean;
      /** Displacement in text space (before Th), used to build adjustments. */
      displacement: number;
      overlaps: boolean;
    }
    type Element = { kind: 'num'; v: number } | { kind: 'glyphs'; glyphs: Glyph[] };
    const items: Element[] = [];
    let removedCount = 0;
    let anyOverlap = false;

    for (const el of elements) {
      if (el.t === 'num') {
        items.push({ kind: 'num', v: el.v });
        pen += font.vertical ? -(el.v / 1000) * fs : -(el.v / 1000) * fs * th;
        continue;
      }
      if (el.t !== 'str') continue;
      const glyphs: Glyph[] = [];
      for (const code of font.splitCodes(el.bytes)) {
        const isSpace = code.length === 1 && code.code === 32;
        const spacing = gs.charSpacing + (isSpace ? gs.wordSpacing : 0);
        let box: Box;
        let displacement: number;
        if (font.vertical) {
          const w0 = Math.max(font.width(code.code), 0.5);
          const w1 = font.verticalAdvance(code.code);
          const g: Matrix = multiply([fs * th, 0, 0, fs, 0, pen], textToUser);
          box = transformBox(g, -w0 / 2 - 0.05, Math.min(w1, -1) - 0.05, w0 / 2 + 0.05, 0.12);
          displacement = w1 * fs + spacing;
          pen += displacement;
        } else {
          const w0 = font.width(code.code);
          const g: Matrix = multiply([fs * th, 0, 0, fs, pen, gs.rise], textToUser);
          box = transformBox(g, 0, font.descent, Math.max(w0, 0.1), font.ascent);
          displacement = w0 * fs + spacing;
          pen += displacement * th;
        }
        const overlaps = env.boxes.some((b) => boxesOverlap(box, b));
        const remove = overlaps && shouldRemove(box);
        if (overlaps) anyOverlap = true;
        if (remove) removedCount++;
        glyphs.push({
          bytes: el.bytes.subarray(code.offset, code.offset + code.length),
          remove,
          displacement,
          overlaps,
        });
      }
      items.push({ kind: 'glyphs', glyphs });
    }

    // Fonts without usable metrics: glyph positions are guesses, so be
    // conservative and drop every glyph of an operator that reaches a box.
    if (font.estimated && anyOverlap) {
      for (const it of items) {
        if (it.kind !== 'glyphs') continue;
        for (const g of it.glyphs) {
          if (!g.remove) {
            g.remove = true;
            removedCount++;
          }
        }
      }
      warn(
        env,
        'metrics-estimated',
        'info',
        'Some text uses a font without width information, so whole text runs touching a box were removed. Check that nothing outside the boxes disappeared.',
      );
    }
    if (font.vertical && anyOverlap) {
      warn(
        env,
        'vertical-text',
        'info',
        'Vertical text was found under a box. Its glyph positions are approximated, so check the result.',
      );
    }

    if (removedCount > 0) {
      // Rebuild as a TJ array: kept glyphs stay as hex strings, removed ones
      // become position adjustments of exactly their advance.
      const out: string[] = [];
      let hex: number[] = [];
      let pendingNum = 0;
      let hasPendingNum = false;
      const flushHex = () => {
        if (hex.length === 0) return;
        if (hasPendingNum) {
          out.push(formatNumber(pendingNum));
          pendingNum = 0;
          hasPendingNum = false;
        }
        out.push(hexString(Uint8Array.from(hex)));
        hex = [];
      };
      const pushNum = (v: number) => {
        flushHex();
        pendingNum += v;
        hasPendingNum = true;
      };
      for (const it of items) {
        if (it.kind === 'num') {
          pushNum(it.v);
          continue;
        }
        for (const g of it.glyphs) {
          if (!g.remove) {
            for (const b of g.bytes) hex.push(b);
          } else if (fs !== 0) {
            pushNum((-g.displacement * 1000) / fs);
          }
        }
      }
      flushHex();
      if (hasPendingNum) out.push(formatNumber(pendingNum));
      edits.push({ start: op.start, end: op.end, text: `${prefix}[${out.join(' ')}] TJ` });
      env.report.glyphsRemoved += removedCount;
      env.report.textOpsRewritten++;
      env.pageStats.glyphs += removedCount;
      touchMarked();
    }

    // Advance the text matrix by the ORIGINAL displacement (unchanged by
    // the rewrite, which preserves every advance).
    tm = font.vertical ? multiply([1, 0, 0, 1, 0, pen], tm) : multiply([1, 0, 0, 1, pen, 0], tm);
  };

  const imageBox = (): Box => transformBox(gs.ctm, 0, 0, 1, 1);

  const handleImage = (op: Op, name: string | undefined): void => {
    const box = imageBox();
    const covered = coveredFraction(box, env.boxes);
    if (covered >= IMAGE_COVERAGE_THRESHOLD) {
      edits.push({ start: op.start, end: op.end, text: '' });
      if (name) scope.markRemoved(name);
      env.report.imagesRemoved++;
      env.pageStats.images++;
      return;
    }
    if (name) scope.markUsed(name);
    if (covered > 0) {
      warn(
        env,
        'image-partial',
        'warning',
        'An image is only partly under a redaction box. The covered area is hidden behind a black box, but the full image is still stored in the file. Cover the whole image to remove it, or treat this file as covered rather than removed.',
      );
    }
  };

  const failClosedForm = (op: Op, name: string, why: string) => {
    edits.push({ start: op.start, end: op.end, text: '' });
    scope.markRemoved(name);
    warn(
      env,
      'xobject-removed',
      'warning',
      `${why} It overlapped a redaction box, so it was removed entirely.`,
    );
  };

  const handleForm = (op: Op, name: string, stream: PDFStream): void => {
    const dict = stream.dict;
    const matrix = arrayNumbers(getArray(dict, 'Matrix'));
    const formMatrix: Matrix =
      matrix.length === 6 && matrix.every(Number.isFinite)
        ? (matrix as unknown as Matrix)
        : IDENTITY;
    const formCtm = multiply(formMatrix, gs.ctm);
    const bbox = arrayNumbers(getArray(dict, 'BBox'));
    const reach =
      bbox.length === 4 && bbox.every(Number.isFinite)
        ? transformBox(formCtm, bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!)
        : undefined;
    if (reach && !env.boxes.some((b) => boxesOverlap(reach, b))) {
      scope.markUsed(name);
      return;
    }
    if (path.has(stream) || depth >= MAX_FORM_DEPTH) {
      failClosedForm(op, name, 'A deeply nested or self-referencing form could not be inspected.');
      return;
    }
    const bytes = streamBytes(stream);
    if (!bytes) {
      failClosedForm(
        op,
        name,
        'A form object uses an unsupported compression and could not be inspected.',
      );
      return;
    }

    let childResources: PDFDict | undefined;
    const ownResources = getDict(dict, 'Resources');
    const childScope = ownResources
      ? new ResourceScope(env.ctx, ownResources, (d) => {
          childResources = d;
        })
      : scope; // legacy: forms without /Resources inherit the parent's
    const childPath = new Set(path);
    childPath.add(stream);
    const result = interpretContent(
      bytes,
      childScope,
      { ...gs, ctm: formCtm },
      env,
      depth + 1,
      childPath,
    );
    if (childScope !== scope) childScope.finalize();

    if (!result.changed) {
      scope.markUsed(name);
      return;
    }
    const copy = env.ctx.flateStream(result.bytes);
    const meta = cloneDict(env.ctx, dict, [
      'Filter',
      'DecodeParms',
      'Length',
      'DL',
      'Metadata',
      'PieceInfo',
      'LastModified',
    ]);
    for (const [k, v] of meta.entries()) copy.dict.set(k, v);
    if (childResources) copy.dict.set(PDFName.of('Resources'), childResources);
    const newName = scope.addXObject(env.ctx.register(copy));
    scope.markRemoved(name);
    edits.push({ start: op.start, end: op.end, text: `${formatName(newName)} Do` });
    env.report.formXObjectsRewritten++;
    env.pageStats.forms++;
  };

  for (const op of ops) {
    const a = op.operands;
    switch (op.name) {
      case 'q':
        stack.push({ ...gs });
        qDepth++;
        break;
      case 'Q':
        if (stack.length > 0) gs = stack.pop()!;
        qDepth = Math.max(0, qDepth - 1);
        break;
      case 'cm': {
        const m = matrixFrom(a);
        if (m) gs = { ...gs, ctm: multiply(m, gs.ctm) };
        break;
      }
      case 'BT':
        inText = true;
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'ET':
        inText = false;
        break;
      case 'Tc':
        gs.charSpacing = num(a[0]);
        break;
      case 'Tw':
        gs.wordSpacing = num(a[0]);
        break;
      case 'Tz':
        gs.hScale = num(a[0], 100) / 100;
        break;
      case 'TL':
        gs.leading = num(a[0]);
        break;
      case 'Ts':
        gs.rise = num(a[0]);
        break;
      case 'Tf': {
        const [fontName, size] = a;
        gs.font = getFontInfo(fontName?.t === 'name' ? scope.font(fontName.v) : undefined);
        gs.fontSize = num(size);
        break;
      }
      case 'Td':
        tlm = multiply([1, 0, 0, 1, num(a[0]), num(a[1])], tlm);
        tm = tlm;
        break;
      case 'TD':
        gs.leading = -num(a[1]);
        tlm = multiply([1, 0, 0, 1, num(a[0]), num(a[1])], tlm);
        tm = tlm;
        break;
      case 'Tm': {
        const m = matrixFrom(a);
        if (m) {
          tm = m;
          tlm = m;
        }
        break;
      }
      case 'T*':
        nextLine();
        break;
      case 'Tj':
        if (a[0]) showText(op, [a[0]], '');
        break;
      case 'TJ':
        if (a[0]?.t === 'array') showText(op, a[0].items, '');
        break;
      case "'":
        nextLine();
        if (a[0]) showText(op, [a[0]], 'T* ');
        break;
      case '"': {
        const aw = num(a[0]);
        const ac = num(a[1]);
        gs.wordSpacing = aw;
        gs.charSpacing = ac;
        nextLine();
        if (a[2]) {
          showText(op, [a[2]], `${formatNumber(aw)} Tw ${formatNumber(ac)} Tc T* `);
        }
        break;
      }
      case 'BMC':
        marked.push({
          tag: a[0]?.t === 'name' ? a[0].v : 'Span',
          op,
          hasProperties: false,
          touched: false,
        });
        break;
      case 'BDC':
        marked.push({
          tag: a[0]?.t === 'name' ? a[0].v : 'Span',
          op,
          hasProperties: true,
          touched: false,
        });
        break;
      case 'EMC': {
        const m = marked.pop();
        // Drop property lists (ActualText, Alt, E, MCID) of spans that lost
        // glyphs. Optional-content spans (/OC) are kept: their properties
        // control visibility, not text.
        if (m?.touched && m.hasProperties && m.tag !== 'OC') {
          edits.push({ start: m.op.start, end: m.op.end, text: `${formatName(m.tag)} BMC` });
        }
        break;
      }
      case 'BI':
        handleImage(op, undefined);
        break;
      case 'Do': {
        const nameOp = a[0];
        if (nameOp?.t !== 'name') break;
        const { stream } = scope.xobject(nameOp.v);
        if (!stream) break;
        const subtype = getName(stream.dict, 'Subtype');
        if (subtype === 'Image') handleImage(op, nameOp.v);
        else if (subtype === 'Form') handleForm(op, nameOp.v, stream);
        else scope.markUsed(nameOp.v);
        break;
      }
      default:
        break;
    }
  }
  void inText;

  if (edits.length === 0) return { bytes: data, changed: false, qDepth, inText };
  return { bytes: applyEdits(data, edits), changed: true, qDepth, inText };
}
