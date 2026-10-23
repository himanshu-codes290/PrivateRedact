import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { get, getDict, getName } from './pdfObjects';
import type { RedactReport } from './types';

/**
 * Document-level sanitisation, run after every page is redacted.
 *
 * Redacting page content is not enough: PDFs carry text in many places a
 * viewer does not draw on the page. This pass removes the usual suspects,
 * then garbage-collects every object no longer reachable from the
 * document root, so nothing removed above (or replaced earlier: original
 * content streams, deleted annotations, old revisions) is written out.
 */

/** Catalog entries that can carry document text, history or active content. */
const CATALOG_KEYS: Record<string, string> = {
  Metadata: 'XMP metadata',
  Outlines: 'bookmarks (outline)',
  StructTreeRoot: 'tagged-PDF structure tree',
  MarkInfo: 'tagged-PDF marker',
  PieceInfo: 'application private data',
  AA: 'document actions',
  OpenAction: 'open action',
  Threads: 'article threads',
  SpiderInfo: 'web-capture data',
  Perms: 'permissions / signatures',
  DSS: 'signature validation data',
  Legal: 'legal attestation',
  Collection: 'portfolio collection',
  URI: 'base URI',
  AcroForm: 'interactive form',
};

/** Page entries that can carry data unrelated to what is drawn. */
const PAGE_KEYS = ['Thumb', 'PieceInfo', 'Metadata', 'AA', 'StructParents', 'B', 'SeparationInfo'];

/** Annotation types that embed files or media. */
const ATTACHMENT_ANNOTS = new Set([
  'FileAttachment',
  'Sound',
  'Movie',
  'RichMedia',
  'Screen',
  '3D',
]);

export function sanitizeDocument(doc: PDFDocument, report: RedactReport): void {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const removed = new Set<string>();

  for (const [key, label] of Object.entries(CATALOG_KEYS)) {
    const name = PDFName.of(key);
    if (!catalog.has(name)) continue;
    // A plain destination array as OpenAction is harmless navigation.
    if (key === 'OpenAction' && get(catalog, key) instanceof PDFArray) continue;
    catalog.delete(name);
    removed.add(label);
  }

  // /Names: keep only named destinations (link targets); drop embedded
  // files, JavaScript, page templates, etc.
  const names = getDict(catalog, 'Names');
  if (names) {
    const kept = PDFDict.withContext(ctx);
    for (const [k, v] of names.entries()) {
      if (k.decodeText() === 'Dests') kept.set(k, v);
      else removed.add(namesLabel(k.decodeText()));
    }
    if (kept.keys().length > 0) catalog.set(PDFName.of('Names'), kept);
    else catalog.delete(PDFName.of('Names'));
  }

  const pageMode = getName(catalog, 'PageMode');
  if (pageMode === 'UseOutlines' || pageMode === 'UseAttachments') {
    catalog.set(PDFName.of('PageMode'), PDFName.of('UseNone'));
  }

  for (const page of doc.getPages()) {
    const node = page.node;
    for (const key of PAGE_KEYS) {
      if (node.has(PDFName.of(key))) {
        node.delete(PDFName.of(key));
        removed.add(key === 'Thumb' ? 'page thumbnails' : `page ${key}`);
      }
    }
    if (removeAttachmentAnnotations(doc, node)) removed.add('file attachment annotations');
  }

  // Replace the document information dictionary (title, author, subject,
  // keywords, creator tool, dates) with a minimal one.
  const info = ctx.lookup(ctx.trailerInfo.Info);
  if (info instanceof PDFDict && info.keys().length > 0)
    removed.add('document info (title, author, …)');
  ctx.trailerInfo.Info = undefined;
  doc.setProducer('PrivateRedact');
  doc.setCreator('PrivateRedact');
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  report.documentItemsRemoved = [...removed].sort();
}

function namesLabel(key: string): string {
  switch (key) {
    case 'EmbeddedFiles':
      return 'embedded files';
    case 'JavaScript':
      return 'document JavaScript';
    default:
      return `name tree /${key}`;
  }
}

function removeAttachmentAnnotations(doc: PDFDocument, node: PDFDict): boolean {
  const annots = node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return false;
  const keep = PDFArray.withContext(doc.context);
  let changed = false;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = annots.lookup(i);
    const subtype = dict instanceof PDFDict ? getName(dict, 'Subtype') : undefined;
    if (subtype && ATTACHMENT_ANNOTS.has(subtype)) {
      changed = true;
      if (raw instanceof PDFRef) doc.context.delete(raw);
    } else {
      keep.push(raw);
    }
  }
  if (changed) {
    if (keep.size() > 0) node.set(PDFName.of('Annots'), keep);
    else node.delete(PDFName.of('Annots'));
  }
  return changed;
}

/**
 * Delete every indirect object that is not reachable from the trailer's
 * /Root and /Info. pdf-lib writes ALL registered objects on save, so
 * without this pass replaced content streams, removed annotations and
 * leftovers from earlier incremental updates would still be in the file.
 */
export function collectGarbage(doc: PDFDocument): number {
  const ctx = doc.context;
  const reachable = new Set<PDFRef>();
  const queue: PDFObject[] = [];
  const roots = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  for (const r of roots) if (r) queue.push(r);

  while (queue.length > 0) {
    const obj = queue.pop()!;
    if (obj instanceof PDFRef) {
      if (reachable.has(obj)) continue;
      reachable.add(obj);
      const target = ctx.lookup(obj);
      if (target) queue.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) queue.push(v);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) queue.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      queue.push(obj.dict);
    }
  }

  let deleted = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) {
      ctx.delete(ref);
      deleted++;
    }
  }
  return deleted;
}
