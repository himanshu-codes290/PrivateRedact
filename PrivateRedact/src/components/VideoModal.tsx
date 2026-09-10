import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PlayIcon } from '@/utils/icons';

interface VideoModalProps {
  open: boolean;
  onClose: () => void;
  /** Video source — a public path (e.g. "/demo.mp4") or an absolute URL. */
  src: string;
  /** Optional poster shown before playback. */
  poster?: string;
  /** Optional action for the "video unavailable" fallback card. */
  onFallbackAction?: () => void;
  fallbackActionLabel?: string;
}

/**
 * Lightbox video player for the "Watch Demo" CTA. Opens over a dimmed
 * backdrop, autoplays with native controls, and closes on Escape, backdrop
 * click, or the close button (body scroll is locked while open).
 *
 * The player lives in a child that only mounts while the modal is open, so
 * closing tears the <video> down (stopping playback) and each reopen probes
 * the source afresh.
 */
export function VideoModal({
  open,
  onClose,
  src,
  poster,
  onFallbackAction,
  fallbackActionLabel = 'Try it yourself',
}: VideoModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Product demo video"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-4xl animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close demo"
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-[#0d0d1f] border border-white/15 text-gray-300 hover:text-white hover:border-white/30 flex items-center justify-center shadow-xl transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl aspect-video">
          <DemoPlayer
            src={src}
            poster={poster}
            onFallbackAction={onFallbackAction}
            fallbackActionLabel={fallbackActionLabel}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The actual <video>, with a graceful fallback. Mounted only while the modal
 * is open, so `failed` starts fresh on every open and there is no need to
 * reset it. If the source can't load (e.g. no demo.mp4 has been dropped into
 * /public yet) it swaps to a placeholder card rather than a broken player.
 */
function DemoPlayer({
  src,
  poster,
  onFallbackAction,
  fallbackActionLabel,
}: Pick<VideoModalProps, 'src' | 'poster' | 'onFallbackAction' | 'fallbackActionLabel'>) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 bg-gradient-to-br from-[#0d0d1f] to-[#12081f]">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/15 text-violet-400 flex items-center justify-center mb-5">
          <PlayIcon />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Demo video coming soon</h3>
        <p className="text-gray-400 text-sm max-w-sm leading-relaxed mb-6">
          The walkthrough isn't available just yet — but the app is fully live.
          Jump in and redact a document in under a minute.
        </p>
        {onFallbackAction && (
          <button
            type="button"
            onClick={onFallbackAction}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold shadow-lg shadow-violet-500/25 transition-all hover:scale-[1.03]"
          >
            {fallbackActionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <video
      src={src}
      poster={poster}
      controls
      autoPlay
      playsInline
      className="w-full h-full bg-black"
      onError={() => setFailed(true)}
    >
      <track kind="captions" />
    </video>
  );
}
