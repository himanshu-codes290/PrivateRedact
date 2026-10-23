import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { Layers } from 'lucide-react';
import { pdfRectToViewport } from '@/features/redact/lib/coordinates';
import type { PageMap, Redaction } from '@/features/redact/state/redactionsReducer';

/** Thumbnail width in CSS px. Height follows each page's aspect ratio. */
const THUMB_WIDTH = 132;
/** Placeholder aspect ratio (US Letter) until a page's real size is known. */
const DEFAULT_ASPECT = 792 / 612;

interface PageThumbnailsProps {
  doc: PDFDocumentProxy;
  /** 1-based page currently shown in the viewer. */
  currentPage: number;
  /** Redaction boxes of the active file, keyed by 0-based page index. */
  pages: PageMap;
  onSelect: (page: number) => void;
  disabled?: boolean;
}

/**
 * Right-hand page strip: one thumbnail per page of the open PDF.
 *
 * Thumbnails render lazily (only once they scroll into view) and only once,
 * so a 300-page document does not render 300 canvases up front. Each
 * thumbnail also previews where the redaction boxes on that page are.
 */
export function PageThumbnails({
  doc,
  currentPage,
  pages,
  onSelect,
  disabled = false,
}: PageThumbnailsProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const pageCount = doc.numPages;
  const pagesWithBoxes = Object.values(pages).filter((list) => list.length > 0).length;

  // Keep the current page's thumbnail visible as the user navigates.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPage]);

  return (
    <aside
      className="hidden w-48 shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a16] md:flex"
      aria-label="Pages"
    >
      <div className="border-b border-white/[0.06] px-4 py-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <Layers className="h-4 w-4 text-violet-400" aria-hidden="true" />
          Pages
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500/20 px-1.5 text-[10px] font-bold text-violet-300">
            {pageCount}
          </span>
        </h2>
        {pagesWithBoxes > 0 && (
          <p className="mt-1 text-[11px] text-gray-500">
            Boxes on {pagesWithBoxes} page{pagesWithBoxes === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <ol ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <li key={n} data-page={n}>
            <Thumbnail
              doc={doc}
              pageNumber={n}
              active={n === currentPage}
              redactions={pages[n - 1]}
              root={listRef}
              disabled={disabled}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ol>
    </aside>
  );
}

interface ThumbnailProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  redactions: readonly Redaction[] | undefined;
  root: RefObject<HTMLOListElement | null>;
  disabled: boolean;
  onSelect: (page: number) => void;
}

const Thumbnail = memo(function Thumbnail({
  doc,
  pageNumber,
  active,
  redactions,
  root,
  disabled,
  onSelect,
}: ThumbnailProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [failed, setFailed] = useState(false);

  // Become "visible" the first time the thumbnail nears the scroll area.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Environments without the API (old browsers, tests): render eagerly.
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: root.current, rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Render the page once it is visible.
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let page: PDFPageProxy | null = null;

    void (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: THUMB_WIDTH / natural.width });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        task = page.render({
          canvas,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await task.promise;
        if (!cancelled) setViewport(vp);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) {
          return;
        }
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      page?.cleanup();
    };
  }, [visible, doc, pageNumber]);

  // Free the backing store on unmount (2D contexts are not GC friendly).
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, []);

  const count = redactions?.length ?? 0;
  const height = viewport ? Math.floor(viewport.height) : Math.round(THUMB_WIDTH * DEFAULT_ASPECT);

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={() => onSelect(pageNumber)}
      aria-current={active ? 'page' : undefined}
      aria-label={`Page ${pageNumber}${count > 0 ? `, ${count} redaction box${count === 1 ? '' : 'es'}` : ''}`}
      className="group mx-auto flex w-full flex-col items-center gap-1.5 rounded-lg p-1.5 transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed"
    >
      <span
        className={`relative block overflow-hidden rounded-sm bg-white shadow-md transition ${
          active
            ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-[#0a0a16]'
            : 'opacity-80 group-hover:opacity-100'
        }`}
        style={{ width: THUMB_WIDTH, height }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: THUMB_WIDTH, height }}
          aria-hidden="true"
        />
        {!viewport && !failed && (
          <span className="absolute inset-0 animate-pulse bg-gray-200" aria-hidden="true" />
        )}
        {failed && (
          <span className="absolute inset-0 flex items-center justify-center bg-gray-100 text-[10px] text-gray-500">
            Preview unavailable
          </span>
        )}
        {viewport &&
          redactions?.map((r) => {
            const v = pdfRectToViewport(viewport, r.rect);
            return (
              <span
                key={r.id}
                data-redaction-preview=""
                className="absolute bg-violet-600/60 outline outline-1 outline-violet-500"
                style={{ left: v.left, top: v.top, width: v.width, height: v.height }}
                aria-hidden="true"
              />
            );
          })}
        {count > 0 && (
          <span className="absolute right-1 top-1 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow">
            {count}
          </span>
        )}
      </span>
      <span
        className={`text-[11px] tabular-nums ${active ? 'font-semibold text-violet-300' : 'text-gray-500'}`}
      >
        {pageNumber}
      </span>
    </button>
  );
});
