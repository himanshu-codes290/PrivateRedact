import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseContentStream } from '../tokenizer';
import {
  coveredFraction,
  multiply,
  normalizeRect,
  transformBox,
  transformPoint,
  type Matrix,
} from '../geometry';
import { getFontInfo } from '../fonts';
import { formatName, formatNumber } from '../interpreter';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => String.fromCharCode(...b);

describe('tokenizer', () => {
  it('records operator names, operands and exact byte ranges', () => {
    const src = 'BT /F1 12 Tf (Hi) Tj ET';
    const ops = parseContentStream(bytes(src));
    expect(ops.map((o) => o.name)).toEqual(['BT', 'Tf', 'Tj', 'ET']);
    const tf = ops[1]!;
    expect(src.slice(tf.start, tf.end)).toBe('/F1 12 Tf');
    expect(tf.operands).toEqual([
      { t: 'name', v: 'F1' },
      { t: 'num', v: 12 },
    ]);
  });

  it('balances nested parentheses and decodes escapes', () => {
    const [op] = parseContentStream(bytes('(a(b)c\\)\\101\\n) Tj'));
    expect(op!.name).toBe('Tj');
    const s = op!.operands[0];
    expect(s?.t === 'str' && text(s.bytes)).toBe('a(b)c)A\n');
  });

  it('decodes hex strings, padding an odd final digit', () => {
    const [op] = parseContentStream(bytes('<48 65 6C6C 6F 7> Tj'));
    const s = op!.operands[0];
    expect(s?.t === 'str' && Array.from(s.bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x70]);
  });

  it('decodes #xx escapes in names', () => {
    const [op] = parseContentStream(bytes('/A#20B gs'));
    expect(op!.operands[0]).toEqual({ t: 'name', v: 'A B' });
  });

  it('parses TJ arrays with names and stray delimiters without hanging', () => {
    const ops = parseContentStream(bytes('[(a) -120 /X ) (b)] TJ ) ] } { > Q'));
    expect(ops.map((o) => o.name)).toEqual(['TJ', 'Q']);
    const arr = ops[0]!.operands[0];
    expect(arr?.t === 'array' && arr.items.map((i) => i.t)).toEqual(['str', 'num', 'name', 'str']);
  });

  it('survives unterminated strings, arrays and dictionaries', () => {
    for (const src of ['(never closed', '[ (a) (b)', '<< /A << /B 1 >>', '<414', '[[[[[[[[']) {
      expect(() => parseContentStream(bytes(src))).not.toThrow();
    }
  });

  it('caps array nesting depth', () => {
    const deep = `${'['.repeat(5000)}${']'.repeat(5000)} TJ`;
    const ops = parseContentStream(bytes(deep));
    expect(ops.at(-1)?.name).toBe('TJ');
  });

  it('skips comments and keeps dictionaries opaque', () => {
    const ops = parseContentStream(bytes('% comment (x) Tj\n/Span << /ActualText (a) >> BDC EMC'));
    expect(ops.map((o) => o.name)).toEqual(['BDC', 'EMC']);
    expect(ops[0]!.operands[1]).toEqual({ t: 'dict' });
  });

  it('consumes inline image data using its exact length', () => {
    // The binary payload contains "EI" — only the computed length finds the real end.
    const ops = parseContentStream(bytes('BI /W 4 /H 1 /CS /G /BPC 8 ID  EI \nEI Q'));
    expect(ops.map((o) => o.name)).toEqual(['BI', 'Q']);
  });

  it('finds the end of filtered inline images heuristically', () => {
    const ops = parseContentStream(bytes('BI /W 4 /H 4 /F /AHx ID 00ff00ff> EI\nQ'));
    expect(ops.map((o) => o.name)).toEqual(['BI', 'Q']);
    expect(ops[0]!.inlineImage?.F).toEqual({ t: 'name', v: 'AHx' });
  });
});

describe('geometry', () => {
  it('composes matrices in PDF order (apply A, then B)', () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const move: Matrix = [1, 0, 0, 1, 10, 20];
    expect(transformPoint(multiply(scale, move), 1, 1)).toEqual([12, 22]);
    expect(transformPoint(multiply(move, scale), 1, 1)).toEqual([22, 42]);
  });

  it('computes the bounding box of a rotated rectangle', () => {
    const rot90: Matrix = [0, 1, -1, 0, 0, 0];
    expect(transformBox(rot90, 0, 0, 10, 5)).toEqual({ x0: -5, y0: 0, x1: 0, y1: 10 });
  });

  it('measures union coverage without double counting overlaps', () => {
    const target = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const half = { x0: 0, y0: 0, x1: 5, y1: 10 };
    expect(coveredFraction(target, [half, half])).toBeCloseTo(0.5);
    expect(coveredFraction(target, [half, { x0: 5, y0: 0, x1: 10, y1: 10 }])).toBeCloseTo(1);
    expect(coveredFraction(target, [])).toBe(0);
  });

  it('normalises rectangles with negative extents', () => {
    expect(normalizeRect({ x: 10, y: 10, width: -4, height: -6 })).toEqual({
      x: 6,
      y: 4,
      width: 4,
      height: 6,
    });
  });
});

describe('serialisation', () => {
  it('formats numbers compactly and never emits -0 or NaN', () => {
    expect(formatNumber(1.234567)).toBe('1.2346');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('0');
  });

  it('escapes delimiter characters in names', () => {
    expect(formatName('A B/C')).toBe('/A#20B#2fC');
  });
});

describe('fonts', () => {
  it('splits codes using an embedded CMap codespace (mixed 1/2-byte)', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const cmap = ctx.stream(
      '1 begincodespacerange <00> <7F> endcodespacerange\n' +
        '1 begincodespacerange <8000> <FFFF> endcodespacerange\n' +
        '1 begincidrange <8000> <80FF> 100 endcidrange',
    );
    const font = ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      Encoding: ctx.register(cmap),
      DescendantFonts: [ctx.obj({ Subtype: 'CIDFontType0', DW: 1000, W: [101, [250]] })],
    });
    const info = getFontInfo(font);
    const codes = info.splitCodes(Uint8Array.of(0x41, 0x80, 0x01, 0x42));
    expect(codes.map((c) => [c.length, c.code])).toEqual([
      [1, 0x41],
      [2, 0x8001],
      [1, 0x42],
    ]);
    expect(info.width(0x8001)).toBeCloseTo(0.25); // CID 101 → 250/1000
    expect(info.width(0x8002)).toBeCloseTo(1); // falls back to DW
    expect(info.estimated).toBe(false);
  });

  it('marks fonts without metrics as estimated', () => {
    expect(getFontInfo(undefined).estimated).toBe(true);
  });
});
