import { useRef } from 'react';
import { FileText, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface ConfirmFileInfo {
  name: string;
  /** Position in the confirm queue (1-based). */
  index: number;
  total: number;
  boxes: number;
  pages: number;
}

interface ConfirmRedactionDialogProps {
  file: ConfirmFileInfo;
  processing: boolean;
  /** 0..1 while processing. */
  progress: number;
  /** Status line while processing (e.g. "Verifying…"). */
  stage: string;
  error: string | null;
  onApply: () => void;
  onApplyAll: () => void;
  onSkip: () => void;
  onEditAgain: () => void;
  onCancel: () => void;
}

const secondary =
  'rounded-xl px-3.5 py-2 text-[13px] font-medium text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

/**
 * Per-file confirmation before the irreversible step. While the worker runs
 * it shows progress and offers Cancel; on failure it offers retry/skip.
 */
export function ConfirmRedactionDialog({
  file,
  processing,
  progress,
  stage,
  error,
  onApply,
  onApplyAll,
  onSkip,
  onEditAgain,
  onCancel,
}: ConfirmRedactionDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, processing ? undefined : onEditAgain);
  const percent = Math.round(progress * 100);
  const remaining = file.total - file.index + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d1f] shadow-2xl animate-fade-in-up focus:outline-none"
      >
        <div className="border-b border-white/[0.06] px-6 pb-5 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
              <ShieldCheck className="h-5 w-5 text-violet-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="confirm-title" className="text-[15px] font-bold text-white">
                Apply redactions
              </h2>
              <p className="mt-0.5 truncate text-[13px] text-gray-400">{file.name}</p>
            </div>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300">
              <FileText className="h-3 w-3" aria-hidden="true" />
              {file.index} of {file.total}
            </span>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-4">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
            <div id="confirm-desc" className="text-[13px] leading-relaxed text-red-200/90">
              <p className="font-semibold text-red-300">The redacted copy cannot be un-redacted.</p>
              <p className="mt-1 text-red-200/70">
                {file.boxes} box{file.boxes === 1 ? '' : 'es'} on {file.pages} page
                {file.pages === 1 ? '' : 's'} will be applied. Your original file is not modified.
              </p>
            </div>
          </div>

          <ul className="grid gap-2 text-[12.5px] text-gray-400">
            {[
              'Text under each box is deleted from the file, not just covered',
              'Images fully inside a box are deleted; partly covered images are flagged',
              'Comments, links and form fields touching a box are removed',
              'Document metadata, bookmarks and attachments are stripped',
              'The result is re-checked with a second PDF engine',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[13px] text-gray-300">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" aria-hidden="true" />
                <span role="status">{stage}</span>
                <span className="ml-auto tabular-nums text-violet-300">{percent}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="Redaction progress"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-500 transition-[width] duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-4"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <div className="text-[13px] text-red-200/90">
                <p className="font-semibold text-red-300">This file could not be redacted</p>
                <p className="mt-0.5 text-red-200/70">{error}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-6 py-5">
          {processing ? (
            <button
              type="button"
              className={`${secondary} ml-auto`}
              onClick={onCancel}
              data-autofocus
            >
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className={secondary} onClick={onEditAgain}>
                Back to editing
              </button>
              <button type="button" className={secondary} onClick={onSkip}>
                Skip file
              </button>
              <div className="ml-auto flex items-center gap-2">
                {remaining > 1 && !error && (
                  <button type="button" className={secondary} onClick={onApplyAll}>
                    Apply to all {remaining}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onApply}
                  data-autofocus
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                >
                  {error ? 'Retry' : 'Apply'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
