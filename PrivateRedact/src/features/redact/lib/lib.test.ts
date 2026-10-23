import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildZip, redactedFileName, uniqueNames } from './download';
import { inspectPdf, intakeFiles, MAX_FILE_BYTES, type QueuedFile } from './fileIntake';
import {
  pdfRectToViewport,
  resolveScale,
  stepZoom,
  viewportRectToPdf,
  type ViewportLike,
} from './coordinates';
import { groupSelectionRects } from './selection';
import { charactersInsideRects } from './verifyRedaction';
import { fileStatus } from './results';
import { emptyReport } from '@/features/redact/engine/types';

const pdfFile = (name: string, body = '%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>') =>
  new File([body], name, { type: 'application/pdf' });

describe('download helpers', () => {
  it('derives redacted file names', () => {
    expect(redactedFileName('report.pdf')).toBe('report_redacted.pdf');
    expect(redactedFileName('REPORT.PDF')).toBe('REPORT_redacted.pdf');
    expect(redactedFileName('notes')).toBe('notes_redacted.pdf');
  });

  it('de-duplicates names for archives', () => {
    expect(uniqueNames(['a.pdf', 'b.pdf', 'A.pdf', 'a.pdf'])).toEqual([
      'a.pdf',
      'b.pdf',
      'A (2).pdf',
      'a (3).pdf',
    ]);
  });

  it('builds a readable zip', () => {
    const zip = buildZip([
      { name: 'x.pdf', bytes: Uint8Array.of(1, 2, 3) },
      { name: 'x.pdf', bytes: Uint8Array.of(4) },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['x (2).pdf', 'x.pdf']);
    expect(Array.from(files['x.pdf']!)).toEqual([1, 2, 3]);
  });
});

describe('file intake', () => {
  it('accepts real PDFs and detects encryption', async () => {
    expect(await inspectPdf(pdfFile('a.pdf'))).toEqual({ isPdf: true, encrypted: false });
    const enc = pdfFile('e.pdf', '%PDF-1.4\ntrailer << /Encrypt 5 0 R >>');
    expect(await inspectPdf(enc)).toEqual({ isPdf: true, encrypted: true });
  });

  it('rejects disguised, empty, duplicate and oversized files', async () => {
    const existing: QueuedFile[] = [
      {
        id: '1',
        file: pdfFile('dup.pdf'),
        name: 'dup.pdf',
        size: pdfFile('dup.pdf').size,
        encrypted: false,
      },
    ];
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.pdf');
    const { accepted, errors } = await intakeFiles(
      [
        pdfFile('ok.pdf'),
        new File(['MZ binary'], 'evil.pdf'),
        new File([], 'empty.pdf'),
        pdfFile('dup.pdf'),
        big,
      ],
      existing,
    );
    expect(accepted.map((f) => f.name)).toEqual(['ok.pdf']);
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toMatch(/evil\.pdf is not a PDF/);
  });
});

describe('coordinates', () => {
  // A fake viewport for an unrotated 600×800 pt page at scale 2.
  const vp: ViewportLike = {
    convertToPdfPoint: (x: number, y: number) => [x / 2, 800 - y / 2],
    convertToViewportPoint: (x: number, y: number) => [x * 2, (800 - y) * 2],
  };
  // The same page rotated 90° clockwise.
  const rotated: ViewportLike = {
    convertToPdfPoint: (x: number, y: number) => [y / 2, x / 2],
    convertToViewportPoint: (x: number, y: number) => [y * 2, x * 2],
  };

  it('round-trips rects through the viewport', () => {
    for (const v of [vp, rotated]) {
      const pdf = viewportRectToPdf(v, 100, 40, 60, 20);
      const back = pdfRectToViewport(v, pdf);
      expect(back.left).toBeCloseTo(100);
      expect(back.top).toBeCloseTo(40);
      expect(back.width).toBeCloseTo(60);
      expect(back.height).toBeCloseTo(20);
      expect(pdf.width).toBeGreaterThan(0);
      expect(pdf.height).toBeGreaterThan(0);
    }
  });

  it('resolves zoom modes', () => {
    const page = { width: 600, height: 800 };
    expect(resolveScale('fit-width', page, { width: 300, height: 100 })).toBeCloseTo(0.5);
    expect(resolveScale('fit-page', page, { width: 1200, height: 400 })).toBeCloseTo(0.5);
    expect(resolveScale('fit-page', page, { width: 9000, height: 9000 })).toBe(1.5); // capped
    expect(resolveScale(10, page, { width: 1, height: 1 })).toBe(4); // clamped
  });

  it('steps through zoom levels', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.9, 1)).toBe(1);
    expect(stepZoom(4, 1)).toBe(4);
  });
});

describe('text selection grouping', () => {
  it('merges glyph-run rects into one box per line', () => {
    const lines = groupSelectionRects(
      [
        { left: 110, top: 205, width: 20, height: 10 },
        { left: 135, top: 206, width: 30, height: 9 },
        { left: 110, top: 230, width: 40, height: 10 },
        { left: 0, top: 0, width: 0.1, height: 10 }, // degenerate, ignored
      ],
      100,
      200,
    );
    expect(lines).toEqual([
      { left: 10, top: 5, width: 55, height: 10 },
      { left: 10, top: 30, width: 40, height: 10 },
    ]);
  });
});

describe('verification heuristic', () => {
  const item = (str: string, x: number, y: number, width: number) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
  });

  it('counts only non-space characters whose centre is in a box', () => {
    const rects = [{ x: 100, y: 95, width: 30, height: 20 }];
    // "AB CD" from x=100, 10 pt per char: A,B inside; space skipped; C,D outside.
    expect(charactersInsideRects([item('AB CD', 100, 100, 50)], rects)).toBe(2);
    expect(charactersInsideRects([item('far', 400, 400, 30)], rects)).toBe(0);
  });

  it('classifies output files', () => {
    const report = emptyReport();
    expect(fileStatus({ report, verification: { charactersUnderBoxes: 0, pages: [] } })).toBe(
      'verified',
    );
    expect(fileStatus({ report, verification: null })).toBe('review');
    expect(fileStatus({ report, verification: { charactersUnderBoxes: 3, pages: [1] } })).toBe(
      'failed',
    );
    const warned = {
      ...report,
      warnings: [{ code: 'image-partial' as const, severity: 'warning' as const, message: '' }],
    };
    expect(
      fileStatus({ report: warned, verification: { charactersUnderBoxes: 0, pages: [] } }),
    ).toBe('review');
  });
});
