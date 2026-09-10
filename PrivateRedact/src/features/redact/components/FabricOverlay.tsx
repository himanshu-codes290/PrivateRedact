import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { Canvas, Rect } from 'fabric';
import type { RedactionTool } from './RedactWorkspace';
import type { PdfRect } from '@/features/redact/lib/coordinates';
import { pdfRectToViewport, viewportRectToPdf } from '@/features/redact/lib/coordinates';

/** Imperative handle the Toolbar uses for undo / clear. */
export interface RedactOverlayHandle {
  undo: () => void;
  clear: () => void;
}

interface FabricOverlayProps {
  /** Live viewport of the page this overlay sits on (top-left origin, CSS px). */
  viewport: PageViewport;
  tool: RedactionTool;
  /** Redactions persisted in PDF user space — seeded once on mount. */
  existingRedactions: PdfRect[];
  /** Fired whenever the set of redactions changes (draw/finish, move, resize, delete, undo, clear). */
  onRedactionChange: (rects: PdfRect[]) => void;
  /**
   * When true the overlay is inert (no pointer events) so the browser's
   * native text selection can reach the pdf.js TextLayer underneath.
   * Must be enabled together with PdfViewer's textSelectable.
   */
  textSelectable?: boolean;
}

const REDACTION_FILL = 'rgba(139, 92, 246, 0.35)';
const ACCENT = '#8b5cf6';

/** Build a redaction Rect at the given viewport coords. */
function makeRedactionRect(left: number, top: number, width: number, height: number) {
  return new Rect({
    left,
    top,
    width,
    height,
    // Fabric v7 defaults originX/originY to 'center', which would treat the
    // passed left/top as the rect's CENTER — shifting every box up-left by
    // half its size. Pin the corner origin so left/top is the top-left corner.
    originX: 'left',
    originY: 'top',
    fill: REDACTION_FILL,
    strokeWidth: 0,
    borderColor: ACCENT,
    cornerColor: ACCENT,
    cornerStrokeColor: '#a78bfa',
    cornerStyle: 'rect',
    transparentCorners: false,
    lockRotation: true,
  });
}

interface LineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Collapse the many client rects a text Range produces (one per glyph run)
 * into one box per visual line. Coords are shifted into page-local space by
 * subtracting the page origin, so the result is already in viewport CSS px
 * (== Fabric scene coords at zoom 1). Rects on the same line are merged when
 * a rect's vertical center falls inside the current line's band.
 */
function groupSelectionRects(rects: DOMRect[], originX: number, originY: number): LineRect[] {
  const local = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ left: r.left - originX, top: r.top - originY, width: r.width, height: r.height }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: LineRect[] = [];
  for (const r of local) {
    const last = lines[lines.length - 1];
    const center = r.top + r.height / 2;
    if (last && center >= last.top && center <= last.top + last.height) {
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

/**
 * Fabric.js overlay canvas layered on top of the PDF render. Owns the
 * redaction rectangles: drawing (rect tool), selection / move / resize /
 * delete (select tool), undo and clear. Rectangles are reported upward
 * as PDF user-space coords (72 DPI, bottom-left origin) so pdf-lib can
 * burn them back destructively without display math.
 */
export const FabricOverlay = forwardRef<RedactOverlayHandle, FabricOverlayProps>(
  function FabricOverlay(
    { viewport, tool, existingRedactions, onRedactionChange, textSelectable = false },
    ref,
  ) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const drawingRef = useRef<{ x0: number; y0: number; rect: Rect | null } | null>(null);

    // Refs so event handlers never capture stale props.
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const toolRef = useRef(tool);
    toolRef.current = tool;
    const onChangeRef = useRef(onRedactionChange);
    onChangeRef.current = onRedactionChange;
    // Latest persisted redactions — re-read whenever the overlay re-creates
    // (file switch or viewport resize) so nothing is lost on re-mount.
    const seedRef = useRef(existingRedactions);
    seedRef.current = existingRedactions;
    // Re-create the Fabric canvas whenever the displayed page size changes.
    const sizeKey = `${Math.floor(viewport.width)}x${Math.floor(viewport.height)}`;

    const emitChange = () => {
      const fab = fabricRef.current;
      if (!fab) return;
      const rects: PdfRect[] = fab.getObjects().map((obj) => {
        const b = obj.getBoundingRect();
        return viewportRectToPdf(viewportRef.current, b.left, b.top, b.width, b.height);
      });
      onChangeRef.current(rects);
    };

    useImperativeHandle(
      ref,
      () => ({
        undo() {
          const fab = fabricRef.current;
          const objects = fab?.getObjects();
          if (!fab || !objects || objects.length === 0) return;
          fab.remove(objects[objects.length - 1]);
          emitChange();
        },
        clear() {
          const fab = fabricRef.current;
          if (!fab) return;
          fab.getObjects().forEach((obj) => fab.remove(obj));
          fab.discardActiveObject();
          fab.requestRenderAll();
          emitChange();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    useEffect(() => {
      const el = canvasElRef.current;
      if (!el) return;
      el.width = Math.floor(viewportRef.current.width);
      el.height = Math.floor(viewportRef.current.height);

      const fab = new Canvas(el, {
        preserveObjectStacking: true,
        selectionColor: 'rgba(139, 92, 246, 0.12)',
        selectionBorderColor: ACCENT,
        skipTargetFind: toolRef.current === 'rect' || textSelectable,
        selection: toolRef.current === 'select' && !textSelectable,
        hoverCursor: toolRef.current === 'rect' ? 'crosshair' : 'default',
      });
      fabricRef.current = fab;

      // Re-hydrate persisted redactions (PDF space → viewport space).
      for (const rect of seedRef.current) {
        const v = pdfRectToViewport(viewportRef.current, rect);
        fab.add(makeRedactionRect(v.left, v.top, v.width, v.height));
      }
      fab.requestRenderAll();

      fab.on('mouse:down', (opt) => {
        if (toolRef.current !== 'rect') return;
        drawingRef.current = { x0: opt.scenePoint.x, y0: opt.scenePoint.y, rect: null };
      });

      fab.on('mouse:move', (opt) => {
        const d = drawingRef.current;
        if (!d) return;
        const left = Math.min(d.x0, opt.scenePoint.x);
        const top = Math.min(d.y0, opt.scenePoint.y);
        const width = Math.abs(opt.scenePoint.x - d.x0);
        const height = Math.abs(opt.scenePoint.y - d.y0);
        if (!d.rect) {
          if (width < 1 && height < 1) return;
          const rect = makeRedactionRect(left, top, width, height);
          rect.set({ selectable: false, evented: false, hasControls: false });
          fab.add(rect);
          d.rect = rect;
        } else {
          d.rect.set({ left, top, width, height });
        }
        // set() does NOT invalidate Fabric's cached aCoords (frozen by the
        // first render via skipOffscreen/isOnScreen) — without setCoords(),
        // getBoundingRect() at mouse:up would report the rect's geometry
        // from the first drag frame and the burned PDF box would be wrong.
        d.rect.setCoords();
        fab.requestRenderAll();
      });

      fab.on('mouse:up', () => {
        const d = drawingRef.current;
        drawingRef.current = null;
        if (!d?.rect) return;
        if (d.rect.width < 1 || d.rect.height < 1) {
          fab.remove(d.rect);
          fab.requestRenderAll();
          return;
        }
        // Finalize: the rect becomes a real, selectable redaction.
        d.rect.set({ selectable: true, evented: true, hasControls: true });
        d.rect.setCoords();
        emitChange();
      });

      // Persist moves / resizes made with the select tool (Fabric refreshes
      // the coords cache itself after transforms).
      fab.on('object:modified', () => emitChange());

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        const target = fabricRef.current?.getActiveObject();
        if (!target) return;
        fabricRef.current?.remove(target);
        emitChange();
      };
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        fabricRef.current = null;
        // StaticCanvas.dispose tears down event listeners + backing store.
        void fab.dispose();
        // 2D contexts are not GC-friendly — zero the backing store.
        el.width = 0;
        el.height = 0;
      };
      // Re-create the Fabric canvas whenever the displayed page size changes
      // (fit-to-container re-scales the page) so the overlay always matches.
    }, [sizeKey]);

    useEffect(() => {
      const fab = fabricRef.current;
      if (!fab) return;
      const interactive = !textSelectable;
      const isDraw = tool === 'rect';
      fab.set({
        skipTargetFind: isDraw || !interactive,
        selection: !isDraw && interactive,
        hoverCursor: isDraw ? 'crosshair' : 'default',
      });
      fab.discardActiveObject();
      fab.requestRenderAll();
    }, [tool, textSelectable]);

    // Text tool: convert the browser's native text selection into redaction
    // rects on mouse-up. The overlay is inert while textSelectable (pointer
    // events go to the pdf.js TextLayer), so we listen on the document and
    // read window.getSelection() rather than any Fabric event.
    useEffect(() => {
      if (!textSelectable) return;

      const commitSelection = () => {
        const sel = window.getSelection();
        const fab = fabricRef.current;
        const canvasEl = canvasElRef.current;
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !fab || !canvasEl) return;

        const clientRects: DOMRect[] = [];
        for (let i = 0; i < sel.rangeCount; i++) {
          for (const r of Array.from(sel.getRangeAt(i).getClientRects())) clientRects.push(r);
        }
        if (clientRects.length === 0) return;

        const origin = canvasEl.getBoundingClientRect();
        const lines = groupSelectionRects(clientRects, origin.left, origin.top);

        // 1px bleed so the box fully covers ascenders / descenders.
        const PAD = 1;
        let added = false;
        for (const l of lines) {
          if (l.width < 1 || l.height < 1) continue;
          fab.add(makeRedactionRect(l.left - PAD, l.top - PAD, l.width + PAD * 2, l.height + PAD * 2));
          added = true;
        }
        if (!added) return;

        fab.requestRenderAll();
        emitChange();
        sel.removeAllRanges();
      };

      document.addEventListener('mouseup', commitSelection);
      return () => document.removeEventListener('mouseup', commitSelection);
      // emitChange only reads refs, so it is stable across renders.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [textSelectable]);

    return (
      <div
        className="absolute inset-0 touch-none"
        style={{ pointerEvents: textSelectable ? 'none' : 'auto' }}
      >
        <canvas
          ref={canvasElRef}
          className="absolute inset-0 touch-none"
          aria-label="Redaction overlay"
        />
      </div>
    );
  },
);
