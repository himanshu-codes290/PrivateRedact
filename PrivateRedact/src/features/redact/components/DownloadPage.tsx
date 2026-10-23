import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleCheck,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Heart,
  Info,
  PencilLine,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { SUPPORT } from '@/config';
import type { RedactReport } from '@/features/redact/engine';
import {
  buildZip,
  bytesToObjectUrl,
  redactedFileName,
  triggerDownload,
} from '@/features/redact/lib/download';
import { fileStatus, type DownloadItem, type FileStatus } from '@/features/redact/lib/results';

interface DownloadPageProps {
  items: readonly DownloadItem[];
  /** Names of files that were skipped or had no boxes. */
  skipped: readonly string[];
  onEditRedactions: () => void;
  onStartOver: () => void;
}

function summary(r: RedactReport): string {
  const parts = [`${r.glyphsRemoved} character${r.glyphsRemoved === 1 ? '' : 's'} removed`];
  if (r.imagesRemoved) parts.push(`${r.imagesRemoved} image${r.imagesRemoved === 1 ? '' : 's'}`);
  if (r.annotationsRemoved)
    parts.push(`${r.annotationsRemoved} annotation${r.annotationsRemoved === 1 ? '' : 's'}`);
  if (r.formFlattened) parts.push('form flattened');
  return parts.join(' · ');
}

/** Final stage: per-file results, warnings, preview and download. */
export function DownloadPage({ items, skipped, onEditRedactions, onStartOver }: DownloadPageProps) {
  const [zipping, setZipping] = useState(false);
  const pendingRevokes = useRef<{ url: string; timer: ReturnType<typeof setTimeout> }[]>([]);

  useEffect(() => {
    const pending = pendingRevokes.current;
    return () => {
      for (const p of pending) {
        clearTimeout(p.timer);
        URL.revokeObjectURL(p.url);
      }
    };
  }, []);

  const downloadZip = () => {
    setZipping(true);
    // Let the button repaint before the (synchronous) zip work.
    setTimeout(() => {
      try {
        const zip = buildZip(
          items.map((i) => ({ name: redactedFileName(i.name), bytes: i.bytes })),
        );
        const url = bytesToObjectUrl(zip, 'application/zip');
        triggerDownload(url, 'redacted-documents.zip');
        // The download has started by now; revoke once the browser is done reading it.
        const timer = setTimeout(() => URL.revokeObjectURL(url), 30_000);
        pendingRevokes.current.push({ url, timer });
      } finally {
        setZipping(false);
      }
    }, 0);
  };

  const flagged = items.filter((i) => fileStatus(i) !== 'verified').length;

  return (
    <div className="relative min-h-[calc(100vh-var(--nav-h))] overflow-hidden bg-[#06060f]">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8 text-center animate-fade-in-up">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-300">
            <CircleCheck className="h-4 w-4" aria-hidden="true" />
            Redaction complete
          </div>
          <h1 className="mb-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {items.length} redacted file{items.length === 1 ? '' : 's'} ready
          </h1>
          <p className="mx-auto max-w-md text-[15px] leading-relaxed text-gray-400">
            Processed on this device. Open each file and check it before you share it.
          </p>
        </div>

        {flagged > 0 && (
          <div
            className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-amber-100/90"
            role="alert"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
            <p>
              {flagged} file{flagged === 1 ? ' needs' : 's need'} your review. Read the notes below
              before sharing.
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d1f]/80 shadow-2xl backdrop-blur-xl">
          <ul className="max-h-[56vh] divide-y divide-white/[0.05] overflow-y-auto">
            {items.length === 0 && (
              <li className="flex flex-col items-center gap-3 py-12 text-gray-500">
                <FileText className="h-6 w-6" aria-hidden="true" />
                <p className="text-sm">No files were redacted.</p>
              </li>
            )}
            {items.map((item) => {
              const status = fileStatus(item);
              return (
                <li key={item.fileId} className="p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                      <FileText className="h-5 w-5 text-violet-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-white">
                        {redactedFileName(item.name)}
                      </p>
                      <p className="truncate text-[11.5px] text-gray-500">{summary(item.report)}</p>
                    </div>
                    <StatusBadge status={status} />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Preview
                    </a>
                    <a
                      href={item.url}
                      download={redactedFileName(item.name)}
                      className="flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3.5 py-2 text-[12.5px] font-semibold text-violet-300 transition-colors hover:bg-violet-500/20 hover:text-white"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download
                    </a>
                  </div>
                  <Notes item={item} />
                </li>
              );
            })}
          </ul>

          {skipped.length > 0 && (
            <p className="border-t border-white/[0.05] px-6 py-3 text-[11.5px] text-gray-500">
              Not included (skipped or no boxes): {skipped.join(', ')}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-5">
            <button
              type="button"
              onClick={onStartOver}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Start over
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onEditRedactions}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-[13px] font-semibold text-gray-300 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
                Edit boxes
              </button>
              {items.length > 1 && (
                <button
                  type="button"
                  disabled={zipping}
                  onClick={downloadZip}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60"
                >
                  <FileArchive className="h-4 w-4" aria-hidden="true" />
                  {zipping ? 'Preparing…' : 'Download all (.zip)'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* An outbound link (new tab) rather than a route: navigating away from
            /redact would unmount the workspace and discard these results. */}
        {items.length > 0 && (
          <p className="mt-6 text-center text-[12.5px] text-gray-500">
            Found this useful? The app is free and tracker-free.{' '}
            <a
              href={SUPPORT.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-amber-300/90 underline-offset-2 hover:text-amber-200 hover:underline"
            >
              <Heart className="h-3.5 w-3.5" aria-hidden="true" />
              {SUPPORT.label}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
        <CircleCheck className="h-3 w-3" aria-hidden="true" />
        Verified
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300">
        <TriangleAlert className="h-3 w-3" aria-hidden="true" />
        Text found
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
      <TriangleAlert className="h-3 w-3" aria-hidden="true" />
      Review
    </span>
  );
}

function Notes({ item }: { item: DownloadItem }) {
  const notes: { tone: 'warning' | 'info' | 'error'; text: string }[] = [];
  const v = item.verification;
  if (v && v.charactersUnderBoxes > 0) {
    notes.push({
      tone: 'error',
      text: `Verification found ${v.charactersUnderBoxes} extractable character${v.charactersUnderBoxes === 1 ? '' : 's'} still under boxes on page ${v.pages.join(', ')}. Do not share this file; edit the boxes or report the PDF as a bug.`,
    });
  } else if (!v) {
    notes.push({
      tone: 'info',
      text: 'Automatic verification could not run for this file. Check it manually.',
    });
  }
  for (const w of item.report.warnings) {
    notes.push({ tone: w.severity, text: `${w.page ? `Page ${w.page}: ` : ''}${w.message}` });
  }
  if (item.report.documentItemsRemoved.length > 0) {
    notes.push({
      tone: 'info',
      text: `Also removed: ${item.report.documentItemsRemoved.join(', ')}.`,
    });
  }
  if (notes.length === 0) return null;
  const tone = {
    error: 'text-red-300',
    warning: 'text-amber-200/90',
    info: 'text-gray-400',
  } as const;
  return (
    <ul className="mt-3 space-y-1.5 pl-[3.25rem]">
      {notes.map((n, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 text-[12px] leading-relaxed ${tone[n.tone]}`}
        >
          {n.tone === 'info' ? (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}
