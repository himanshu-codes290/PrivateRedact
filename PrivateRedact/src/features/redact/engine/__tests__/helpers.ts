import type { PDFRef } from 'pdf-lib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFStream,
  PDFString,
  StandardFonts,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { streamBytes } from '../pdfObjects';

/**
 * Test fixtures and assertions for the redaction engine.
 *
 * Fixtures are generated with pdf-lib's low-level API so each test can
 * hand-write the exact content-stream operators it wants to exercise.
 */

export interface PageSpec {
  content: string | string[];
  /** Extra resources merged into the page /Resources (F1 = Helvetica). */
  resources?: (doc: PDFDocument) => Record<string, PDFObject>;
  size?: [number, number];
}

export async function buildPdf(
  pages: PageSpec[],
  customize?: (doc: PDFDocument, pages: PDFPage[]) => void | Promise<void>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const created: PDFPage[] = [];
  for (const spec of pages) {
    const page = doc.addPage(spec.size ?? [612, 792]);
    const ctx = doc.context;
    const fonts = ctx.obj({ F1: helvetica.ref });
    const resources = ctx.obj({ Font: fonts });
    if (spec.resources) {
      for (const [k, v] of Object.entries(spec.resources(doc))) resources.set(PDFName.of(k), v);
    }
    page.node.set(PDFName.of('Resources'), resources);
    const contents = Array.isArray(spec.content) ? spec.content : [spec.content];
    const refs = contents.map((c) => ctx.register(ctx.stream(c)));
    page.node.set(PDFName.of('Contents'), refs.length === 1 ? refs[0]! : ctx.obj(refs));
    created.push(page);
  }
  await customize?.(doc, created);
  return doc.save({ useObjectStreams: false });
}

/** Register a Form XObject whose content is `content`. */
export function formXObject(
  doc: PDFDocument,
  content: string,
  bbox: [number, number, number, number] = [0, 0, 612, 792],
): PDFRef {
  const ctx = doc.context;
  const fonts =
    (doc.getPage(0).node.Resources()?.lookup(PDFName.of('Font')) as PDFDict | undefined) ??
    ctx.obj({});
  return ctx.register(
    ctx.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: bbox,
      Resources: { Font: fonts },
    }),
  );
}

/** Register an 8-bit DeviceGray image whose samples are `samples`. */
export function grayImage(doc: PDFDocument, samples: string): PDFRef {
  return doc.context.register(
    doc.context.stream(samples, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: samples.length,
      Height: 1,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    }),
  );
}

function latin1(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function needles(secret: string): Uint8Array[] {
  const hex = [...secret].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const utf16 = [...secret]
    .map((c) => `00${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .join('');
  return [
    latin1(secret),
    latin1(hex),
    latin1(hex.toUpperCase()),
    latin1(utf16),
    latin1(utf16.toUpperCase()),
  ];
}

/**
 * Exhaustive leak check: returns a description of every place the secret
 * (as text, hex, or UTF-16 hex) survives, scanning the raw file bytes AND
 * every indirect object, with streams decoded.
 */
export async function findLeaks(bytes: Uint8Array, secret: string): Promise<string[]> {
  const found: string[] = [];
  const ns = needles(secret);
  if (ns.some((n) => indexOfBytes(bytes, n) >= 0)) found.push('raw file bytes');

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const where = `object ${ref.toString()}`;
    if (obj instanceof PDFStream) {
      const decoded = streamBytes(obj);
      if (decoded && ns.some((n) => indexOfBytes(decoded, n) >= 0)) found.push(`${where} (stream)`);
      if (dictContains(obj.dict, secret)) found.push(`${where} (stream dict)`);
    } else if (dictContains(obj, secret)) {
      found.push(where);
    }
  }
  return found;
}

function dictContains(obj: PDFObject, secret: string): boolean {
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.decodeText().includes(secret);
  if (obj instanceof PDFDict) {
    for (const [, v] of obj.entries()) if (dictContains(v, secret)) return true;
    return false;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) if (dictContains(obj.get(i), secret)) return true;
  }
  return false;
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
}

/** Extract positioned text with PDF.js (the same engine the app renders with). */
export async function extractText(bytes: Uint8Array): Promise<TextItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const pages: TextItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if ('str' in it && it.str.trim()) {
        items.push({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number });
      }
    }
    pages.push(items);
  }
  await task.destroy();
  return pages;
}

export function pageText(items: TextItem[]): string {
  return items.map((i) => i.str).join(' ');
}

/** Decoded content of every stream object in the file (for structural checks). */
export async function allStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let out = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const d = streamBytes(obj);
      if (d) out += `${String.fromCharCode(...d.subarray(0, 200_000))}\n`;
    }
  }
  return out;
}

/** Decoded content stream of one page (0-based). */
export async function pageContent(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i))
      : [contents];
  let out = '';
  for (const s of streams) {
    if (s instanceof PDFStream) {
      const d = streamBytes(s);
      if (d) out += String.fromCharCode(...d);
    }
  }
  return out;
}
