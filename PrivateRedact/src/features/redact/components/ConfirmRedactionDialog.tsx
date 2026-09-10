import { FileText, TriangleAlert, Loader2, ArrowLeft, X, ShieldCheck } from 'lucide-react';

/** A single file awaiting its (destructive) confirm step. */
export interface ConfirmFileInfo {
  fileId: string;
  name: string;
  /** Position in the per-file confirm queue (1-based display). */
  index: number;
  /** Total files in the confirm queue. */
  total: number;
  redactionCount: number;
}

interface ConfirmRedactionDialogProps {
  file: ConfirmFileInfo;
  /** True while the destructive flatten job for this file is running. */
  processing: boolean;
  /** Background flatten progress, 0..1. */
  progress: number;
  /** Per-file processing error (encrypted PDF, parse failure, …). */
  error: string | null;
  onApply: () => void;
  onSkip: () => void;
  onEditAgain: () => void;
  onBackToUpload: () => void;
}

/**
 * Sequential per-file confirm step. Wraps the background destructive
 * flatten job: warning + redaction summary, progress while processing,
 * and an error state (retry / skip / edit again / back to upload).
 */
export function ConfirmRedactionDialog({
  file,
  processing,
  progress,
  error,
  onApply,
  onSkip,
  onEditAgain,
  onBackToUpload,
}: ConfirmRedactionDialogProps) {
  const percent = Math.round(progress * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#0d0d1f] shadow-2xl animate-fade-in-up overflow-hidden">
        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-white/[0.06]">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-violet-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-white">Confirm Redaction</h2>
              <p className="text-[13px] text-gray-400 truncate mt-0.5">{file.name}</p>
            </div>
            <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-300 text-[11px] font-semibold">
              <FileText className="w-3 h-3" />
              File {file.index} of {file.total}
            </span>
          </div>
        </div>

        <div className="p-7 space-y-5">
          {/* Destructive-intent warning */}
          <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5">
            <TriangleAlert className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
            <div className="text-[13px] leading-relaxed text-red-200/90">
              <p className="font-semibold text-red-300">This action is permanent and cannot be undone.</p>
              <p className="mt-1 text-red-200/60">
                {file.redactionCount} redaction{file.redactionCount === 1 ? '' : 's'} will be destroyed into this
                document. Text inside the redaction areas is removed from the file itself — not just covered.
              </p>
            </div>
          </div>

          {/* What happens */}
          <div className="grid gap-2 text-[12.5px] text-gray-400">
            {[
              'Text runs intersecting each redaction box are permanently stripped',
              'Opaque boxes are burned onto the page over each redaction',
              'Underlying annotations (links / highlights) are cleared',
            ].map((line) => (
              <div key={line} className="flex items-start gap-2.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                <span>{line}</span>
              </div>
            ))}
          </div>

          {/* Progress while processing */}
          {processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[13px] text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <span>Redacting…</span>
                <span className="ml-auto tabular-nums text-violet-300">{percent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-150"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-600">
                Flattening redactions into the PDF — do not close this tab.
              </p>
            </div>
          )}

          {/* Per-file error */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5">
              <TriangleAlert className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div className="text-[13px] text-red-200/90">
                <p className="font-semibold text-red-300">Could not redact this file</p>
                <p className="mt-0.5 text-red-200/60">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-7 py-5 border-t border-white/[0.06] flex items-center gap-2">
          {!processing && (
            <>
              <button
                onClick={onEditAgain}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                Edit Again
              </button>
              <button
                onClick={onSkip}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:text-gray-300 hover:bg-white/[0.04] transition-all"
              >
                <X className="w-4 h-4" />
                Skip File
              </button>
              <button
                onClick={onBackToUpload}
                className="text-[12px] text-gray-600 hover:text-gray-300 transition-colors px-2"
              >
                Back to Upload
              </button>
            </>
          )}

          <button
            onClick={onApply}
            disabled={processing}
            className={`ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
              processing
                ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.02]'
            }`}
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Working…
              </>
            ) : error ? (
              'Retry Redaction'
            ) : (
              'Apply Redaction'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
