import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type {
  PageViewport,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextLayer,
} from 'pdfjs-dist';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getPdfjs } from '@/features/redact/lib/pdf';
import { resolveScale, type ZoomMode } from '@/features/redact/lib/coordinates';
import { useLatest } from '@/hooks/useLatest';

export interface RenderedPage {
  viewport: PageViewport;
  scale: number;
}

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  zoom: ZoomMode;
  /** Space available for the page (used by the fit modes). */
  available: { width: number; height: number };
  /** Let the text layer receive the pointer so native selection works. */
  textSelectable: boolean;
  textLayerRef: RefObject<HTMLDivElement | null>;
  onRendered?: (page: RenderedPage) => void;
  /** Rendered above the page once it is ready (the redaction overlay). */
  children?: (page: RenderedPage) => ReactNode;
}

interface RenderState {
  key: string;
  page?: RenderedPage;
  error?: string;
}

/**
 * Renders ONE page of an already-parsed document onto a canvas (at device
 * pixel ratio for crisp text) plus a transparent PDF.js text layer.
 * Re-rendering on zoom / page change reuses the cached document proxy.
 */
export function PdfViewer({
  doc,
  pageNumber,
  zoom,
  available,
  textSelectable,
  textLayerRef,
  onRendered,
  children,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<RenderState | null>(null);
  const onRenderedRef = useLatest(onRendered);

  // Fit modes depend on the available area; fixed zoom levels do not.
  const fitW = typeof zoom === 'number' ? 0 : Math.round(available.width);
  const fitH = zoom === 'fit-page' ? Math.round(available.height) : 0;
  const renderKey = `${pageNumber}|${String(zoom)}|${fitW}|${fitH}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    if (!canvas || !textContainer) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let page: PDFPageProxy | null = null;

    void (async () => {
      try {
        const pdfjs = await getPdfjs();
        page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const scale = resolveScale(zoom, natural, {
          width: fitW || natural.width,
          height: fitH || Infinity,
        });
        const viewport = page.getViewport({ scale });

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (cancelled) return;

        textContainer.replaceChildren();
        textContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        const rendered = { viewport, scale };
        setState({ key: renderKey, page: rendered });
        onRenderedRef.current?.(rendered);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException'))
          return;
        setState({
          key: renderKey,
          error: err instanceof Error ? err.message : 'Failed to render page.',
        });
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      page?.cleanup();
    };
  }, [doc, pageNumber, zoom, fitW, fitH, renderKey, textLayerRef, onRenderedRef]);

  // Zero the canvas backing store on unmount: 2D contexts are not GC friendly.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  const page = state?.page;
  const stale = state?.key !== renderKey;
  const error = !stale ? state?.error : undefined;
  const width = page ? Math.floor(page.viewport.width) : 600;
  const height = page ? Math.floor(page.viewport.height) : 800;

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-2xl"
      style={{ width, height }}
      data-testid="pdf-page"
    >
      <canvas ref={canvasRef} className="block" aria-hidden="true" />
      <div
        ref={textLayerRef}
        className="text-layer absolute inset-0"
        style={{
          pointerEvents: textSelectable ? 'auto' : 'none',
          zIndex: textSelectable ? 10 : undefined,
        }}
      />
      {page && !error && children?.(page)}

      {(!page || stale) && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/60 text-gray-600">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" aria-hidden="true" />
          <p className="text-sm" role="status">
            Rendering page {pageNumber}…
          </p>
        </div>
      )}
      {error && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white text-red-600"
          role="alert"
        >
          <AlertCircle className="h-8 w-8" aria-hidden="true" />
          <p className="px-4 text-center text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
