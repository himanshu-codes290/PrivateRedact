import { FileText, CheckCircle, Download, ShieldCheck, ArrowLeft, ArrowRight } from 'lucide-react';

/** A file that has been confirmed and fully redacted. */
export interface DownloadItem {
  fileId: string;
  /** Original uploaded file name. */
  name: string;
  /** Redacted blob URL — revoked by the parent on unmount / re-run. */
  url: string;
}

interface DownloadPageProps {
  items: DownloadItem[];
  /** Files that were auto-skipped because they had no redactions. */
  skippedCount: number;
  onEditRedactions: () => void;
  onBackToUpload: () => void;
}

/** `report.pdf` → `report_redacted.pdf`. */
export function redactedFileName(name: string): string {
  return name.replace(/\.pdf$/i, '') + '_redacted.pdf';
}

/** Programmatic anchor download (no server, no navigation). */
function triggerDownload(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Final stage after every redacted file has been confirmed. Lists ONLY the
 * confirmed files with per-file downloads wired to their Blob URLs.
 */
export function DownloadPage({ items, skippedCount, onEditRedactions, onBackToUpload }: DownloadPageProps) {
  const downloadAll = () => {
    // Sequential clicks; a tiny gap avoids browser throttling when many files.
    items.forEach((item, i) => {
      setTimeout(() => triggerDownload(item.url, redactedFileName(item.name)), i * 250);
    });
  };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#06060f] relative overflow-hidden">
      <div className="absolute inset-0 dot-grid pointer-events-none opacity-50" />
      <div className="absolute top-1/4 right-[15%] w-[420px] h-[420px] rounded-full bg-emerald-700/10 blur-[120px] animate-pulse-blob pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-10 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-medium mb-5">
            <CheckCircle className="w-4 h-4" />
            Redaction Complete
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-3">
            Your redacted <span className="shimmer-text">documents</span> are ready
          </h1>
          <p className="text-gray-400 text-[15px] leading-relaxed max-w-md mx-auto">
            {items.length} file{items.length === 1 ? '' : 's'} redacted permanently. All processing stayed on your
            device.
          </p>
        </div>

        {/* Card */}
        <div
          className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d1f]/80 backdrop-blur-xl shadow-2xl animate-fade-in-up anim-delay-200 overflow-hidden"
          style={{ boxShadow: '0 0 60px rgba(16,185,129,0.06), 0 25px 50px rgba(0,0,0,0.5)' }}
        >
          <div className="px-8 pt-7 pb-6 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <Download className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white">Redacted files</h2>
                <p className="text-xs text-gray-500 mt-0.5">Download individual files or grab them all</p>
              </div>
            </div>
          </div>

          {/* File list */}
          <div className="p-6 space-y-3 max-h-[46vh] overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-gray-500">
                <FileText className="w-6 h-6 text-gray-600" />
                <p className="text-sm">No files were confirmed for download.</p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.fileId}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-white truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-600 truncate">{redactedFileName(item.name)}</p>
                  </div>
                  <a
                    href={item.url}
                    download={redactedFileName(item.name)}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-violet-300 border border-violet-500/25 bg-violet-500/10 hover:bg-violet-500/20 hover:text-white transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                </div>
              ))
            )}
          </div>

          {skippedCount > 0 && (
            <div className="px-6 pb-2">
              <p className="text-[11.5px] text-gray-600">
                {skippedCount} file{skippedCount === 1 ? ' was' : 's were'} skipped — no redactions were added.
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-5 border-t border-white/[0.06] flex items-center justify-between gap-3">
            <button
              onClick={onBackToUpload}
              className="flex items-center gap-1.5 text-[13px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] px-3 py-2 rounded-xl transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Upload
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onEditRedactions}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-gray-300 border border-white/[0.08] hover:bg-white/[0.05] hover:text-white transition-all"
              >
                <ShieldCheck className="w-4 h-4" />
                Edit Redactions
              </button>
              <button
                disabled={items.length === 0}
                onClick={downloadAll}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  items.length === 0
                    ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02]'
                }`}
              >
                Download All
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
