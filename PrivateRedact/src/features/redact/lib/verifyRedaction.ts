import type { PageRedactions, PdfRect } from '@/features/redact/engine';
import { openPdf } from './pdf';

/**
 * Independent post-redaction check.
 *
 * The engine (pdf-lib, in a worker) wrote the file; this re-opens it with a
 * DIFFERENT parser (PDF.js, the one the viewer uses) and extracts the text
 * that is still positioned under each redaction box. Two independent
 * implementations agreeing is far stronger evidence than the engine
 * grading its own homework.
 *
 * Text items are split into per-character cells (item width / length) and a
 * character counts as "under a box" when its centre is inside one. This
 * mirrors what a person copy-pasting from the box would get.
 */
export interface VerificationResult {
  /** Non-whitespace characters still extractable from inside the boxes. */
  charactersUnderBoxes: number;
  /** 1-based pages where such characters were found. */
  pages: number[];
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export function charactersInsideRects(
  items: readonly TextItemLike[],
  rects: readonly PdfRect[],
): number {
  let hits = 0;
  for (const item of items) {
    const chars = [...item.str];
    if (chars.length === 0 || item.transform.length < 6) continue;
    const [a, b, c, d, e, f] = item.transform as [number, number, number, number, number, number];
    // Unit vectors along the baseline and the ascent direction.
    const scaleX = Math.hypot(a, b) || 1;
    const scaleY = Math.hypot(c, d) || 1;
    const ux = [a / scaleX, b / scaleX];
    const uy = [c / scaleY, d / scaleY];
    const step = item.width / chars.length;
    const half = (item.height || scaleY) / 2;
    chars.forEach((ch, i) => {
      if (!ch.trim()) return;
      const along = step * (i + 0.5);
      const cx = e + ux[0]! * along + uy[0]! * half;
      const cy = f + ux[1]! * along + uy[1]! * half;
      if (
        rects.some((r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height)
      ) {
        hits++;
      }
    });
  }
  return hits;
}

export async function verifyRedaction(
  bytes: Uint8Array,
  pageRedactions: PageRedactions,
): Promise<VerificationResult> {
  // PDF.js takes ownership of the buffer it is given: pass a copy so the
  // caller's bytes stay intact for the download.
  const task = await openPdf(bytes.slice());
  const result: VerificationResult = { charactersUnderBoxes: 0, pages: [] };
  try {
    const pdf = await task.promise;
    for (let i = 0; i < Math.min(pdf.numPages, pageRedactions.length); i++) {
      const rects = pageRedactions[i];
      if (!rects || rects.length === 0) continue;
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const items = content.items.filter((it): it is TextItemLike & typeof it => 'str' in it);
      const hits = charactersInsideRects(items, rects);
      if (hits > 0) {
        result.charactersUnderBoxes += hits;
        result.pages.push(i + 1);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return result;
}
