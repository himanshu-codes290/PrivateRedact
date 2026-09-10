import type { PageViewport } from 'pdfjs-dist';

/**
 * Display scale applied when rendering PDF pages onto the preview canvas.
 * PDFs are authored at 72 DPI; 1.5× yields ~108 px/in for a crisp preview.
 */
export const BASE_SCALE = 1.5;

/**
 * A rectangle expressed in PDF user space (points, 72 DPI) with a
 * bottom-left origin — the native coordinate space of the document.
 * This is the canonical representation persisted per redaction so the
 * destructive engine (pdf-lib) can burn rectangles back without any
 * display-dependent math.
 */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a rect given in viewport coordinates (CSS pixels, top-left
 * origin — the space Fabric.js and the canvas render in) into PDF user
 * space. Uses the PDF.js viewport transform so rotation is handled.
 */
export function viewportRectToPdf(
  viewport: PageViewport,
  left: number,
  top: number,
  width: number,
  height: number,
): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(left, top);
  const [x2, y2] = viewport.convertToPdfPoint(left + width, top + height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * Convert a PDF-space rect back into viewport coordinates (CSS pixels,
 * top-left origin) so stored redactions can be re-drawn on the overlay.
 */
export function pdfRectToViewport(
  viewport: PageViewport,
  rect: PdfRect,
): { left: number; top: number; width: number; height: number } {
  // PDF y grows upward: the rect's top edge sits at y + height.
  const [tlX, tlY] = viewport.convertToViewportPoint(rect.x, rect.y + rect.height);
  const [brX, brY] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y);
  return {
    left: tlX,
    top: tlY,
    width: brX - tlX,
    height: brY - tlY,
  };
}
