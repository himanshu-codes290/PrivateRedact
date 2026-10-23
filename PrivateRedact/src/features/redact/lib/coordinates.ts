import type { PageViewport } from 'pdfjs-dist';
import type { PdfRect } from '@/features/redact/engine';

export type { PdfRect };

/** Largest display scale (CSS px per PDF point) used by "fit" modes. */
export const MAX_FIT_SCALE = 1.5;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export type ZoomMode = 'fit-page' | 'fit-width' | number;

/** Minimal slice of PDF.js' PageViewport used for conversions (easy to fake in tests). */
export type ViewportLike = Pick<PageViewport, 'convertToPdfPoint' | 'convertToViewportPoint'>;

/**
 * Viewport rect (CSS px, top-left origin: the space Fabric and the canvas
 * use) → PDF user space (points, bottom-left origin). Both corners go
 * through the viewport transform, so /Rotate and CropBox offsets are handled.
 */
export function viewportRectToPdf(
  viewport: ViewportLike,
  left: number,
  top: number,
  width: number,
  height: number,
): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(left, top) as [number, number];
  const [x2, y2] = viewport.convertToPdfPoint(left + width, top + height) as [number, number];
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** PDF user-space rect → viewport rect. Rotation-safe (min/abs on both axes). */
export function pdfRectToViewport(
  viewport: ViewportLike,
  rect: PdfRect,
): { left: number; top: number; width: number; height: number } {
  const [ax, ay] = viewport.convertToViewportPoint(rect.x, rect.y) as [number, number];
  const [bx, by] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height) as [
    number,
    number,
  ];
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}

/** Resolve a zoom mode to a concrete scale for a page of the given size. */
export function resolveScale(
  zoom: ZoomMode,
  page: { width: number; height: number },
  available: { width: number; height: number },
): number {
  if (typeof zoom === 'number') return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const byWidth = available.width / page.width;
  const fit = zoom === 'fit-width' ? byWidth : Math.min(byWidth, available.height / page.height);
  return Math.max(MIN_ZOOM, Math.min(MAX_FIT_SCALE, fit));
}

/** Next zoom step up or down from the current scale. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > current + 0.01) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 0.01) ?? MIN_ZOOM;
}
