import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unzipSync } from 'fflate';
import type * as pdfjsLegacy from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Letter-size fixtures, in PDF points (origin bottom-left). */
export const PAGE_W = 612;
export const PAGE_H = 792;

export interface TextLine {
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  size: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SECRET_LINE: TextLine = { text: 'SECRET-12345', x: 72, y: 700, size: 24 };
export const PUBLIC_LINE: TextLine = { text: 'Public line stays', x: 72, y: 600, size: 18 };
export const PAGE2_LINE: TextLine = { text: 'Second page text', x: 72, y: 700, size: 18 };

/** A box in PDF space that comfortably covers one text line and nothing else. */
export function boxFor(line: TextLine): PdfRect {
  return {
    x: line.x - 6,
    y: line.y - line.size * 0.35,
    width: line.text.length * line.size * 0.72 + 12,
    height: line.size * 1.35,
  };
}

export async function buildPdf(pages: readonly (readonly TextLine[])[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const l of lines) page.drawText(l.text, { x: l.x, y: l.y, size: l.size, font });
  }
  return Buffer.from(await doc.save());
}

/** One page: a secret line near the top and a public line below it. */
export const samplePdf = (): Promise<Buffer> => buildPdf([[SECRET_LINE, PUBLIC_LINE]]);

/** Two pages: the sample page, then a page with its own line. */
export const twoPagePdf = (): Promise<Buffer> =>
  buildPdf([[SECRET_LINE, PUBLIC_LINE], [PAGE2_LINE]]);

/**
 * A readable PDF that the intake check classifies as encrypted. The app only
 * looks for the `/Encrypt` token in the trailer area, so a trailing comment is
 * enough to exercise the "viewable but not redactable" path.
 */
export async function fakeEncryptedPdf(): Promise<Buffer> {
  const base = await samplePdf();
  return Buffer.concat([base, Buffer.from('\n% /Encrypt marker for tests\n')]);
}

/** Bytes that are not a PDF at all. */
export const notAPdf = (): Buffer => Buffer.from('this is plain text, not a pdf', 'utf8');

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export function pdfFile(name: string, buffer: Buffer): FilePayload {
  return { name, mimeType: 'application/pdf', buffer };
}

type PdfjsLegacy = typeof pdfjsLegacy;
let pdfjsPromise: Promise<PdfjsLegacy> | null = null;

// PDF.js 6 needs Promise.withResolvers (Node >= 22); polyfill for older Node.
const P = Promise as unknown as { withResolvers?: unknown };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/**
 * Extract the text of every page with PDF.js running in Node. This is an
 * independent read of the downloaded bytes, separate from anything the app
 * reports about itself.
 */
export async function extractText(bytes: Uint8Array): Promise<string[]> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsPromise;
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  await task.destroy();
  return pages;
}

export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
