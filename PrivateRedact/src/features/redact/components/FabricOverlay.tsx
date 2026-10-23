import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { ActiveSelection, Canvas, Rect, type FabricObject } from 'fabric';
import {
  pdfRectToViewport,
  viewportRectToPdf,
  type ViewportLike,
} from '@/features/redact/lib/coordinates';
import { newRedactionId, type Redaction } from '@/features/redact/state/redactionsReducer';
import { groupSelectionRects } from '@/features/redact/lib/selection';
import { useLatest } from '@/hooks/useLatest';
import type { RedactionTool } from './Toolbar';

export interface RedactOverlayHandle {
  deleteSelection: () => void;
  deselect: () => void;
}

interface FabricOverlayProps {
  /** Live viewport of the page under the overlay (CSS px, top-left origin). */
  viewport: PageViewport;
  tool: RedactionTool;
  /** Boxes for this page, in PDF user space. The overlay mirrors them. */
  redactions: readonly Redaction[];
  /** Freeze all interaction (e.g. while a modal dialog is open). */
  disabled: boolean;
  /** The PDF.js text layer, used to scope text-tool selections. */
  textLayerRef: RefObject<HTMLDivElement | null>;
  onAdd: (redactions: Redaction[]) => void;
  onUpdate: (redactions: Redaction[]) => void;
  onRemove: (ids: string[]) => void;
}

const FILL = 'rgba(139, 92, 246, 0.35)';
const ACCENT = '#8b5cf6';
/** Pixel tolerance before a stored box is considered moved. */
const SYNC_EPSILON = 0.5;

function makeRect(left: number, top: number, width: number, height: number): Rect {
  return new Rect({
    left,
    top,
    width,
    height,
    // Fabric v7 defaults the origin to the centre; pin it to the corner so
    // left/top are the top-left corner like everywhere else in the app.
    originX: 'left',
    originY: 'top',
    fill: FILL,
    strokeWidth: 0,
    borderColor: ACCENT,
    cornerColor: ACCENT,
    cornerStrokeColor: '#a78bfa',
    cornerStyle: 'rect',
    transparentCorners: false,
    lockRotation: true,
  });
}

/** Two-way mapping between store ids and Fabric objects. */
interface Registry {
  byId: Map<string, FabricObject>;
  ids: WeakMap<FabricObject, string>;
}

/** Bring Fabric objects in line with the store (add / move / remove). */
function reconcile(
  fab: Canvas,
  registry: Registry,
  list: readonly Redaction[],
  viewport: ViewportLike,
): void {
  const wanted = new Set(list.map((r) => r.id));
  let changed = false;
  const markChanged = () => {
    if (!changed) fab.discardActiveObject();
    changed = true;
  };

  for (const [id, obj] of registry.byId) {
    if (wanted.has(id)) continue;
    markChanged();
    fab.remove(obj);
    registry.byId.delete(id);
  }
  for (const r of list) {
    const v = pdfRectToViewport(viewport, r.rect);
    const obj = registry.byId.get(r.id);
    if (!obj) {
      const rect = makeRect(v.left, v.top, v.width, v.height);
      registry.byId.set(r.id, rect);
      registry.ids.set(rect, r.id);
      fab.add(rect);
      changed = true;
      continue;
    }
    obj.setCoords();
    const b = obj.getBoundingRect();
    if (
      Math.abs(b.left - v.left) > SYNC_EPSILON ||
      Math.abs(b.top - v.top) > SYNC_EPSILON ||
      Math.abs(b.width - v.width) > SYNC_EPSILON ||
      Math.abs(b.height - v.height) > SYNC_EPSILON
    ) {
      markChanged();
      obj.set({ left: v.left, top: v.top, width: v.width, height: v.height, scaleX: 1, scaleY: 1 });
      obj.setCoords();
    }
  }
  if (changed) fab.requestRenderAll();
}

function applyModes(fab: Canvas, tool: RedactionTool, disabled: boolean): void {
  const drawing = tool === 'rect';
  const inert = disabled || tool === 'text';
  fab.skipTargetFind = drawing || inert;
  fab.selection = !drawing && !inert;
  fab.defaultCursor = drawing && !disabled ? 'crosshair' : 'default';
  fab.hoverCursor = drawing ? 'crosshair' : 'move';
  if (drawing || inert) fab.discardActiveObject();
  fab.requestRenderAll();
}

/**
 * Fabric.js canvas layered over the PDF page.
 *
 * It is a pure VIEW of the redaction store: `reconcile()` adds, moves and
 * removes Fabric objects to match `redactions`, and user gestures become
 * store actions (add / update / remove). Undo, redo, zoom and page changes
 * therefore need no special handling here.
 */
export const FabricOverlay = forwardRef<RedactOverlayHandle, FabricOverlayProps>(
  function FabricOverlay(
    { viewport, tool, redactions, disabled, textLayerRef, onAdd, onUpdate, onRemove },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<Canvas | null>(null);
    const registryRef = useRef<Registry>({ byId: new Map(), ids: new WeakMap() });
    const latest = useLatest({ viewport, tool, redactions, disabled, onAdd, onUpdate, onRemove });
    const sizeKey = `${Math.floor(viewport.width)}x${Math.floor(viewport.height)}|${viewport.rotation}`;

    useImperativeHandle(ref, () => ({
      deleteSelection() {
        const fab = fabricRef.current;
        if (!fab || latest.current.disabled) return;
        const ids = fab
          .getActiveObjects()
          .map((o) => registryRef.current.ids.get(o))
          .filter((id): id is string => Boolean(id));
        fab.discardActiveObject();
        if (ids.length > 0) latest.current.onRemove(ids);
      },
      deselect() {
        fabricRef.current?.discardActiveObject();
        fabricRef.current?.requestRenderAll();
      },
    }));

    // Create the Fabric canvas whenever the displayed page size changes. The
    // <canvas> is created imperatively inside a host div React never
    // reconciles, because Fabric re-parents it into its own wrapper.
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const registry = registryRef.current;
      const vp0 = latest.current.viewport;
      const el = document.createElement('canvas');
      el.setAttribute('aria-label', 'Redaction boxes');
      host.appendChild(el);
      const fab = new Canvas(el, {
        width: Math.floor(vp0.width),
        height: Math.floor(vp0.height),
        preserveObjectStacking: true,
        selectionColor: 'rgba(139, 92, 246, 0.12)',
        selectionBorderColor: ACCENT,
        uniformScaling: false,
      });
      fabricRef.current = fab;
      registry.byId.clear();
      applyModes(fab, latest.current.tool, latest.current.disabled);
      reconcile(fab, registry, latest.current.redactions, latest.current.viewport);

      let drawing: { x0: number; y0: number; rect: Rect | null } | null = null;

      fab.on('mouse:down', (opt) => {
        if (latest.current.tool !== 'rect' || latest.current.disabled) return;
        drawing = { x0: opt.scenePoint.x, y0: opt.scenePoint.y, rect: null };
      });

      fab.on('mouse:move', (opt) => {
        if (!drawing) return;
        const left = Math.min(drawing.x0, opt.scenePoint.x);
        const top = Math.min(drawing.y0, opt.scenePoint.y);
        const width = Math.abs(opt.scenePoint.x - drawing.x0);
        const height = Math.abs(opt.scenePoint.y - drawing.y0);
        if (!drawing.rect) {
          if (width < 1 && height < 1) return;
          drawing.rect = makeRect(left, top, width, height);
          drawing.rect.set({ selectable: false, evented: false });
          fab.add(drawing.rect);
        } else {
          drawing.rect.set({ left, top, width, height });
        }
        // set() does not refresh Fabric's cached corner coords; without this
        // getBoundingRect() would report the first drag frame's geometry.
        drawing.rect.setCoords();
        fab.requestRenderAll();
      });

      fab.on('mouse:up', () => {
        const rect = drawing?.rect;
        drawing = null;
        if (!rect) return;
        if (rect.width < 2 || rect.height < 2) {
          fab.remove(rect);
          fab.requestRenderAll();
          return;
        }
        rect.set({ selectable: true, evented: true });
        rect.setCoords();
        const b = rect.getBoundingRect();
        const id = newRedactionId();
        registry.byId.set(id, rect);
        registry.ids.set(rect, id);
        latest.current.onAdd([
          {
            id,
            rect: viewportRectToPdf(latest.current.viewport, b.left, b.top, b.width, b.height),
          },
        ]);
      });

      fab.on('object:modified', (opt) => {
        const target = opt.target;
        const objects =
          target instanceof ActiveSelection ? target.getObjects() : target ? [target] : [];
        const updates: Redaction[] = [];
        for (const obj of objects) {
          const id = registry.ids.get(obj);
          if (!id) continue;
          obj.setCoords();
          const b = obj.getBoundingRect(); // absolute: includes the selection's transform
          updates.push({
            id,
            rect: viewportRectToPdf(latest.current.viewport, b.left, b.top, b.width, b.height),
          });
        }
        if (updates.length > 0) latest.current.onUpdate(updates);
      });

      return () => {
        fabricRef.current = null;
        registry.byId.clear();
        // dispose() is async and may settle AFTER the next canvas has been
        // mounted into the same host, so only remove this canvas's own nodes
        // (never clear the host). Hide it right away so the two never overlap.
        const wrapper = el.parentElement !== host ? el.parentElement : null;
        if (wrapper) wrapper.style.display = 'none';
        void fab.dispose().finally(() => {
          wrapper?.remove();
          el.remove();
        });
      };
    }, [sizeKey, latest]);

    useEffect(() => {
      const fab = fabricRef.current;
      if (fab) reconcile(fab, registryRef.current, redactions, viewport);
    }, [redactions, viewport]);

    useEffect(() => {
      const fab = fabricRef.current;
      if (fab) applyModes(fab, tool, disabled);
    }, [tool, disabled]);

    // Text tool: turn the browser's native selection INSIDE the text layer
    // into one box per line on mouse-up.
    useEffect(() => {
      if (tool !== 'text' || disabled) return;
      const commit = () => {
        const sel = window.getSelection();
        const layer = textLayerRef.current;
        const host = hostRef.current;
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !layer || !host) return;
        const clientRects: DOMRect[] = [];
        for (let i = 0; i < sel.rangeCount; i++) {
          const range = sel.getRangeAt(i);
          if (!layer.contains(range.commonAncestorContainer)) continue;
          clientRects.push(...Array.from(range.getClientRects()));
        }
        if (clientRects.length === 0) return;
        const origin = host.getBoundingClientRect();
        const vp = latest.current.viewport;
        const pad = 1; // bleed so ascenders/descenders are fully covered
        const added: Redaction[] = groupSelectionRects(clientRects, origin.left, origin.top)
          .filter((l) => l.width >= 1 && l.height >= 1)
          .map((l) => ({
            id: newRedactionId(),
            rect: viewportRectToPdf(
              vp,
              l.left - pad,
              l.top - pad,
              l.width + pad * 2,
              l.height + pad * 2,
            ),
          }));
        sel.removeAllRanges();
        if (added.length > 0) latest.current.onAdd(added);
      };
      document.addEventListener('mouseup', commit);
      return () => document.removeEventListener('mouseup', commit);
    }, [tool, disabled, textLayerRef, latest]);

    return (
      <div
        ref={hostRef}
        className="absolute inset-0 z-[5] touch-none"
        style={{ pointerEvents: tool === 'text' || disabled ? 'none' : 'auto' }}
        data-testid="redaction-overlay"
      />
    );
  },
);
