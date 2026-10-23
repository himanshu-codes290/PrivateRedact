import { EncryptedPDFError, PDFDocument, PDFName } from 'pdf-lib';
import type { PdfRect } from './geometry';
import { clampRects, pageBounds, redactPage } from './page';
import { collectGarbage, sanitizeDocument } from './sanitize';
import {
  RedactionError,
  emptyReport,
  type PageRedactions,
  type RedactPdfOptions,
  type RedactPdfResult,
  type RedactReport,
} from './types';

/**
 * Permanently redact a PDF.
 *
 * Pipeline:
 *   load ─▶ flatten form fields ─▶ for each page with boxes: strip text,
 *   images and form contents under the boxes, burn opaque boxes, delete
 *   touching annotations ─▶ scrub document-level metadata ─▶ garbage-collect
 *   unreachable objects ─▶ save.
 *
 * Fails CLOSED: anything that cannot be inspected safely raises a
 * `RedactionError` (or is removed and reported) instead of being silently
 * left in the output.
 */
export async function redactPdf(
  source: Uint8Array | ArrayBuffer,
  pageRedactions: PageRedactions,
  options: RedactPdfOptions = {},
): Promise<RedactPdfResult> {
  const progress = (p: number) => options.onProgress?.(Math.min(1, Math.max(0, p)));
  const report = emptyReport();

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    if (
      err instanceof EncryptedPDFError ||
      (err instanceof Error && /encrypt/i.test(err.message))
    ) {
      throw new RedactionError(
        'encrypted',
        'This PDF is password-protected or encrypted. Remove the protection first (for example with "Print to PDF"), then redact the unprotected copy.',
        { cause: err },
      );
    }
    throw new RedactionError('unreadable', 'This file could not be read as a PDF.', { cause: err });
  }
  progress(0.05);

  // Clamp all boxes up front so progress is smooth and work is known.
  const work: { pageIndex: number; rects: PdfRect[] }[] = [];
  const pageCount = doc.getPageCount();
  for (let i = 0; i < Math.min(pageCount, pageRedactions.length); i++) {
    const rects = pageRedactions[i];
    if (!rects || rects.length === 0) continue;
    const clamped = clampRects(rects, pageBounds(doc, i));
    if (clamped.length > 0) work.push({ pageIndex: i, rects: clamped });
  }

  flattenForm(doc, report);
  progress(0.1);

  work.forEach(({ pageIndex, rects }, k) => {
    redactPage(doc, pageIndex, rects, report);
    progress(0.1 + (0.75 * (k + 1)) / work.length);
  });

  sanitizeDocument(doc, report);
  report.orphanObjectsRemoved = collectGarbage(doc);
  progress(0.9);

  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  progress(1);
  return { bytes, report };
}

/**
 * Turn interactive form fields into static page content, so their values
 * become ordinary page text that the interpreter can redact. If pdf-lib
 * cannot flatten (missing appearances, exotic field types), the form is
 * dropped by the sanitiser instead and the user is told.
 */
function flattenForm(doc: PDFDocument, report: RedactReport): void {
  if (!doc.catalog.has(PDFName.of('AcroForm'))) return;
  try {
    const form = doc.getForm();
    if (form.getFields().length === 0) return;
    form.flatten();
    report.formFlattened = true;
  } catch {
    report.warnings.push({
      code: 'form-not-flattened',
      severity: 'warning',
      message:
        'The interactive form could not be flattened. Form fields touching a box were removed and the remaining fields were made non-interactive; check that no field still shows redacted information.',
    });
  }
}
