import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import {
  countForFile,
  initialRedactionsState,
  pageRedactionsOf,
  pagesWithRedactions,
  redactionsReducer,
  toPageRedactions,
  type PageMap,
  type Redaction,
} from '@/features/redact/state/redactionsReducer';
import { usePdfDocument } from '@/features/redact/hooks/usePdfDocument';
import { useWorkspaceShortcuts } from '@/features/redact/hooks/useWorkspaceShortcuts';
import { intakeFiles, type QueuedFile } from '@/features/redact/lib/fileIntake';
import { bytesToObjectUrl } from '@/features/redact/lib/download';
import { releasePdfjs } from '@/features/redact/lib/pdf';
import { stepZoom, type ZoomMode } from '@/features/redact/lib/coordinates';
import { verifyRedaction } from '@/features/redact/lib/verifyRedaction';
import type { DownloadItem } from '@/features/redact/lib/results';
import { PdfProcessorClient, RedactJobError } from '@/features/redact/workers/pdfWorker';
import { DocQueuePanel, type FileProgress } from './DocQueuePanel';
import { Toolbar, type RedactionTool } from './Toolbar';
import { PdfViewer, type RenderedPage } from './PdfViewer';
import { FabricOverlay, type RedactOverlayHandle } from './FabricOverlay';
import { ConfirmRedactionDialog } from './ConfirmRedactionDialog';
import { DownloadPage } from './DownloadPage';
import { SupportDialog } from './SupportDialog';
import { isSupportCardHidden } from '@/features/redact/lib/supportCard';
import { PageThumbnails } from './PageThumbnails';

/** Stable empty map so thumbnails of a file without boxes do not re-render. */
const NO_PAGES: PageMap = {};

interface RedactWorkspaceProps {
  files: readonly QueuedFile[];
  onFilesChange: (files: QueuedFile[]) => void;
  onStartOver: () => void;
}

type Phase = 'edit' | 'confirm' | 'download';

interface ConfirmState {
  queue: string[];
  index: number;
  processing: boolean;
  progress: number;
  stage: string;
  error: string | null;
}

const IDLE_CONFIRM: ConfirmState = {
  queue: [],
  index: 0,
  processing: false,
  progress: 0,
  stage: '',
  error: null,
};

/** Space reserved around the page inside the scroll area (p-6 on both sides). */
const PAGE_GUTTER = 48;
/** Ignore container size jitter smaller than a scrollbar. */
const RESIZE_THRESHOLD = 24;

function errorMessage(err: unknown): string {
  if (err instanceof RedactJobError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error while redacting.';
}

/**
 * The redaction workspace: document queue, page viewer with the drawing
 * overlay, and the confirm → redact → verify → download pipeline.
 */
export function RedactWorkspace({ files, onFilesChange, onStartOver }: RedactWorkspaceProps) {
  const [activeId, setActiveId] = useState(files[0]?.id ?? '');
  const [tool, setTool] = useState<RedactionTool>('rect');
  const [zoom, setZoom] = useState<ZoomMode>('fit-page');
  const [pageByFile, setPageByFile] = useState<Record<string, number>>({});
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const [available, setAvailable] = useState({ width: 800, height: 1000 });
  const [notices, setNotices] = useState<string[]>([]);
  const [store, dispatch] = useReducer(redactionsReducer, initialRedactionsState);

  const [phase, setPhase] = useState<Phase>('edit');
  const [confirm, setConfirm] = useState<ConfirmState>(IDLE_CONFIRM);
  const [results, setResults] = useState<DownloadItem[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  /** Thank-you card shown over the results once a redaction run finishes. */
  const [supportCard, setSupportCard] = useState(false);

  const overlayRef = useRef<RedactOverlayHandle>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<PdfProcessorClient | null>(null);
  /** Every Blob URL we created and have not revoked yet. */
  const urlsRef = useRef(new Set<string>());
  /** Bumped to invalidate in-flight async work (cancel, edit again, unmount). */
  const sessionRef = useRef(0);

  const activeFile = files.find((f) => f.id === activeId) ?? files[0];
  const { doc, loading, error: loadError } = usePdfDocument(activeFile?.file);
  const pageCount = doc?.numPages ?? 0;
  const page = Math.min(Math.max(1, pageByFile[activeFile?.id ?? ''] ?? 1), Math.max(1, pageCount));
  const pageIndex = page - 1;
  const pageBoxes = activeFile ? pageRedactionsOf(store, activeFile.id, pageIndex) : [];

  const progressByFile = useMemo(() => {
    const out: Record<string, FileProgress> = {};
    for (const f of files) {
      out[f.id] = {
        boxes: countForFile(store, f.id),
        pages: pagesWithRedactions(store, f.id).length,
      };
    }
    return out;
  }, [files, store]);
  const totalBoxes = Object.values(progressByFile).reduce((n, p) => n + p.boxes, 0);
  const filesWithBoxes = files.filter(
    (f) => !f.encrypted && (progressByFile[f.id]?.boxes ?? 0) > 0,
  );

  // ---------------------------------------------------------------- lifecycle

  const revokeAll = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current.clear();
  }, []);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    const urls = urlsRef.current;
    const session = sessionRef; // counter ref, not a DOM node: safe to read at cleanup
    return () => {
      session.current++;
      workerRef.current?.terminate();
      workerRef.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      releasePdfjs();
    };
  }, []);

  // Warn before closing the tab with unsaved work.
  const hasUnsavedWork = phase !== 'download' ? totalBoxes > 0 : false;
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedWork]);

  // Track the scroll area size for the fit-to-page / fit-to-width modes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = { width: 0, height: 0 };
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth - PAGE_GUTTER;
      const height = el.clientHeight - PAGE_GUTTER;
      if (
        Math.abs(width - last.width) < RESIZE_THRESHOLD &&
        Math.abs(height - last.height) < RESIZE_THRESHOLD
      ) {
        return;
      }
      last = { width, height };
      setAvailable({ width: Math.max(200, width), height: Math.max(200, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // ------------------------------------------------------------- navigation

  const goToPage = useCallback(
    (n: number) => {
      if (!activeFile || pageCount === 0) return;
      const clamped = Math.min(pageCount, Math.max(1, n));
      setPageByFile((prev) => ({ ...prev, [activeFile.id]: clamped }));
    },
    [activeFile, pageCount],
  );

  const zoomStep = (direction: 1 | -1) => setZoom(stepZoom(rendered?.scale ?? 1, direction));

  // ---------------------------------------------------------------- editing

  const fileId = activeFile?.id ?? '';
  const onAdd = useCallback(
    (redactions: Redaction[]) => dispatch({ type: 'add', fileId, page: pageIndex, redactions }),
    [fileId, pageIndex],
  );
  const onUpdate = useCallback(
    (updates: Redaction[]) => dispatch({ type: 'update', fileId, page: pageIndex, updates }),
    [fileId, pageIndex],
  );
  const onRemove = useCallback(
    (ids: string[]) => dispatch({ type: 'remove', fileId, page: pageIndex, ids }),
    [fileId, pageIndex],
  );

  const addFiles = async (list: File[]) => {
    const { accepted, errors } = await intakeFiles(list, files);
    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    if (errors.length > 0) setNotices((n) => [...n, ...errors]);
  };

  const removeFile = (id: string) => {
    dispatch({ type: 'remove-file', fileId: id });
    const remaining = files.filter((f) => f.id !== id);
    if (remaining.length === 0) {
      onStartOver();
      return;
    }
    if (id === activeFile?.id) setActiveId(remaining[0]!.id);
    onFilesChange(remaining);
  };

  useWorkspaceShortcuts(
    {
      selectTool: setTool,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      deleteSelection: () => overlayRef.current?.deleteSelection(),
      deselect: () => overlayRef.current?.deselect(),
      nextPage: () => goToPage(page + 1),
      prevPage: () => goToPage(page - 1),
      zoomIn: () => zoomStep(1),
      zoomOut: () => zoomStep(-1),
      zoomReset: () => setZoom('fit-page'),
    },
    phase === 'edit',
  );

  // ------------------------------------------------------- confirm pipeline

  const getWorker = () => (workerRef.current ??= new PdfProcessorClient());

  const finish = () => {
    stopWorker();
    setConfirm(IDLE_CONFIRM);
    setPhase('download');
    setSupportCard(!isSupportCardHidden());
  };

  const beginApply = () => {
    const queue = filesWithBoxes.map((f) => f.id);
    if (queue.length === 0) return;
    sessionRef.current++;
    stopWorker();
    revokeAll();
    setResults([]);
    setSkipped(files.filter((f) => !queue.includes(f.id)).map((f) => f.name));
    setConfirm({ ...IDLE_CONFIRM, queue });
    setPhase('confirm');
  };

  /** Redact queue[from…]; with `all`, continue without asking per file. */
  const runFrom = async (from: number, all: boolean) => {
    const session = ++sessionRef.current;
    const queue = confirm.queue;
    for (let i = from; i < queue.length; i++) {
      const item = files.find((f) => f.id === queue[i]);
      if (!item) continue;
      setConfirm((c) => ({
        ...c,
        index: i,
        processing: true,
        progress: 0,
        stage: 'Removing content…',
        error: null,
      }));
      const pageRedactions = toPageRedactions(store, item.id);
      let output: DownloadItem;
      try {
        const buffer = await item.file.arrayBuffer();
        const { bytes, report } = await getWorker().redact(buffer, pageRedactions, {
          onProgress: (p) => {
            if (session === sessionRef.current) setConfirm((c) => ({ ...c, progress: p * 0.9 }));
          },
        });
        if (session !== sessionRef.current) return;
        setConfirm((c) => ({ ...c, progress: 0.92, stage: 'Verifying with a second PDF engine…' }));
        const verification = await verifyRedaction(bytes, pageRedactions).catch(() => null);
        if (session !== sessionRef.current) return;
        const url = bytesToObjectUrl(bytes);
        urlsRef.current.add(url);
        output = { fileId: item.id, name: item.name, url, bytes, report, verification };
      } catch (err) {
        if (session !== sessionRef.current) return;
        if (err instanceof RedactJobError && err.code === 'cancelled') {
          setConfirm((c) => ({ ...c, processing: false, progress: 0, error: null }));
          return;
        }
        setConfirm((c) => ({ ...c, processing: false, progress: 0, error: errorMessage(err) }));
        return;
      }
      setResults((r) => [...r.filter((x) => x.fileId !== output.fileId), output]);
      const last = i + 1 >= queue.length;
      if (last) {
        finish();
        return;
      }
      if (!all) {
        setConfirm((c) => ({ ...c, index: i + 1, processing: false, progress: 0, error: null }));
        return;
      }
    }
    finish();
  };

  const skipCurrent = () => {
    const id = confirm.queue[confirm.index];
    const name = files.find((f) => f.id === id)?.name;
    if (name) setSkipped((s) => [...s, name]);
    if (confirm.index + 1 >= confirm.queue.length) finish();
    else setConfirm((c) => ({ ...c, index: c.index + 1, error: null, progress: 0 }));
  };

  const cancelCurrent = () => {
    sessionRef.current++;
    workerRef.current?.cancel();
    setConfirm((c) => ({ ...c, processing: false, progress: 0, error: null }));
  };

  const backToEditing = () => {
    sessionRef.current++;
    stopWorker();
    revokeAll();
    setResults([]);
    setConfirm(IDLE_CONFIRM);
    setPhase('edit');
  };

  // ------------------------------------------------------------------ render

  if (phase === 'download') {
    return (
      <>
        <DownloadPage
          items={results}
          skipped={skipped}
          onEditRedactions={backToEditing}
          onStartOver={onStartOver}
        />
        {supportCard && results.length > 0 && (
          <SupportDialog fileCount={results.length} onContinue={() => setSupportCard(false)} />
        )}
      </>
    );
  }

  const confirmFileId = confirm.queue[confirm.index];
  const confirmFile = files.find((f) => f.id === confirmFileId);
  const editing = phase === 'edit' && !activeFile?.encrypted;

  return (
    <div className="flex h-[calc(100vh-var(--nav-h))] overflow-hidden bg-[#06060f]">
      <DocQueuePanel
        files={files}
        activeId={activeFile?.id}
        progress={progressByFile}
        onSelect={setActiveId}
        onRemove={removeFile}
        onAddFiles={(list) => void addFiles(list)}
        onBackToUpload={onStartOver}
        disabled={phase !== 'edit'}
      />

      <main className="flex min-w-0 flex-1 flex-col" aria-label="Redaction workspace">
        {files.length > 1 && (
          <div className="border-b border-white/[0.06] bg-[#0a0a16] px-3 py-2 lg:hidden">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <span>Document</span>
              <select
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#0d0d1f] px-2 py-1.5 text-sm text-white"
                value={activeFile?.id}
                onChange={(e) => setActiveId(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({progressByFile[f.id]?.boxes ?? 0} boxes)
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <Toolbar
          tool={tool}
          onToolChange={setTool}
          canUndo={store.past.length > 0}
          canRedo={store.future.length > 0}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          pageRedactionCount={pageBoxes.length}
          onClearPage={() => dispatch({ type: 'clear-page', fileId, page: pageIndex })}
          page={page}
          pageCount={pageCount}
          onPageChange={goToPage}
          zoom={zoom}
          scale={rendered?.scale ?? 1}
          onZoom={setZoom}
          onZoomStep={zoomStep}
          disabled={phase !== 'edit'}
        />

        {notices.length > 0 && (
          <div
            className="space-y-1 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2"
            role="status"
          >
            {notices.map((n, i) => (
              <div
                key={`${i}-${n}`}
                className="flex items-start gap-2 text-[12.5px] text-amber-100/90"
              >
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400"
                  aria-hidden="true"
                />
                <span className="flex-1">{n}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setNotices((all) => all.filter((_, k) => k !== i))}
                  className="text-amber-300/70 hover:text-amber-200"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeFile?.encrypted && (
          <div
            className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[12.5px] text-amber-100/90"
            role="alert"
          >
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            This PDF is encrypted. It can be viewed but not redacted. Remove the protection (for
            example with &ldquo;Print to PDF&rdquo;) and upload the unprotected copy.
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
          <div className="grid min-h-full w-max min-w-full place-items-center p-6">
            {loading && (
              <div className="flex flex-col items-center gap-3 text-gray-400" role="status">
                <Loader2 className="h-8 w-8 animate-spin text-violet-500" aria-hidden="true" />
                <p className="text-sm">Opening {activeFile?.name}…</p>
              </div>
            )}
            {loadError && (
              <div
                className="flex max-w-md flex-col items-center gap-3 text-center text-red-300"
                role="alert"
              >
                <AlertCircle className="h-8 w-8" aria-hidden="true" />
                <p className="text-sm">{loadError}</p>
              </div>
            )}
            {doc && activeFile && (
              <PdfViewer
                key={activeFile.id}
                doc={doc}
                pageNumber={page}
                zoom={zoom}
                available={available}
                textSelectable={editing && tool === 'text'}
                textLayerRef={textLayerRef}
                onRendered={setRendered}
              >
                {({ viewport }) => (
                  <FabricOverlay
                    key={`${activeFile.id}:${page}`}
                    ref={overlayRef}
                    viewport={viewport}
                    tool={tool}
                    redactions={pageBoxes}
                    disabled={!editing}
                    textLayerRef={textLayerRef}
                    onAdd={onAdd}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                  />
                )}
              </PdfViewer>
            )}
          </div>
        </div>

        <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-t border-white/[0.06] bg-[#0a0a16] px-4 py-3">
          <div
            className="flex items-center gap-2 text-[12.5px] text-gray-400"
            aria-live="polite"
            data-testid="workspace-status"
          >
            <FileText className="h-4 w-4 text-violet-400" aria-hidden="true" />
            {totalBoxes === 0 ? (
              <span>
                Draw boxes over anything you want removed. Shortcuts: R box, T text, V select,
                Ctrl+Z undo.
              </span>
            ) : (
              <span>
                {totalBoxes} box{totalBoxes === 1 ? '' : 'es'} across {filesWithBoxes.length} file
                {filesWithBoxes.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={beginApply}
            disabled={filesWithBoxes.length === 0 || phase !== 'edit'}
            className="ml-auto flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:from-white/[0.04] disabled:to-white/[0.04] disabled:text-gray-600 disabled:shadow-none"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Apply redactions
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </main>

      {doc && activeFile && (
        <PageThumbnails
          key={activeFile.id}
          doc={doc}
          currentPage={page}
          pages={store.byFile[activeFile.id] ?? NO_PAGES}
          onSelect={goToPage}
          disabled={phase !== 'edit'}
        />
      )}

      {phase === 'confirm' && confirmFile && (
        <ConfirmRedactionDialog
          file={{
            name: confirmFile.name,
            index: confirm.index + 1,
            total: confirm.queue.length,
            boxes: progressByFile[confirmFile.id]?.boxes ?? 0,
            pages: progressByFile[confirmFile.id]?.pages ?? 0,
          }}
          processing={confirm.processing}
          progress={confirm.progress}
          stage={confirm.stage}
          error={confirm.error}
          onApply={() => void runFrom(confirm.index, false)}
          onApplyAll={() => void runFrom(confirm.index, true)}
          onSkip={skipCurrent}
          onEditAgain={backToEditing}
          onCancel={cancelCurrent}
        />
      )}
    </div>
  );
}
