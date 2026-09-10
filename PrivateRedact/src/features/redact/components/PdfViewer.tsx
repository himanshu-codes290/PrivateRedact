import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  PageViewport,
  PDFDocumentLoadingTask,
  PDFPageProxy,
  RenderTask,
  TextLayer as TextLayerType,
} from 'pdfjs-dist';
import { pdfjsLib } from '@/features/redact/lib/pdf';
import { BASE_SCALE } from '@/features/redact/lib/coordinates';
import { Loader2, AlertCircle } from 'lucide-react';

export interface PdfViewportInfo {
  viewport: PageViewport;
  pageNumber: number;
  totalPages: number;
}

/**
 * Space reserved inside the scroll container around the page: p-6 gutters
 * (24px × 2) plus the page-indicator line and centering slack.
 */
const HORIZONTAL_PAD = 48 + 16;
const VERTICAL_PAD = 48 + 16 + 26;

interface PdfViewerProps {
  file: File;
  onViewportReady: (info: PdfViewportInfo) => void;
  /**
   * When true the transparent text layer captures pointer events so the
   * browser's native text selection / copy works. The redaction overlay
   * must be non-interactive at the same time (see FabricOverlay).
   */
  textSelectable?: boolean;
  /**
   * Rendered above the TextLayer once the page is ready — hosts the
   * Fabric redaction overlay (which needs the live viewport).
   */
  children?: ReactNode;
}

/**
 * Renders a single PDF page onto a <canvas> via PDF.js and overlays a
 * TextLayer (transparent, text-selectable on demand). The page is scaled
 * to fit the available viewer area (like an A4 sheet on screen) capped by
 * BASE_SCALE. Reports the live PageViewport + page metadata up so Fabric /
 * the redaction engine can convert coordinates.
 */
export function PdfViewer({ file, onViewportReady, textSelectable = false, children }: PdfViewerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by a ResizeObserver when the scroll container changes size.
  const [resizeTick, setResizeTick] = useState(0);
  const onReadyRef = useRef(onViewportReady);
  onReadyRef.current = onViewportReady;

  // Watch the scroll container (PdfViewer's parent) so the page can be
  // re-fitted on window/panel resize. Debounced so dragging doesn't
  // re-render the PDF on every pixel.
  useEffect(() => {
    const el = wrapperRef.current?.parentElement;
    if (!el) return;
    let timer: number | undefined;
    // Only re-fit when the available area changes meaningfully. Rendering the
    // page can toggle the scroll container's scrollbar, nudging its client
    // size by a scrollbar's width; reacting to that would feed straight back
    // into another render — an endless loop. A threshold wider than any
    // scrollbar absorbs that jitter (and the mandatory initial callback,
    // whose delta is zero) while still catching real window/panel resizes.
    const REFIT_THRESHOLD = 24;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const schedule = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (Math.abs(w - last.w) < REFIT_THRESHOLD && Math.abs(h - last.h) < REFIT_THRESHOLD) {
        return;
      }
      last = { w, h };
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setResizeTick((n) => n + 1), 150);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayerType | null = null;
    let page: PDFPageProxy | null = null;
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;

    setViewport(null);
    setError(null);

    (async () => {
      try {
        const data = await file.arrayBuffer();
        if (cancelled) return;

        loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        page = await pdf.getPage(1);
        if (cancelled) return;

        // Natural page size (PDF points) at display scale 1.
        const baseViewport = page.getViewport({ scale: 1 });
        const rawWidth = baseViewport.width;
        const rawHeight = baseViewport.height;

        // Fit the page into the available area like a sheet on screen,
        // capped by the authored max display scale for crispness.
        const parent = wrapperRef.current?.parentElement as HTMLElement | null;
        let scale = BASE_SCALE;
        if (parent) {
          const availWidth = parent.clientWidth - HORIZONTAL_PAD;
          const availHeight = parent.clientHeight - VERTICAL_PAD;
          const fit = Math.min(availWidth / rawWidth, availHeight / rawHeight, BASE_SCALE);
          scale = Math.max(0.25, fit);
        }

        const pageViewport = page.getViewport({ scale });
        if (cancelled) return;

        if (canvas) {
          // Render at devicePixelRatio so glyph placement on HiDPI screens
          // matches the CSS-pixel-accurate TextLayer / Fabric overlay above.
          // The backing store scales by DPR; the CSS size stays in CSS px.
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(pageViewport.width * dpr);
          canvas.height = Math.floor(pageViewport.height * dpr);
          canvas.style.width = `${Math.floor(pageViewport.width)}px`;
          canvas.style.height = `${Math.floor(pageViewport.height)}px`;
          renderTask = page.render({
            canvas,
            viewport: pageViewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          await renderTask.promise;
        }
        if (cancelled) return;

        if (textContainer) {
          // pdf.js *appends* spans into the container, so drop any left by a
          // previous render pass first — otherwise duplicate, misaligned text
          // stacks up and corrupts native selection.
          textContainer.replaceChildren();
          // pdf.js positions/sizes spans with these CSS variables.
          textContainer.style.setProperty('--total-scale-factor', String(pageViewport.scale));
          textLayer = new pdfjsLib.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textContainer,
            viewport: pageViewport,
          });
          await textLayer.render();
        }
        if (cancelled) return;

        setViewport(pageViewport);
        onReadyRef.current({ viewport: pageViewport, pageNumber: 1, totalPages: pdf.numPages });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      // Free PDF.js page-internal state (glyphs, fonts, cached render data).
      page?.cleanup();
      loadingTask?.destroy();
      // 2D contexts are not GC-friendly — zero the canvas backing store.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      // Drop text spans so a cancelled pass leaves nothing behind for the
      // next render to stack onto.
      if (textContainer) {
        textContainer.replaceChildren();
      }
    };
  }, [file, resizeTick]);

  const width = viewport ? Math.floor(viewport.width) : 600;
  const height = viewport ? Math.floor(viewport.height) : 800;

  return (
    <div
      ref={wrapperRef}
      className="relative shadow-2xl rounded-sm overflow-hidden bg-white"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className="text-layer absolute inset-0"
        style={{
          pointerEvents: textSelectable ? 'auto' : 'none',
          zIndex: textSelectable ? 10 : undefined,
        }}
      />
      {viewport && children}

      {!viewport && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
          <p className="text-sm">Rendering document…</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white text-red-500">
          <AlertCircle className="w-8 h-8" />
          <p className="text-sm px-4 text-center">{error}</p>
        </div>
      )}
    </div>
  );
}
