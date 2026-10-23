/**
 * Geometry primitives shared by the engine and the UI.
 *
 * Matrices use the PDF convention: `[a b c d e f]` is the row-vector affine
 * transform
 *
 *     | a b 0 |
 *     | c d 0 |      point' = [x y 1] × M
 *     | e f 1 |
 *
 * so `multiply(A, B)` means "apply A, then B" — exactly how the PDF spec
 * writes `Trm = [Tfs·Th 0 0 Tfs 0 Trise] × Tm × CTM`.
 */

/** A rectangle in PDF user space (points, 72/inch, bottom-left origin). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned box as min/max corners. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `A × B` (apply A first, then B). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

/** Axis-aligned bounding box of the rectangle (x0,y0)-(x1,y1) after `m`. */
export function transformBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const p = [
    transformPoint(m, x0, y0),
    transformPoint(m, x1, y0),
    transformPoint(m, x0, y1),
    transformPoint(m, x1, y1),
  ];
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const [x, y] of p) {
    if (x < bx0) bx0 = x;
    if (y < by0) by0 = y;
    if (x > bx1) bx1 = x;
    if (y > by1) by1 = y;
  }
  return { x0: bx0, y0: by0, x1: bx1, y1: by1 };
}

export function rectToBox(r: PdfRect): Box {
  return { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height };
}

export function boxToRect(b: Box): PdfRect {
  return { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

/** Normalise a rect whose width/height may be negative. */
export function normalizeRect(r: PdfRect): PdfRect {
  return {
    x: Math.min(r.x, r.x + r.width),
    y: Math.min(r.y, r.y + r.height),
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

export function boxArea(b: Box): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

export function intersectBoxes(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/**
 * Fraction (0..1) of `target`'s area covered by the UNION of `boxes`.
 * Uses coordinate compression so overlapping redaction boxes are never
 * double-counted. O(n³) in the number of boxes, which is tiny in practice.
 */
export function coveredFraction(target: Box, boxes: readonly Box[]): number {
  const area = boxArea(target);
  if (area <= 0) return 0;
  const clipped = boxes.map((b) => intersectBoxes(target, b)).filter((b): b is Box => b !== null);
  if (clipped.length === 0) return 0;

  const xs = [...new Set(clipped.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(clipped.flatMap((b) => [b.y0, b.y1]))].sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx0 = xs[i]!;
    const cx1 = xs[i + 1]!;
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy0 = ys[j]!;
      const cy1 = ys[j + 1]!;
      const mx = (cx0 + cx1) / 2;
      const my = (cy0 + cy1) / 2;
      if (clipped.some((b) => mx > b.x0 && mx < b.x1 && my > b.y0 && my < b.y1)) {
        covered += (cx1 - cx0) * (cy1 - cy0);
      }
    }
  }
  return Math.min(1, covered / area);
}
