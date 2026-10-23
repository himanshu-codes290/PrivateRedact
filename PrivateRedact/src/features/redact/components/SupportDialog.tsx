import { useRef, useState } from 'react';
import { ArrowRight, CircleCheck, ExternalLink, Heart } from 'lucide-react';
import { SUPPORT } from '@/config';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { setSupportCardHidden } from '@/features/redact/lib/supportCard';

interface SupportDialogProps {
  /** Number of files that were just redacted (for the headline). */
  fileCount: number;
  onContinue: () => void;
}

/**
 * Shown once redaction finishes, before the results are usable: a thank-you
 * card with a sponsor link and a Continue button. The link is
 * a plain outbound link (new tab), never an embedded widget, so nothing is
 * loaded from a third party unless the user clicks it.
 */
export function SupportDialog({ fileCount, onContinue }: SupportDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hideNextTime, setHideNextTime] = useState(false);

  const continueToResults = () => {
    setSupportCardHidden(hideNextTime);
    onContinue();
  };
  useFocusTrap(panelRef, continueToResults);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-title"
        aria-describedby="support-desc"
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d1f] shadow-2xl animate-fade-in-up focus:outline-none"
      >
        <div className="relative px-6 pb-6 pt-7 text-center">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-amber-500/15 to-transparent"
            aria-hidden="true"
          />
          <div className="relative">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[12px] font-medium text-emerald-300">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {fileCount} file{fileCount === 1 ? '' : 's'} redacted on your device
            </div>
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
              <Heart className="h-8 w-8 text-white" aria-hidden="true" />
            </span>
            <h2 id="support-title" className="text-xl font-black tracking-tight text-white">
              Enjoying PrivateRedact?
            </h2>
            <p id="support-desc" className="mt-2 text-[13.5px] leading-relaxed text-gray-400">
              It is free, open source and tracker-free, and nothing you redact ever leaves this
              device. If it saved you an upload, a small sponsorship keeps it going.
            </p>
          </div>
        </div>

        <div className="space-y-3 px-6 pb-6">
          <a
            href={SUPPORT.url}
            target="_blank"
            rel="noopener noreferrer"
            data-autofocus
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-[14px] font-bold text-gray-950 shadow-lg shadow-amber-500/25 transition hover:from-amber-300 hover:to-orange-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {SUPPORT.label}
            <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={continueToResults}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-5 py-3 text-[14px] font-semibold text-gray-200 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            Continue to your files
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <label className="flex cursor-pointer items-center justify-center gap-2 pt-1 text-[12px] text-gray-500 hover:text-gray-400">
            <input
              type="checkbox"
              checked={hideNextTime}
              onChange={(e) => setHideNextTime(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-violet-500"
            />
            Don’t show this again
          </label>
        </div>
      </div>
    </div>
  );
}
