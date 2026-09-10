import { useEffect, useRef, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import type { UploadedFileItem } from '@/features/redact/components/UploadDocument';
import type { PdfRect } from '@/features/redact/lib/coordinates';
import { bytesToObjectUrl } from '@/features/redact/lib/redactionEngine';
import { crossCheckRedactedPdf } from '@/features/redact/lib/crossCheck';
import { PdfProcessorClient } from '@/features/redact/workers/pdfWorker';
import { DocQueuePanel } from './DocQueuePanel';
import { Toolbar } from './Toolbar';
import { PdfViewer } from './PdfViewer';
import { FabricOverlay, type RedactOverlayHandle } from './FabricOverlay';
import { ConfirmRedactionDialog } from './ConfirmRedactionDialog';
import { DownloadPage, type DownloadItem } from './DownloadPage';
import { ShieldCheck, ArrowRight, FileText } from 'lucide-react';

export type RedactionTool = 'select' | 'rect' | 'text';

type WorkspacePhase = 'workspace' | 'confirm' | 'download';

interface RedactWorkspaceProps {
  files: UploadedFileItem[];
  onReset: () => void;
}

/**
 * Two-pane redaction workspace: document queue on the left, canvas +
 * tool strip on the right. Redactions are owned here per file (PDF
 * user-space coords) so the confirm / download flow can read them later.
 *
 * Phase machine: workspace (draw redactions) → confirm (one file at a
 * time through the destructive engine) → download (Blob URLs). Files
 * without redactions are auto-skipped and never reach the download page.
 */
export function RedactWorkspace({ files, onReset }: RedactWorkspaceProps) {
  const [activeFileId, setActiveFileId] = useState(files[0]?.id ?? '');
  const [tool, setTool] = useState<RedactionTool>('rect');
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);
  const [redactionsByFile, setRedactionsByFile] = useState<Record<string, PdfRect[]>>({});
  const overlayRef = useRef<RedactOverlayHandle>(null);

  // Confirm / download phase state.
  const [phase, setPhase] = useState<WorkspacePhase>('workspace');
  const [confirmQueue, setConfirmQueue] = useState<UploadedFileItem[]>([]);
  const [confirmIndex, setConfirmIndex] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DownloadItem[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  // Live mirror so cleanup / transitions can always revoke the latest URLs.
  const resultsRef = useRef<DownloadItem[]>([]);
  // One flatten worker per confirm session; terminated on every exit path.
  const workerRef = useRef<PdfProcessorClient | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0];
  const activeRects = activeFile ? (redactionsByFile[activeFile.id] ?? []) : [];
  const hasRedactions = activeRects.length > 0;

  const totalRedactions = files.reduce((sum, f) => sum + (redactionsByFile[f.id] ?? []).length, 0);
  const redactedFileCount = files.filter((f) => (redactionsByFile[f.id] ?? []).length > 0).length;

  const currentConfirmFile = confirmQueue[confirmIndex];
  const confirmInfo = currentConfirmFile
    ? {
        fileId: currentConfirmFile.id,
        name: currentConfirmFile.name,
        index: confirmIndex + 1,
        total: confirmQueue.length,
        redactionCount: (redactionsByFile[currentConfirmFile.id] ?? []).length,
      }
    : null;

  // Revoke every collected Blob URL and tear down the worker when the
  // workspace unmounts (back to upload, route change, …).
  useEffect(() => {
    return () => {
      resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url));
      resultsRef.current = [];
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const revokeResults = () => {
    resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url));
    resultsRef.current = [];
    setResults([]);
  };

  /** Lazy flatten-worker client (one per confirm session). */
  const getWorker = () => {
    if (!workerRef.current) workerRef.current = new PdfProcessorClient();
    return workerRef.current;
  };

  const stopWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  /** "Apply Redactions" — build the confirm queue from redacted files. */
  const handleBeginRedact = () => {
    const queue = files.filter((f) => (redactionsByFile[f.id] ?? []).length > 0);
    if (queue.length === 0) return;
    stopWorker(); // any previous session's worker is stale by now
    revokeResults();
    setSkippedCount(files.length - queue.length);
    setConfirmQueue(queue);
    setConfirmIndex(0);
    setError(null);
    setProgress(0);
    setPhase('confirm');
  };

  /** Run the destructive engine for the current file (in the worker),
   *  then advance. */
  const processCurrent = async () => {
    const item = confirmQueue[confirmIndex];
    if (!item || processing) return;
    setProcessing(true);
    setError(null);
    setProgress(0);
    try {
      const bytes = await item.file.arrayBuffer();
      const rects = redactionsByFile[item.id] ?? [];
      // Viewer redacts page 1 today; the engine leaves other pages untouched.
      const result = await getWorker().redact(item.id, bytes, [rects], {
        onProgress: setProgress,
      });
      if (import.meta.env.DEV) {
        // DEV-only re-parse with PDF.js — runs on the main thread, where
        // pdf.js (and its own worker) already lives.
        await crossCheckRedactedPdf(result.bytes, [rects]);
      }
      const url = bytesToObjectUrl(result.bytes);
      const nextResults: DownloadItem[] = [
        ...resultsRef.current,
        { fileId: item.id, name: item.name, url },
      ];
      resultsRef.current = nextResults;
      setResults(nextResults);

      if (confirmIndex + 1 >= confirmQueue.length) {
        stopWorker();
        setPhase('download');
      } else {
        setConfirmIndex(confirmIndex + 1);
        setProgress(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error while redacting.');
    } finally {
      setProcessing(false);
    }
  };

  /** Skip the current file (it simply won't appear on the download page). */
  const handleSkip = () => {
    if (processing) return;
    setError(null);
    setProgress(0);
    if (confirmIndex + 1 >= confirmQueue.length) {
      stopWorker();
      setPhase('download');
    } else {
      setConfirmIndex(confirmIndex + 1);
    }
  };

  /** Return to the workspace — redactions stay intact, Blob URLs discarded. */
  const handleEditAgain = () => {
    stopWorker();
    revokeResults();
    setConfirmIndex(0);
    setError(null);
    setProgress(0);
    setPhase('workspace');
  };

  const handleBackToUpload = () => {
    stopWorker();
    revokeResults();
    onReset();
  };

  if (phase === 'download') {
    return (
      <DownloadPage
        items={results}
        skippedCount={skippedCount}
        onEditRedactions={handleEditAgain}
        onBackToUpload={handleBackToUpload}
      />
    );
  }

  return (
    <div className="h-[calc(100vh-65px)] flex bg-[#06060f] overflow-hidden">
      <DocQueuePanel
        files={files}
        activeId={activeFile?.id}
        onSelect={setActiveFileId}
        onReset={handleBackToUpload}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <Toolbar
          tool={tool}
          onToolChange={setTool}
          fileName={activeFile?.name}
          canUndo={hasRedactions}
          canClear={hasRedactions}
          onUndo={() => overlayRef.current?.undo()}
          onClear={() => overlayRef.current?.clear()}
        />

        <div
          className="flex-1 overflow-auto flex flex-col items-center justify-center gap-4 p-6"
          // Reserve the scrollbar gutter permanently. Otherwise the vertical
          // scrollbar toggling as the page is (re)fitted changes this
          // container's clientWidth, which re-fits the page, which toggles the
          // scrollbar again — an endless render loop that also blocks the
          // viewport from ever committing.
          style={{ scrollbarGutter: 'stable' }}
        >
          {activeFile ? (
            <PdfViewer
              key={activeFile.id}
              file={activeFile.file}
              textSelectable={tool === 'text'}
              onViewportReady={({ viewport: v, pageNumber, totalPages }) => {
                setViewport(v);
                setPageInfo({ page: pageNumber, total: totalPages });
              }}
            >
              {viewport && (
                <FabricOverlay
                  ref={overlayRef}
                  viewport={viewport}
                  tool={tool}
                  textSelectable={tool === 'text'}
                  existingRedactions={activeRects}
                  onRedactionChange={(rects) =>
                    setRedactionsByFile((prev) => ({ ...prev, [activeFile.id]: rects }))
                  }
                />
              )}
            </PdfViewer>
          ) : null}

          {viewport && pageInfo && (
            <p className="text-xs text-gray-500">
              Page {pageInfo.page} of {pageInfo.total}
            </p>
          )}
        </div>

        {/* Export bar */}
        <div className="h-16 shrink-0 border-t border-white/[0.06] bg-[#0a0a16] flex items-center gap-4 px-5">
          <div className="flex items-center gap-2 text-[12.5px] text-gray-400">
            <FileText className="w-4 h-4 text-violet-400" />
            {totalRedactions === 0 ? (
              <span>Draw redaction boxes on a document to continue.</span>
            ) : (
              <span>
                {totalRedactions} redaction{totalRedactions === 1 ? '' : 's'} across {redactedFileCount} file
                {redactedFileCount === 1 ? '' : 's'}
                {skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}
              </span>
            )}
          </div>

          <button
            onClick={handleBeginRedact}
            disabled={totalRedactions === 0}
            className={`ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
              totalRedactions === 0
                ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.02]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Apply Redactions
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </main>

      {phase === 'confirm' && confirmInfo && (
        <ConfirmRedactionDialog
          file={confirmInfo}
          processing={processing}
          progress={progress}
          error={error}
          onApply={processCurrent}
          onSkip={handleSkip}
          onEditAgain={handleEditAgain}
          onBackToUpload={handleBackToUpload}
        />
      )}
    </div>
  );
}
