import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFDict } from 'pdf-lib';
import { redactPdf } from '../redactPdf';
import { RedactionError } from '../types';
import type { PdfRect } from '../geometry';
import {
  buildPdf,
  extractText,
  findLeaks,
  formXObject,
  grayImage,
  pageContent,
  pageText,
} from './helpers';

/*
 * Helvetica metrics used below (1/1000 em): H 722, E 667, L 556, O 778,
 * W 944, R 722, D 722, S 667, C 722, T 611, space 278.
 * At 20 pt "HELLO" spans 65.58 pt, so with the pen at x=100 it covers
 * x ∈ [100, 165.6] and "WORLD" starts at x = 171.14.
 */
const HELLO_BOX: PdfRect = { x: 98, y: 696, width: 68, height: 22 };

async function redact(bytes: Uint8Array, rects: (PdfRect[] | undefined)[]) {
  return redactPdf(bytes, rects);
}

describe('text removal', () => {
  it('removes only the glyphs under the box and keeps the rest in place', async () => {
    const input = await buildPdf([{ content: 'BT /F1 20 Tf 100 700 Td (HELLO WORLD) Tj ET' }]);
    const before = (await extractText(input))[0]!;
    const { bytes, report } = await redact(input, [[HELLO_BOX]]);

    expect(await findLeaks(bytes, 'HELLO')).toEqual([]);
    const after = (await extractText(bytes))[0]!;
    expect(pageText(after)).toContain('WORLD');
    expect(pageText(after)).not.toContain('HELLO');

    // WORLD must not move: it starts after "HELLO " exactly as before.
    const expectedX = before[0]!.x + (722 + 667 + 556 + 556 + 778 + 278) * 0.02;
    const world = after.find((i) => i.str === 'WORLD');
    expect(world).toBeDefined();
    expect(world!.x).toBeCloseTo(expectedX, 2);
    expect(world!.y).toBeCloseTo(700, 2);

    expect(report.glyphsRemoved).toBe(5);
    expect(report.textOpsRewritten).toBe(1);
    expect(report.rectsBurned).toBe(1);
  });

  it('catches glyphs hidden by large positive TJ kerning (net advance < 0)', async () => {
    // After "SECRET" the pen jumps far LEFT, so a naive origin→net-advance
    // box would miss SECRET entirely.
    const input = await buildPdf([
      { content: 'BT /F1 20 Tf 300 700 Td [(SECRET) 12000 (x)] TJ ET' },
    ]);
    const { bytes } = await redact(input, [[{ x: 298, y: 696, width: 82, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
  });

  it('carries graphics state across multiple /Contents streams', async () => {
    const input = await buildPdf([
      { content: ['q 1 0 0 1 200 400 cm BT /F1 20 Tf', '0 0 Td (SECRET) Tj ET Q'] },
    ]);
    const { bytes } = await redact(input, [[{ x: 198, y: 396, width: 82, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
  });

  it('restores text state on Q (font size set inside q…Q does not leak out)', async () => {
    // Font size 60 inside q…Q; after Q the size is 10 again, so SECRET is
    // small and fully inside the box. A wrong (60 pt) size would place most
    // of the glyph boxes outside it and keep them.
    const input = await buildPdf([
      { content: 'BT /F1 10 Tf q /F1 60 Tf Q 100 500 Td (SECRET) Tj ET' },
    ]);
    const { bytes, report } = await redact(input, [[{ x: 98, y: 496, width: 42, height: 14 }]]);
    expect(report.glyphsRemoved).toBe(6);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
  });

  it('handles \' and " operators without shifting later lines', async () => {
    const input = await buildPdf([
      {
        content: 'BT /F1 20 Tf 24 TL 100 700 Td (FIRST) Tj (SECRET) \' 0 0 (THIRD) " ET',
      },
    ]);
    const { bytes } = await redact(input, [[{ x: 98, y: 672, width: 80, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    const items = (await extractText(bytes))[0]!;
    const third = items.find((i) => i.str.includes('THIRD'))!;
    expect(third.y).toBeCloseTo(652, 0);
    const first = items.find((i) => i.str.includes('FIRST'))!;
    expect(first.y).toBeCloseTo(700, 0);
  });

  it('decodes 2-byte codes of Type0 / Identity-H fonts', async () => {
    const input = await buildPdf([
      {
        content: 'BT /F2 20 Tf 100 700 Td <0041004200430044> Tj ET',
        resources: (doc) => ({
          Font: doc.context.obj({
            F2: doc.context.obj({
              Type: 'Font',
              Subtype: 'Type0',
              BaseFont: 'Test',
              Encoding: 'Identity-H',
              DescendantFonts: [
                doc.context.obj({
                  Type: 'Font',
                  Subtype: 'CIDFontType2',
                  BaseFont: 'Test',
                  CIDSystemInfo: {
                    Registry: PDFString.of('Adobe'),
                    Ordering: PDFString.of('Identity'),
                    Supplement: 0,
                  },
                  DW: 1000,
                  W: [0x41, [500, 500, 500, 500]],
                }),
              ],
            }),
          }),
        }),
      },
    ]);
    // Each glyph is 10 pt wide: cover the first two (x 100..120).
    const { bytes, report } = await redact(input, [[{ x: 99, y: 695, width: 21, height: 25 }]]);
    expect(report.glyphsRemoved).toBe(2);
    const content = await pageContent(bytes, 0);
    expect(content).toContain('<00430044>');
    expect(content.toLowerCase()).not.toContain('0041');
    expect(content.toLowerCase()).not.toContain('0042');
  });

  it('is conservative for fonts without width information', async () => {
    const input = await buildPdf([
      {
        content: 'BT /F3 20 Tf 100 700 Td (AB SECRET) Tj ET',
        resources: (doc) => ({
          Font: doc.context.obj({
            F3: doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Unknown' }),
          }),
        }),
      },
    ]);
    const { bytes, report } = await redact(input, [[{ x: 150, y: 696, width: 40, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toContain('metrics-estimated');
  });

  it('drops /ActualText of marked-content spans that lost glyphs', async () => {
    const input = await buildPdf([
      {
        content:
          '/Span << /ActualText (SECRET) >> BDC BT /F1 20 Tf 100 700 Td (SECRET) Tj ET EMC ' +
          '/OC /oc1 BDC BT /F1 20 Tf 100 600 Td (VISIBLE) Tj ET EMC',
      },
    ]);
    const { bytes } = await redact(input, [[{ x: 98, y: 696, width: 82, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    const content = await pageContent(bytes, 0);
    expect(content).toContain('/Span BMC');
    expect(content).toContain('/OC /oc1 BDC'); // optional-content span untouched
  });
});

describe('robustness', () => {
  it('terminates on malformed and hostile content streams', async () => {
    const input = await buildPdf([
      {
        content:
          'BT /F1 12 Tf 100 700 Td (a(b)c) Tj ) ] } { > [/X (y) 3 ] TJ <414 Tj ' +
          '[[[[[ (deep) ]]]]] TJ (unterminated',
      },
    ]);
    const started = Date.now();
    const { report } = await redact(input, [[{ x: 90, y: 690, width: 100, height: 30 }]]);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(report.pagesProcessed).toBe(1);
  });

  it('closes unbalanced q and BT so burn boxes land in default user space', async () => {
    const input = await buildPdf([{ content: 'q q 1 0 0 1 300 300 cm BT /F1 12 Tf (x) Tj' }]);
    const { bytes } = await redact(input, [[{ x: 10, y: 10, width: 50, height: 50 }]]);
    const content = await pageContent(bytes, 0);
    expect(content).toMatch(/ET\nQ\nQ\nQ\nq 0 0 0 rg 0 0 0 RG\n10 10 50 50 re f\nQ/);
  });

  it('rejects encrypted PDFs with a typed error', async () => {
    const plain = await buildPdf([{ content: 'BT /F1 12 Tf (x) Tj ET' }]);
    const text = String.fromCharCode(...plain);
    const encrypted = text.replace(
      'trailer\n<<',
      'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>',
    );
    expect(encrypted).not.toBe(text);
    const bytes = Uint8Array.from(encrypted, (c) => c.charCodeAt(0));
    const err = await redact(bytes, [[]]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedactionError);
    expect((err as RedactionError).code).toBe('encrypted');
  });

  it('rejects non-PDF input with a typed error', async () => {
    const err = await redact(new TextEncoder().encode('hello'), []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedactionError);
    expect((err as RedactionError).code).toBe('unreadable');
  });

  it('reports progress monotonically up to 1', async () => {
    const input = await buildPdf([{ content: 'BT /F1 20 Tf 100 700 Td (HELLO) Tj ET' }]);
    const seen: number[] = [];
    await redactPdf(input, [[HELLO_BOX]], { onProgress: (p) => seen.push(p) });
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});

describe('shared objects', () => {
  it('does not blank other pages that share a content stream', async () => {
    const input = await buildPdf(
      [{ content: 'BT /F1 20 Tf 100 700 Td (HELLO) Tj ET' }, { content: '' }],
      (_doc, pages) => {
        // Page 2 reuses page 1's content stream object.
        pages[1]!.node.set(PDFName.of('Contents'), pages[0]!.node.get(PDFName.of('Contents'))!);
      },
    );
    const { bytes } = await redact(input, [[HELLO_BOX]]);
    const text = await extractText(bytes);
    expect(pageText(text[0]!)).not.toContain('HELLO');
    expect(pageText(text[1]!)).toContain('HELLO');
  });

  it('strips text inside a Form XObject without touching other pages using it', async () => {
    const input = await buildPdf([{ content: '/Fm1 Do' }, { content: '/Fm1 Do' }], (doc, pages) => {
      const form = formXObject(doc, 'BT /F1 20 Tf 100 700 Td (SECRET) Tj ET');
      for (const page of pages) {
        const res = page.node.Resources()!;
        res.set(PDFName.of('XObject'), doc.context.obj({ Fm1: form }));
      }
    });
    const { bytes, report } = await redact(input, [[{ x: 98, y: 696, width: 82, height: 22 }]]);
    const text = await extractText(bytes);
    expect(pageText(text[0]!)).not.toContain('SECRET');
    expect(pageText(text[1]!)).toContain('SECRET'); // not redacted there
    expect(report.formXObjectsRewritten).toBe(1);
  });

  it('leaves no copy of a Form XObject used only on the redacted page', async () => {
    const input = await buildPdf([{ content: 'q 1 0 0 1 0 0 cm /Fm1 Do Q' }], (doc, pages) => {
      const form = formXObject(doc, 'BT /F1 20 Tf 100 700 Td (SECRET) Tj ET');
      pages[0]!.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ Fm1: form }));
    });
    const { bytes } = await redact(input, [[{ x: 98, y: 696, width: 82, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
  });
});

describe('images', () => {
  const imagePage = (draw: string) =>
    buildPdf([{ content: draw }], (doc, pages) => {
      const img = grayImage(doc, 'IMGSECRETPIXELS!');
      pages[0]!.node.Resources()!.set(PDFName.of('XObject'), doc.context.obj({ Im1: img }));
    });

  it('deletes an image that is fully under a box', async () => {
    const input = await imagePage('q 100 0 0 50 200 300 cm /Im1 Do Q');
    const { bytes, report } = await redact(input, [[{ x: 190, y: 290, width: 120, height: 70 }]]);
    expect(report.imagesRemoved).toBe(1);
    expect(await findLeaks(bytes, 'IMGSECRETPIXELS')).toEqual([]);
  });

  it('keeps a partly covered image and warns', async () => {
    const input = await imagePage('q 100 0 0 50 200 300 cm /Im1 Do Q');
    const { report } = await redact(input, [[{ x: 190, y: 290, width: 40, height: 70 }]]);
    expect(report.imagesRemoved).toBe(0);
    expect(report.warnings.map((w) => w.code)).toContain('image-partial');
  });

  it('deletes a fully covered inline image', async () => {
    const input = await buildPdf([
      {
        content:
          'q 100 0 0 50 200 300 cm BI /W 16 /H 1 /CS /G /BPC 8 ID IMGSECRETPIXELS! EI Q ' +
          'BT /F1 12 Tf 50 50 Td (after) Tj ET',
      },
    ]);
    const { bytes, report } = await redact(input, [[{ x: 190, y: 290, width: 120, height: 70 }]]);
    expect(report.imagesRemoved).toBe(1);
    expect(await findLeaks(bytes, 'IMGSECRETPIXELS')).toEqual([]);
    expect(pageText((await extractText(bytes))[0]!)).toContain('after');
  });

  it('warns when nothing removable was found under a box', async () => {
    const input = await buildPdf([{ content: 'BT /F1 20 Tf 100 700 Td (HELLO) Tj ET' }]);
    const { report } = await redact(input, [[{ x: 300, y: 100, width: 50, height: 50 }]]);
    expect(report.warnings.map((w) => w.code)).toContain('nothing-removed');
  });
});

describe('annotations, forms and document data', () => {
  it('removes touching annotations with their popups, keeps the others', async () => {
    const input = await buildPdf([{ content: '' }], (doc, pages) => {
      const ctx = doc.context;
      const popup = ctx.register(
        ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [400, 400, 500, 500] }),
      );
      const note = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [110, 710, 90, 690], // reversed corners on purpose
          Contents: PDFString.of('SECRET note'),
          Popup: popup,
        }),
      );
      const other = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [10, 10, 30, 30],
          Contents: PDFString.of('kept'),
        }),
      );
      pages[0]!.node.set(PDFName.of('Annots'), ctx.obj([note, popup, other]));
    });
    const { bytes, report } = await redact(input, [[{ x: 80, y: 680, width: 40, height: 40 }]]);
    expect(report.annotationsRemoved).toBe(2);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it('flattens form fields so their values can be redacted', async () => {
    const input = await buildPdf([{ content: '' }], (doc, pages) => {
      const form = doc.getForm();
      const field = form.createTextField('name');
      field.setText('SECRETVALUE');
      field.addToPage(pages[0]!, { x: 100, y: 600, width: 200, height: 30 });
    });
    const { bytes, report } = await redact(input, [[{ x: 95, y: 595, width: 210, height: 40 }]]);
    expect(report.formFlattened).toBe(true);
    expect(await findLeaks(bytes, 'SECRETVALUE')).toEqual([]);
  });

  it('scrubs metadata, outlines, attachments and JavaScript', async () => {
    const input = await buildPdf(
      [{ content: 'BT /F1 20 Tf 100 700 Td (HELLO) Tj ET' }],
      (doc, pages) => {
        const ctx = doc.context;
        doc.setTitle('SECRET title');
        doc.setAuthor('SECRET author');
        doc.catalog.set(
          PDFName.of('Metadata'),
          ctx.register(
            ctx.stream('<x:xmpmeta><dc:title>SECRET</dc:title></x:xmpmeta>', {
              Type: 'Metadata',
              Subtype: 'XML',
            }),
          ),
        );
        const outlines = ctx.nextRef();
        const item = ctx.register(
          ctx.obj({
            Title: PDFString.of('SECRET chapter'),
            Parent: outlines,
            Dest: [pages[0]!.ref, 'Fit'],
          }),
        );
        ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
        doc.catalog.set(PDFName.of('Outlines'), outlines);
        const file = ctx.register(ctx.stream('SECRET attachment body', { Type: 'EmbeddedFile' }));
        const spec = ctx.register(
          ctx.obj({ Type: 'Filespec', F: PDFString.of('a.txt'), EF: { F: file } }),
        );
        const js = ctx.register(
          ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("SECRET")') }),
        );
        doc.catalog.set(
          PDFName.of('Names'),
          ctx.obj({
            EmbeddedFiles: { Names: [PDFString.of('a.txt'), spec] },
            JavaScript: { Names: [PDFString.of('js'), js] },
          }),
        );
      },
    );
    const { bytes, report } = await redact(input, [[HELLO_BOX]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    expect(report.documentItemsRemoved).toEqual(
      expect.arrayContaining([
        'XMP metadata',
        'bookmarks (outline)',
        'embedded files',
        'document JavaScript',
      ]),
    );
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getProducer()).toBe('PrivateRedact');
    expect(out.getTitle()).toBeUndefined();
  });

  it('leaves untouched pages renderable and keeps their text', async () => {
    const input = await buildPdf([
      { content: 'BT /F1 20 Tf 100 700 Td (HELLO) Tj ET' },
      { content: 'BT /F1 20 Tf 100 700 Td (PAGE TWO) Tj ET' },
    ]);
    const { bytes } = await redact(input, [[HELLO_BOX], undefined]);
    const text = await extractText(bytes);
    expect(pageText(text[1]!)).toContain('PAGE TWO');
  });

  it('works with pdf-lib generated text (standard font without /Widths)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('KEEP SECRET KEEP', { x: 100, y: 700, size: 20, font });
    const input = await doc.save();
    const start = 100 + font.widthOfTextAtSize('KEEP ', 20);
    const width = font.widthOfTextAtSize('SECRET', 20);
    const { bytes } = await redact(input, [
      [{ x: start - 1, y: 695, width: width + 2, height: 22 }],
    ]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    expect(pageText((await extractText(bytes))[0]!)).toMatch(/KEEP.*KEEP/);
  });
});

describe('edge cases that must fail closed', () => {
  it('removes a self-referencing Form XObject instead of looping', async () => {
    const input = await buildPdf([{ content: '/Fm1 Do' }], (doc, pages) => {
      const ctx = doc.context;
      const ref = ctx.nextRef();
      const xobjects = ctx.obj({});
      ctx.assign(
        ref,
        ctx.stream('BT /F1 20 Tf 100 700 Td (SECRET) Tj ET /Fm1 Do', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 612, 792],
          Resources: { XObject: xobjects },
        }),
      );
      xobjects.set(PDFName.of('Fm1'), ref);
      pages[0]!.node.Resources()!.set(PDFName.of('XObject'), ctx.obj({ Fm1: ref }));
    });
    const { bytes, report } = await redact(input, [[{ x: 98, y: 696, width: 82, height: 22 }]]);
    expect(await findLeaks(bytes, 'SECRET')).toEqual([]);
    expect(report.warnings.map((w) => w.code)).toContain('xobject-removed');
  });

  it('refuses pages whose content cannot be decoded', async () => {
    const input = await buildPdf([{ content: 'garbage' }], (doc, pages) => {
      const stream = doc.context.stream('xx', { Filter: 'DCTDecode' });
      pages[0]!.node.set(PDFName.of('Contents'), doc.context.register(stream));
    });
    const err = await redact(input, [[HELLO_BOX]]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedactionError);
    expect((err as RedactionError).code).toBe('undecodable-content');
  });

  it('uses Type3 widths scaled by the FontMatrix', async () => {
    const input = await buildPdf([
      {
        content: 'BT /T3 20 Tf 100 700 Td (ABCD) Tj ET',
        resources: (doc) => ({
          Font: doc.context.obj({
            T3: doc.context.obj({
              Type: 'Font',
              Subtype: 'Type3',
              FontMatrix: [0.01, 0, 0, 0.01, 0, 0],
              FontBBox: [0, -20, 50, 80],
              FirstChar: 65,
              LastChar: 68,
              Widths: [50, 50, 50, 50],
              CharProcs: {},
              Encoding: { Differences: [65, 'a', 'b', 'c', 'd'] },
              Resources: {},
            }),
          }),
        }),
      },
    ]);
    // Each glyph: 50 × 0.01 × 20 = 10 pt. Cover C and D (x 120..140).
    const { bytes, report } = await redact(input, [[{ x: 119, y: 695, width: 22, height: 25 }]]);
    expect(report.glyphsRemoved).toBe(2);
    const content = await pageContent(bytes, 0);
    expect(content).toContain('<4142>');
  });

  it('approximates vertical (Identity-V) text and flags it', async () => {
    const input = await buildPdf([
      {
        content: 'BT /V1 20 Tf 300 700 Td <00410042> Tj ET',
        resources: (doc) => ({
          Font: doc.context.obj({
            V1: doc.context.obj({
              Type: 'Font',
              Subtype: 'Type0',
              BaseFont: 'V',
              Encoding: 'Identity-V',
              DescendantFonts: [doc.context.obj({ Subtype: 'CIDFontType2', DW: 1000 })],
            }),
          }),
        }),
      },
    ]);
    // Glyphs run downwards from y=700: the first occupies roughly 680..700.
    const { report } = await redact(input, [[{ x: 285, y: 678, width: 30, height: 24 }]]);
    expect(report.glyphsRemoved).toBe(1);
    expect(report.warnings.map((w) => w.code)).toContain('vertical-text');
  });

  it('clears the value of a form field whose widget is removed', async () => {
    const input = await buildPdf([{ content: '' }], (doc, pages) => {
      const ctx = doc.context;
      const field = ctx.register(
        ctx.obj({ FT: 'Tx', T: PDFString.of('ssn'), V: PDFString.of('SECRET-SSN') }),
      );
      const widget = ctx.register(
        ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [100, 600, 300, 630], Parent: field }),
      );
      (ctx.lookup(field) as PDFDict).set(PDFName.of('Kids'), ctx.obj([widget]));
      pages[0]!.node.set(PDFName.of('Annots'), ctx.obj([widget]));
    });
    const { bytes } = await redact(input, [[{ x: 95, y: 595, width: 210, height: 40 }]]);
    expect(await findLeaks(bytes, 'SECRET-SSN')).toEqual([]);
  });
});
