import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { boxesOverlap, normalizeRect, rectToBox, type Box, type PdfRect } from './geometry';
import {
  initialGState,
  interpretContent,
  formatNumber,
  warn,
  type InterpreterEnv,
} from './interpreter';
import { arrayNumbers, deref, get, getArray, getName, streamBytes } from './pdfObjects';
import { ResourceScope } from './resources';
import { RedactionError, type RedactReport } from './types';

const NEWLINE = Uint8Array.of(0x0a);

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Visible page area (CropBox ∩ MediaBox), as PDF.js uses for rendering. */
export function pageBounds(doc: PDFDocument, pageIndex: number): PdfRect {
  const page = doc.getPage(pageIndex);
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
}

/** Clamp rects to the visible page area, dropping degenerate ones. */
export function clampRects(rects: readonly PdfRect[], bounds: PdfRect): PdfRect[] {
  const out: PdfRect[] = [];
  for (const raw of rects) {
    const r = normalizeRect(raw);
    const x0 = Math.max(r.x, bounds.x);
    const y0 = Math.max(r.y, bounds.y);
    const x1 = Math.min(r.x + r.width, bounds.x + bounds.width);
    const y1 = Math.min(r.y + r.height, bounds.y + bounds.height);
    if (x1 - x0 > 0.01 && y1 - y0 > 0.01)
      out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return out;
}

function contentStreams(doc: PDFDocument, contents: PDFObject | undefined): PDFStream[] {
  const resolved = deref(doc.context, contents);
  if (resolved instanceof PDFStream) return [resolved];
  if (!(resolved instanceof PDFArray)) return [];
  const out: PDFStream[] = [];
  for (let i = 0; i < resolved.size(); i++) {
    const s = resolved.lookup(i);
    if (s instanceof PDFStream) out.push(s);
  }
  return out;
}

/**
 * Redact one page in place:
 *  1. interpret the concatenated content streams and strip what is under
 *     the boxes (text glyphs, images, form contents);
 *  2. write ONE new content stream: the redacted content wrapped in a
 *     balanced q…Q, followed by the opaque burn boxes in default user space;
 *  3. delete annotations that touch a box (plus their popups and replies).
 *
 * The original content streams are not modified (another page may share
 * them); they simply become unreachable and are dropped at save time.
 */
export function redactPage(
  doc: PDFDocument,
  pageIndex: number,
  rects: readonly PdfRect[],
  report: RedactReport,
): void {
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const node = page.node;
  const boxes = rects.map(rectToBox);

  const parts: Uint8Array[] = [];
  for (const stream of contentStreams(doc, node.get(PDFName.of('Contents')))) {
    const bytes = streamBytes(stream);
    if (!bytes) {
      throw new RedactionError(
        'undecodable-content',
        `Page ${pageIndex + 1} uses a content compression this tool cannot read, so its text cannot be removed safely.`,
      );
    }
    parts.push(bytes, NEWLINE);
  }
  const original = concat(parts);

  const env: InterpreterEnv = {
    ctx,
    boxes,
    pageNumber: pageIndex + 1,
    report,
    pageStats: { glyphs: 0, images: 0, forms: 0 },
  };
  const scope = new ResourceScope(ctx, node.Resources(), (dict) =>
    node.set(PDFName.of('Resources'), dict),
  );
  const result = interpretContent(original, scope, initialGState(), env);
  scope.finalize();

  let burn = 'q 0 0 0 rg 0 0 0 RG\n';
  for (const r of rects) {
    burn += `${formatNumber(r.x)} ${formatNumber(r.y)} ${formatNumber(r.width)} ${formatNumber(r.height)} re f\n`;
  }
  burn += 'Q\n';

  const final = concat([
    ascii('q\n'),
    result.bytes,
    ascii(`\n${result.inText ? 'ET\n' : ''}${'Q\n'.repeat(result.qDepth + 1)}`),
    ascii(burn),
  ]);
  node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(final)));
  report.rectsBurned += rects.length;

  removeAnnotations(doc, node, boxes, report);

  if (env.pageStats.glyphs === 0 && env.pageStats.images === 0 && env.pageStats.forms === 0) {
    warn(
      env,
      'nothing-removed',
      'warning',
      'No selectable text or whole image was found under the boxes on this page. If it is a scan or uses outlined text, the content is now hidden behind black boxes but was not removed from the file.',
    );
  }
  report.pagesProcessed++;
}

/** Delete annotations that intersect any box, with their popups/replies. */
function removeAnnotations(
  doc: PDFDocument,
  node: ReturnType<PDFDocument['getPage']>['node'],
  boxes: readonly Box[],
  report: RedactReport,
): void {
  const ctx = doc.context;
  const annots = deref(ctx, node.get(PDFName.of('Annots')));
  if (!(annots instanceof PDFArray)) return;

  const entries: { raw: PDFObject; dict: PDFDict | undefined }[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const d = deref(ctx, raw);
    entries.push({ raw, dict: d instanceof PDFDict ? d : undefined });
  }

  const removed = new Set<PDFObject>();
  const isRemoved = (o: PDFObject | undefined) => o !== undefined && removed.has(o);
  for (const e of entries) {
    if (!e.dict) continue;
    const r = arrayNumbers(getArray(e.dict, 'Rect'));
    if (r.length !== 4 || !r.every(Number.isFinite)) continue;
    const box = rectToBox(
      normalizeRect({ x: r[0]!, y: r[1]!, width: r[2]! - r[0]!, height: r[3]! - r[1]! }),
    );
    if (boxes.some((b) => boxesOverlap(box, b))) {
      removed.add(e.raw);
      removed.add(e.dict);
    }
  }
  // Popups and reply threads of removed annotations go too (fixpoint).
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entries) {
      if (!e.dict || removed.has(e.raw)) continue;
      const parent = e.dict.get(PDFName.of('Parent'));
      const irt = e.dict.get(PDFName.of('IRT'));
      const isPopupOfRemoved = getName(e.dict, 'Subtype') === 'Popup' && isRemoved(parent);
      if (isPopupOfRemoved || isRemoved(irt)) {
        removed.add(e.raw);
        removed.add(e.dict);
        grew = true;
      }
    }
    for (const e of entries) {
      if (!e.dict || !removed.has(e.raw)) continue;
      const popup = e.dict.get(PDFName.of('Popup'));
      if (popup && !removed.has(popup)) {
        removed.add(popup);
        grew = true;
      }
    }
  }
  if (removed.size === 0) return;

  const survivors = PDFArray.withContext(ctx);
  for (const e of entries) {
    if (removed.has(e.raw)) {
      report.annotationsRemoved++;
      if (e.dict) detachWidgetFromParent(ctx, e.raw, e.dict);
      if (e.raw instanceof PDFRef) ctx.delete(e.raw);
    } else {
      survivors.push(e.raw);
    }
  }
  if (survivors.size() === 0) node.delete(PDFName.of('Annots'));
  else node.set(PDFName.of('Annots'), survivors);
}

/** A removed form widget must also leave its field's /Kids array, or the
 *  field (and its value) would keep it reachable. */
function detachWidgetFromParent(ctx: PDFDocument['context'], raw: PDFObject, dict: PDFDict): void {
  if (getName(dict, 'Subtype') !== 'Widget') return;
  const parent = get(dict, 'Parent');
  if (!(parent instanceof PDFDict)) return;
  const kids = getArray(parent, 'Kids');
  if (!kids) return;
  const keep = PDFArray.withContext(ctx);
  for (let i = 0; i < kids.size(); i++) {
    const k = kids.get(i);
    if (k !== raw) keep.push(k);
  }
  parent.set(PDFName.of('Kids'), keep);
  // The field's value may contain the redacted text; clear it.
  parent.delete(PDFName.of('V'));
}
