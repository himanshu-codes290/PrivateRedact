/** Text-selection helpers for the text tool. */

export interface LineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Collapse the many client rects of a text selection (one per glyph run)
 * into one box per visual line, in page-local CSS px.
 */
export function groupSelectionRects(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  originX: number,
  originY: number,
): LineRect[] {
  const local = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({
      left: r.left - originX,
      top: r.top - originY,
      width: r.width,
      height: r.height,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: LineRect[] = [];
  for (const r of local) {
    const last = lines.at(-1);
    const centre = r.top + r.height / 2;
    if (last && centre >= last.top && centre <= last.top + last.height) {
      const right = Math.max(last.left + last.width, r.left + r.width);
      const bottom = Math.max(last.top + last.height, r.top + r.height);
      last.left = Math.min(last.left, r.left);
      last.top = Math.min(last.top, r.top);
      last.width = right - last.left;
      last.height = bottom - last.top;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}
