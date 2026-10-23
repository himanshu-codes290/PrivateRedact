import { Encodings, Font, type IFontNames } from '@pdf-lib/standard-fonts';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream } from 'pdf-lib';
import {
  arrayNumbers,
  get,
  getArray,
  getDict,
  getName,
  getNumber,
  streamBytes,
} from './pdfObjects';
import { parseContentStream } from './tokenizer';

/**
 * Font metrics needed to position glyphs exactly.
 *
 * All widths are NORMALISED: 1.0 = one em = the font size in text space.
 * (Simple and CID fonts store widths in 1/1000 em; Type3 uses FontMatrix.)
 */
export interface GlyphCode {
  /** Offset of the code inside the string bytes. */
  offset: number;
  /** Byte length of the code (1 for simple fonts, 1–4 for CID fonts). */
  length: number;
  /** The code value (big-endian for multi-byte codes). */
  code: number;
}

export interface FontInfo {
  /** Split a string operand into character codes. */
  splitCodes(bytes: Uint8Array): GlyphCode[];
  /** Horizontal advance of a code (normalised). */
  width(code: number): number;
  /** Vertical advance (normalised, negative = downwards) for WMode 1. */
  verticalAdvance(code: number): number;
  /** Top of the glyph box above the baseline (normalised). */
  ascent: number;
  /** Bottom of the glyph box below the baseline (normalised, negative). */
  descent: number;
  vertical: boolean;
  /** True when widths are guessed: the interpreter becomes conservative. */
  estimated: boolean;
}

const DEFAULT_ASCENT = 1.0;
const DEFAULT_DESCENT = -0.25;
const ESTIMATED_WIDTH = 1.0; // over-estimate on purpose (see interpreter)

const cache = new WeakMap<PDFDict, FontInfo>();

/** Metrics for a font dictionary, or a conservative fallback for `undefined`. */
export function getFontInfo(fontDict: PDFDict | undefined): FontInfo {
  if (!fontDict) return estimatedFont();
  const hit = cache.get(fontDict);
  if (hit) return hit;
  let info: FontInfo;
  try {
    const subtype = getName(fontDict, 'Subtype');
    if (subtype === 'Type0') info = type0Font(fontDict);
    else if (subtype === 'Type3') info = type3Font(fontDict);
    else info = simpleFont(fontDict);
  } catch {
    info = estimatedFont();
  }
  cache.set(fontDict, info);
  return info;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function singleByteCodes(bytes: Uint8Array): GlyphCode[] {
  const out: GlyphCode[] = new Array<GlyphCode>(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = { offset: i, length: 1, code: bytes[i]! };
  return out;
}

function estimatedFont(): FontInfo {
  return {
    splitCodes: singleByteCodes,
    width: () => ESTIMATED_WIDTH,
    verticalAdvance: () => -1,
    ascent: DEFAULT_ASCENT,
    descent: DEFAULT_DESCENT,
    vertical: false,
    estimated: true,
  };
}

/** Ascent/descent from a FontDescriptor, widened to stay conservative. */
function verticalMetrics(descriptor: PDFDict | undefined): { ascent: number; descent: number } {
  let ascent = getNumber(descriptor, 'Ascent');
  let descent = getNumber(descriptor, 'Descent');
  const bbox = arrayNumbers(getArray(descriptor, 'FontBBox'));
  if ((!ascent || ascent <= 0) && bbox.length === 4 && Number.isFinite(bbox[3])) ascent = bbox[3];
  if ((descent === undefined || descent >= 0) && bbox.length === 4 && Number.isFinite(bbox[1])) {
    descent = bbox[1];
  }
  const a = ascent && ascent > 0 ? ascent / 1000 : DEFAULT_ASCENT;
  const d = descent !== undefined && descent < 0 ? descent / 1000 : DEFAULT_DESCENT;
  // Clamp into a sane band: never thinner than typical glyphs (so we don't
  // under-detect), never absurdly tall (so we don't swallow adjacent lines).
  return {
    ascent: Math.min(1.2, Math.max(0.75, a)),
    descent: Math.max(-0.5, Math.min(-0.2, d)),
  };
}

// ---------------------------------------------------------------------------
// Simple fonts (Type1 / TrueType / MMType1)
// ---------------------------------------------------------------------------

const STANDARD_FAMILIES: [RegExp, [IFontNames, IFontNames, IFontNames, IFontNames]][] = [
  // [regular, bold, italic, bold-italic]
  [
    /^(helvetica|arial)/i,
    ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  ],
  [/^times/i, ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic']],
  [/^courier/i, ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']],
];

function standardFontName(baseFont: string): IFontNames | undefined {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '').replace(/[\s,]/g, '');
  if (/^symbol/i.test(name)) return 'Symbol';
  if (/^zapfdingbats/i.test(name)) return 'ZapfDingbats';
  for (const [re, variants] of STANDARD_FAMILIES) {
    if (!re.test(name)) continue;
    const bold = /bold/i.test(name);
    const italic = /(italic|oblique)/i.test(name);
    return variants[(bold ? 1 : 0) + (italic ? 2 : 0)];
  }
  return undefined;
}

const encodingNameCache = new Map<string, Map<number, string>>();

/** code → glyph name for the built-in encodings shipped with pdf-lib. */
function encodingNames(which: 'WinAnsi' | 'Symbol' | 'ZapfDingbats'): Map<number, string> {
  let map = encodingNameCache.get(which);
  if (map) return map;
  map = new Map();
  const enc = Encodings[which];
  for (const cp of enc.supportedCodePoints) {
    const { code, name } = enc.encodeUnicodeCodePoint(cp);
    if (!map.has(code)) map.set(code, name);
  }
  encodingNameCache.set(which, map);
  return map;
}

const standardFontCache = new Map<IFontNames, Font>();
function loadStandardFont(name: IFontNames): Font {
  let f = standardFontCache.get(name);
  if (!f) {
    f = Font.load(name);
    standardFontCache.set(name, f);
  }
  return f;
}

function simpleFont(dict: PDFDict): FontInfo {
  const descriptor = getDict(dict, 'FontDescriptor');
  const { ascent, descent } = verticalMetrics(descriptor);
  const firstChar = getNumber(dict, 'FirstChar') ?? 0;
  const widths = arrayNumbers(getArray(dict, 'Widths'));
  const missing = getNumber(descriptor, 'MissingWidth');

  if (widths.length > 0) {
    return {
      splitCodes: singleByteCodes,
      width: (code) => {
        const w = widths[code - firstChar];
        if (w !== undefined && Number.isFinite(w)) return w / 1000;
        return (missing ?? 0) / 1000;
      },
      verticalAdvance: () => -1,
      ascent,
      descent,
      vertical: false,
      estimated: false,
    };
  }

  // No /Widths: only legal for the standard 14 fonts. Use their AFM metrics.
  const std = standardFontName(getName(dict, 'BaseFont') ?? '');
  if (std) {
    const metrics = loadStandardFont(std);
    const base = encodingNames(
      std === 'Symbol' ? 'Symbol' : std === 'ZapfDingbats' ? 'ZapfDingbats' : 'WinAnsi',
    );
    const names = new Map(base);
    const differences = getArray(getDict(dict, 'Encoding'), 'Differences');
    if (differences) {
      let code = 0;
      for (let i = 0; i < differences.size(); i++) {
        const v = differences.lookup(i);
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) names.set(code++, v.decodeText());
      }
    }
    const fbb = metrics.FontBBox;
    return {
      splitCodes: singleByteCodes,
      width: (code) => {
        const glyph = names.get(code);
        const w = glyph ? metrics.getWidthOfGlyph(glyph) : undefined;
        return typeof w === 'number' ? w / 1000 : 0.6;
      },
      verticalAdvance: () => -1,
      ascent: Math.max(ascent, Math.min(1.2, (metrics.Ascender ?? fbb[3]) / 1000)),
      descent: Math.min(descent, Math.max(-0.5, (metrics.Descender ?? fbb[1]) / 1000)),
      vertical: false,
      estimated: false,
    };
  }

  return { ...estimatedFont(), ascent, descent };
}

// ---------------------------------------------------------------------------
// Type3 fonts (glyphs are content-stream procedures; metrics via FontMatrix)
// ---------------------------------------------------------------------------

function type3Font(dict: PDFDict): FontInfo {
  const fm = arrayNumbers(getArray(dict, 'FontMatrix'));
  const sx = Math.abs(Number.isFinite(fm[0]) && fm[0] ? fm[0] : 0.001);
  const sy = Math.abs(Number.isFinite(fm[3]) && fm[3] ? fm[3] : 0.001);
  const firstChar = getNumber(dict, 'FirstChar') ?? 0;
  const widths = arrayNumbers(getArray(dict, 'Widths'));
  const bbox = arrayNumbers(getArray(dict, 'FontBBox'));
  const ascent = bbox.length === 4 && bbox[3]! > 0 ? Math.min(1.5, bbox[3]! * sy) : DEFAULT_ASCENT;
  const descent =
    bbox.length === 4 && bbox[1]! < 0 ? Math.max(-0.75, bbox[1]! * sy) : DEFAULT_DESCENT;
  return {
    splitCodes: singleByteCodes,
    width: (code) => {
      const w = widths[code - firstChar];
      return w !== undefined && Number.isFinite(w) ? w * sx : ESTIMATED_WIDTH;
    },
    verticalAdvance: () => -1,
    ascent: Math.max(ascent, 0.75),
    descent: Math.min(descent, -0.2),
    vertical: false,
    estimated: widths.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Type0 (composite / CID) fonts
// ---------------------------------------------------------------------------

interface CodespaceRange {
  length: number;
  low: Uint8Array;
  high: Uint8Array;
}

interface CMapData {
  codespace: CodespaceRange[];
  /** code → CID; undefined means identity. */
  toCid?: (code: number) => number;
  vertical: boolean;
}

function bytesToInt(bytes: Uint8Array, offset = 0, length = bytes.length): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + bytes[offset + i]!;
  return v;
}

const IDENTITY_CODESPACE: CodespaceRange[] = [
  { length: 2, low: Uint8Array.of(0, 0), high: Uint8Array.of(0xff, 0xff) },
];

/** Parse the parts of an embedded CMap stream that matter for geometry. */
function parseEmbeddedCMap(stream: PDFStream): CMapData | undefined {
  const bytes = streamBytes(stream);
  if (!bytes) return undefined;
  const codespace: CodespaceRange[] = [];
  const ranges: { lo: number; hi: number; cid: number }[] = [];
  const singles = new Map<number, number>();
  let vertical = getNumber(stream.dict, 'WMode') === 1;

  for (const op of parseContentStream(bytes)) {
    const a = op.operands;
    if (op.name === 'endcodespacerange') {
      for (let i = 0; i + 1 < a.length; i += 2) {
        const lo = a[i];
        const hi = a[i + 1];
        if (lo?.t === 'str' && hi?.t === 'str' && lo.bytes.length === hi.bytes.length) {
          codespace.push({ length: lo.bytes.length, low: lo.bytes, high: hi.bytes });
        }
      }
    } else if (op.name === 'endcidrange') {
      for (let i = 0; i + 2 < a.length; i += 3) {
        const lo = a[i];
        const hi = a[i + 1];
        const cid = a[i + 2];
        if (lo?.t === 'str' && hi?.t === 'str' && cid?.t === 'num') {
          ranges.push({ lo: bytesToInt(lo.bytes), hi: bytesToInt(hi.bytes), cid: cid.v });
        }
      }
    } else if (op.name === 'endcidchar') {
      for (let i = 0; i + 1 < a.length; i += 2) {
        const code = a[i];
        const cid = a[i + 1];
        if (code?.t === 'str' && cid?.t === 'num') singles.set(bytesToInt(code.bytes), cid.v);
      }
    } else if (op.name === 'def') {
      const [key, value] = a;
      if (key?.t === 'name' && key.v === 'WMode' && value?.t === 'num') vertical = value.v === 1;
    }
  }
  if (codespace.length === 0) return undefined;
  return {
    codespace,
    vertical,
    toCid: (code) => {
      const s = singles.get(code);
      if (s !== undefined) return s;
      for (const r of ranges) if (code >= r.lo && code <= r.hi) return r.cid + (code - r.lo);
      return 0;
    },
  };
}

function splitByCodespace(bytes: Uint8Array, ranges: CodespaceRange[]): GlyphCode[] {
  const out: GlyphCode[] = [];
  const minLen = Math.min(...ranges.map((r) => r.length));
  let i = 0;
  while (i < bytes.length) {
    let matched = 0;
    for (let len = 1; len <= 4 && !matched; len++) {
      if (i + len > bytes.length) break;
      for (const r of ranges) {
        if (r.length !== len) continue;
        let ok = true;
        for (let k = 0; k < len; k++) {
          const b = bytes[i + k]!;
          if (b < r.low[k]! || b > r.high[k]!) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matched = len;
          break;
        }
      }
    }
    const len = matched || Math.min(minLen, bytes.length - i);
    out.push({ offset: i, length: len, code: bytesToInt(bytes, i, len) });
    i += len;
  }
  return out;
}

/** Parse a CID font /W array: `c [w1 w2 …]` or `cFirst cLast w`. */
function parseCidWidths(w: PDFArray | undefined): Map<number, number> {
  const map = new Map<number, number>();
  if (!w) return map;
  let i = 0;
  while (i < w.size()) {
    const first = w.lookup(i);
    if (!(first instanceof PDFNumber)) break;
    const next = w.lookup(i + 1);
    if (next instanceof PDFArray) {
      const start = first.asNumber();
      const list = arrayNumbers(next);
      list.forEach((width, k) => {
        if (Number.isFinite(width)) map.set(start + k, width);
      });
      i += 2;
    } else {
      const last = next instanceof PDFNumber ? next.asNumber() : NaN;
      const widthObj = w.lookup(i + 2);
      const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : NaN;
      if (!Number.isFinite(last) || !Number.isFinite(width)) break;
      // Guard against absurd ranges in hostile files.
      const lo = first.asNumber();
      const hi = Math.min(last, lo + 65535);
      for (let c = lo; c <= hi; c++) map.set(c, width);
      i += 3;
    }
  }
  return map;
}

function type0Font(dict: PDFDict): FontInfo {
  const descendant = (() => {
    const arr = getArray(dict, 'DescendantFonts');
    const d = arr?.lookup(0);
    return d instanceof PDFDict ? d : undefined;
  })();
  const descriptor = getDict(descendant, 'FontDescriptor');
  const { ascent, descent } = verticalMetrics(descriptor);

  let cmap: CMapData;
  let estimated = false;
  const encoding = get(dict, 'Encoding');
  if (encoding instanceof PDFName) {
    const name = encoding.decodeText();
    cmap = { codespace: IDENTITY_CODESPACE, vertical: name.endsWith('-V') };
    // Predefined non-identity CMaps (e.g. UniJIS-UCS2-H) map codes to CIDs
    // through tables we do not ship: widths become estimates.
    if (!name.startsWith('Identity')) {
      cmap.toCid = () => -1;
      estimated = true;
    }
  } else if (encoding instanceof PDFStream) {
    const parsed = parseEmbeddedCMap(encoding);
    if (parsed) {
      cmap = parsed;
    } else {
      cmap = { codespace: IDENTITY_CODESPACE, vertical: false };
      estimated = true;
    }
  } else {
    cmap = { codespace: IDENTITY_CODESPACE, vertical: false };
  }

  const dw = getNumber(descendant, 'DW') ?? 1000;
  const widths = parseCidWidths(getArray(descendant, 'W'));
  const dw2 = arrayNumbers(getArray(descendant, 'DW2'));
  const vDefault = Number.isFinite(dw2[1]) ? dw2[1]! : -1000;

  const cidOf = (code: number) => (cmap.toCid ? cmap.toCid(code) : code);

  return {
    splitCodes: (bytes) => splitByCodespace(bytes, cmap.codespace),
    width: (code) => {
      if (estimated) return ESTIMATED_WIDTH;
      return (widths.get(cidOf(code)) ?? dw) / 1000;
    },
    verticalAdvance: () => vDefault / 1000,
    ascent,
    descent,
    vertical: cmap.vertical,
    estimated,
  };
}
