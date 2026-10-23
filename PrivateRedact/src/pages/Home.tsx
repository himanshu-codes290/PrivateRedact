import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  EyeOff,
  FileSearch,
  Files,
  CodeXml,
  Highlighter,
  ShieldCheck,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { DOCS_URL, REPO_URL } from '@/config';

const DOC_LINES = [
  { label: 'Patient name', value: 'Sarah J. Mitchell', barW: 'w-36' },
  { label: 'Date of birth', value: '03 / 14 / 1985', barW: 'w-28' },
  { label: 'SSN', value: '543 - 21 - 8976', barW: 'w-24' },
  { label: 'Home address', value: '1847 Maple St, Portland', barW: 'w-52' },
  { label: 'Phone', value: '(503) 892 - 4417', barW: 'w-32' },
];

const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <WifiOff className="h-6 w-6" />,
    title: 'Never leaves your device',
    desc: 'PDFs are opened and rewritten inside your browser. There is no server, no upload and no account. A strict Content-Security-Policy blocks outgoing requests.',
  },
  {
    icon: <EyeOff className="h-6 w-6" />,
    title: 'Removes, not just covers',
    desc: 'Text under a box is deleted from the file itself, character by character, so it cannot be copied, searched or recovered. Neighbouring text stays exactly where it was.',
  },
  {
    icon: <FileSearch className="h-6 w-6" />,
    title: 'Checked twice',
    desc: 'After redacting, the file is re-opened with a second, independent PDF engine to confirm no text is left under any box. Anything it cannot remove is flagged.',
  },
  {
    icon: <Files className="h-6 w-6" />,
    title: 'Batch friendly',
    desc: 'Queue up to 20 PDFs, mark boxes on any page with draw or text-select tools, undo freely, then apply and download everything as a ZIP.',
  },
];

const STEPS = [
  {
    icon: <Upload className="h-6 w-6" />,
    step: '01',
    title: 'Open your PDFs',
    desc: 'Drop one file or a batch. They are checked to be real PDFs and opened locally.',
  },
  {
    icon: <Highlighter className="h-6 w-6" />,
    step: '02',
    title: 'Mark what to remove',
    desc: 'Draw boxes or select text on any page. Move, resize, undo and redo until it is right.',
  },
  {
    icon: <Download className="h-6 w-6" />,
    step: '03',
    title: 'Apply and download',
    desc: 'Confirm each file, review the verification report, then download the clean copies.',
  },
];

const REMOVED = [
  'Text under each box (including invisible OCR text)',
  'Text inside reusable page templates (form objects)',
  'Images that sit entirely inside a box',
  'Comments, links and form fields touching a box',
  'Document title/author metadata, XMP, bookmarks, attachments, JavaScript',
];

const LIMITS = [
  'Images only partly covered by a box: hidden, but still stored in the file (you are warned)',
  'Scanned pages and text drawn as vector outlines: covered, not removed (you are warned)',
  'Password-protected PDFs: remove the protection first',
  'No automatic detection of names or numbers: you decide what to mark',
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** The looping "fields get redacted" animation in the hero card. */
function useRedactionDemo(enabled: boolean): number {
  const [redacted, setRedacted] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(
      () => setRedacted((n) => (n >= DOC_LINES.length ? 0 : n + 1)),
      redacted >= DOC_LINES.length ? 2400 : 720,
    );
    return () => clearTimeout(t);
  }, [enabled, redacted]);
  return enabled ? redacted : DOC_LINES.length;
}

export function Home() {
  const location = useLocation();
  const reducedMotion = usePrefersReducedMotion();
  const redacted = useRedactionDemo(!reducedMotion);

  // Honour a #hash on arrival (e.g. navbar links from another route).
  useEffect(() => {
    if (!location.hash) return;
    const raf = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  return (
    <div className="overflow-x-hidden text-white">
      {/* Hero */}
      <section className="relative flex min-h-[calc(100vh-var(--nav-h))] items-center">
        <div className="dot-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-[15%] top-1/3 h-[500px] w-[500px] rounded-full bg-violet-700/20 blur-[120px] animate-pulse-blob" />
          <div className="absolute bottom-1/4 right-[10%] h-[400px] w-[400px] rounded-full bg-purple-700/15 blur-[100px] animate-pulse-blob anim-delay-2000" />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-16 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-20">
          <div className="animate-fade-in-up">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-300">
              <span
                className="inline-block h-2 w-2 rounded-full bg-violet-400"
                aria-hidden="true"
              />
              Open-source PDF redaction
            </div>
            <h1 className="mb-6 text-4xl font-black leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.6rem]">
              Redact PDFs.
              <br />
              <span className="shimmer-text">Nothing leaves your device.</span>
            </h1>
            <p className="mb-10 max-w-[500px] text-[1.05rem] leading-relaxed text-gray-400">
              Mark names, numbers or whole regions and PrivateRedact permanently removes them from
              the file, not just paints over them. Everything runs locally in your browser, even
              offline.
            </p>
            <div className="mb-10 flex flex-wrap gap-4">
              <Link
                to="/redact"
                className="group flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-3.5 font-semibold text-white shadow-xl shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500"
              >
                Start redacting
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 font-semibold text-gray-300 transition hover:border-white/20 hover:bg-white/10"
              >
                How it works
              </a>
            </div>
            <ul className="flex flex-wrap gap-5 text-sm text-gray-500">
              {['No upload', 'No account', 'Works offline', 'MIT licensed'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative animate-slide-right anim-delay-300" aria-hidden="true">
            <div className="absolute -inset-6 rounded-3xl bg-gradient-to-r from-violet-600/20 to-purple-600/20 blur-3xl" />
            <div className="scan-overlay relative rounded-2xl border border-white/10 bg-[#0d0d1f] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.02] px-5 py-3.5">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-red-500/60" />
                  <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
                  <span className="h-3 w-3 rounded-full bg-green-500/60" />
                </div>
                <span className="font-mono text-[11px] text-gray-500">intake_form.pdf</span>
                <span className="text-[11px] font-medium text-violet-400">Redacting locally</span>
              </div>
              <div className="p-6">
                <div className="space-y-3">
                  {DOC_LINES.map((line, i) => (
                    <div
                      key={line.label}
                      className="flex items-center justify-between border-b border-white/[0.05] py-1.5 last:border-0"
                    >
                      <span className="w-28 shrink-0 text-[11px] text-gray-500">{line.label}:</span>
                      <div className="ml-2 flex-1">
                        {i < redacted ? (
                          <div className={`h-[18px] ${line.barW} rounded bg-black`} />
                        ) : (
                          <span className="font-mono text-[12px] text-gray-300">{line.value}</span>
                        )}
                      </div>
                      {i < redacted && (
                        <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Text removed from the file
                  </span>
                  <span className="text-[11px] font-semibold text-violet-400">
                    {redacted}/{DOC_LINES.length} fields
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Facts bar */}
      <div className="border-y border-white/[0.05] bg-white/[0.015]">
        <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 py-10 text-center md:grid-cols-4">
          {[
            ['0 bytes', 'uploaded'],
            ['0', 'accounts or trackers'],
            ['2', 'independent PDF engines'],
            ['MIT', 'open-source licence'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="sr-only">{label}</dt>
              <dd className="mb-1 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-3xl font-black text-transparent">
                {value}
              </dd>
              <dd className="text-xs uppercase tracking-wider text-gray-500">{label}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Features */}
      <section id="features" className="relative scroll-mt-24 overflow-hidden py-24">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-14 text-center">
            <h2 className="mb-4 text-3xl font-black tracking-tight sm:text-4xl">
              Private by design. <span className="shimmer-text">Thorough by default.</span>
            </h2>
            <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-gray-400">
              Covering text with a black rectangle is not redaction: the words are still in the
              file. PrivateRedact rewrites the PDF so they are gone.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-purple-600/5 p-6"
              >
                <div
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400"
                  aria-hidden="true"
                >
                  {f.icon}
                </div>
                <h3 className="mb-2 text-[15px] font-bold text-white">{f.title}</h3>
                <p className="text-[13px] leading-relaxed text-gray-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="relative scroll-mt-24 overflow-hidden border-t border-white/[0.04] py-24"
      >
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-14 text-center">
            <h2 className="mb-4 text-3xl font-black tracking-tight sm:text-4xl">
              Three steps to a <span className="shimmer-text">clean copy</span>
            </h2>
          </div>
          <ol className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <li
                key={s.step}
                className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-7"
              >
                <span
                  className="absolute right-6 top-6 text-4xl font-black tabular-nums text-white/[0.06]"
                  aria-hidden="true"
                >
                  {s.step}
                </span>
                <div
                  className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400"
                  aria-hidden="true"
                >
                  {s.icon}
                </div>
                <h3 className="mb-2 text-[15px] font-bold text-white">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-gray-400">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* What is removed / limits */}
      <section
        id="what-is-removed"
        className="relative scroll-mt-24 border-t border-white/[0.04] py-24"
      >
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 sm:px-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-7">
            <h2 className="mb-5 text-xl font-bold text-white">Removed from the file</h2>
            <ul className="space-y-3">
              {REMOVED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[13.5px] text-gray-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-7">
            <h2 className="mb-5 text-xl font-bold text-white">Know the limits</h2>
            <ul className="space-y-3">
              {LIMITS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[13.5px] text-gray-300">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[12.5px] text-gray-500">
              Always open the redacted copy and check it before sharing it.
            </p>
          </div>
        </div>
      </section>

      {/* Docs / open source */}
      <section id="docs" className="relative scroll-mt-24 border-t border-white/[0.04] py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="mb-4 text-3xl font-black tracking-tight sm:text-4xl">
            Open source, <span className="shimmer-text">inspectable</span>
          </h2>
          <p className="mb-10 text-[15px] leading-relaxed text-gray-400">
            The redaction engine, its tests and the architecture notes are public. Read exactly what
            happens to your file, or run it yourself.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/redact"
              className="group flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-3.5 font-semibold text-white shadow-xl shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500"
            >
              Open the app
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 font-semibold text-gray-300 transition hover:border-white/20 hover:bg-white/10"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Documentation
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 font-semibold text-gray-300 transition hover:border-white/20 hover:bg-white/10"
            >
              <CodeXml className="h-4 w-4" aria-hidden="true" />
              Source code
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
