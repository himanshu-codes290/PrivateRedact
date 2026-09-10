import { PDFDocument } from 'pdf-lib';
import type { PdfRect } from './coordinates';
import { computeClampedByPage } from './redactionEngine';
import { pdfjsLib } from './pdf';

/**
 * DEV-only validation net for the redaction pipeline.
 *
 * The flatten job runs inside a Web Worker with a pure pdf-lib bundle;
 * pdf.js (and its own worker wiring in `./pdf`) deliberately stays on the
 * main thread. After the worker hands back the redacted bytes, this helper
 * re-parses them with PDF.js and warns about any text item whose
 * bounding-box center still lands inside a redaction rect. It is a soft
 * check: never blocks the flow, and is compiled out of production builds.
 */
export async function crossCheckRedactedPdf(
  bytes: Uint8Array,
  pageRedactions: (PdfRect[] | undefined)[],
): Promise<void> {
  if (!import.meta.env.DEV) return;

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return; // a broken output would already have failed the flatten job
  }
  const { clampedByPage } = computeClampedByPage(doc, pageRedactions);
  await crossCheckTextRemoved(bytes, clampedByPage);
}

async function crossCheckTextRemoved(
  bytes: Uint8Array,
  clampedByPage: (PdfRect[] | null)[],
): Promise<void> {
  let loadingTask;
  try {
    // pdf.js transfers (detaches) the ArrayBuffer it's handed as `data`. The
    // caller still needs these bytes afterwards to build the download Blob,
    // so give pdf.js a throwaway copy — this soft check must never disturb
    // the real redacted output.
    loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
    const pdf = await loadingTask.promise;
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const rects = clampedByPage[pageIndex];
      if (!rects || rects.length === 0) continue;
      const page = await pdf.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      const hit = countTextInRects(textContent.items, rects);
      if (hit > 0) {
        console.warn(
          `[redaction] DEV cross-check: page ${pageIndex + 1} still has ${hit} text item(s) inside a redaction rect. ` +
            `Likely inside a Form XObject / Type3 glyph / image — verify visually; the burn rect still covers it.`,
        );
      }
      page.cleanup();
    }
    loadingTask.destroy();
  } catch (err) {
    console.warn('[redaction] DEV cross-check failed to parse output.', err);
    loadingTask?.destroy();
  }
}

type Matrix = [number, number, number, number, number, number];

function countTextInRects(items: unknown[], rects: PdfRect[]): number {
  let hits = 0;
  for (const raw of items) {
    const item = raw as { transform?: number[]; width?: number; height?: number } | null | undefined;
    if (!item || !item.transform || item.transform.length < 6) continue;
    const m = item.transform as unknown as Matrix;
    const w = Math.abs(item.width ?? 0);
    const h = Math.abs(item.height ?? 0);
    const corners = [
      [m[4], m[5]],
      [m[0] * w + m[4], m[1] * w + m[5]],
      [m[2] * h + m[4], m[3] * h + m[5]],
      [m[0] * w + m[2] * h + m[4], m[1] * w + m[3] * h + m[5]],
    ];
    const cx = (Math.min(...corners.map((c) => c[0])) + Math.max(...corners.map((c) => c[0]))) / 2;
    const cy = (Math.min(...corners.map((c) => c[1])) + Math.max(...corners.map((c) => c[1]))) / 2;
    for (const r of rects) {
      if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
        hits++;
        break;
      }
    }
  }
  return hits;
}
