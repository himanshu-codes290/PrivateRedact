import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  ShieldIcon,
  FileIcon,
  ZapIcon,
  EyeOffIcon,
  ArrowRightIcon,
  PlayIcon,
  CheckIcon,
} from '../utils/icons';
import { Upload, Highlighter, Download, Check, BookOpen, Lock, HelpCircle, Sparkles } from 'lucide-react';
import { VideoModal } from '../components/VideoModal';

/** Demo clip served from /public. Drop a demo.mp4 there to enable it. */
const DEMO_VIDEO_SRC = '/demo.mp4';

// ── Document lines (animated redaction demo) ───────────────────
const DOC_LINES = [
  { label: 'Patient Name',  value: 'Sarah J. Mitchell',        barW: 'w-36' },
  { label: 'Date of Birth', value: '03 / 14 / 1985',           barW: 'w-28' },
  { label: 'SSN',           value: '543 - 21 - 8976',          barW: 'w-24' },
  { label: 'Home Address',  value: '1847 Maple St, Portland',  barW: 'w-52' },
  { label: 'Phone',         value: '(503) 892 - 4417',         barW: 'w-32' },
];

// ── Feature cards ──────────────────────────────────────────────
const FEATURES = [
  {
    icon:    <ShieldIcon className="w-6 h-6" />,
    title:   'Military-Grade Encryption',
    desc:    'All processing runs locally on your device — files never touch any server. AES-256 secured end-to-end.',
    grad:    'from-violet-500/15 to-purple-600/10',
    border:  'border-violet-500/25',
    iconCls: 'bg-violet-500/15 text-violet-400',
    glow:    'rgba(124,58,237,0.18)',
  },
  {
    icon:    <FileIcon className="w-6 h-6" />,
    title:   'AdvanceS PII Detection',
    desc:    'Automatically surfaces names, SSNs, emails, addresses, and PHI across PDFs, Word docs, and images.',
    grad:    'from-fuchsia-500/15 to-pink-600/10',
    border:  'border-fuchsia-500/25',
    iconCls: 'bg-fuchsia-500/15 text-fuchsia-400',
    glow:    'rgba(192,38,211,0.18)',
  },
  {
    icon:    <ZapIcon className="w-6 h-6" />,
    title:   'Batch Processing in Seconds',
    desc:    'Redact hundreds of documents in one click without accuracy tradeoffs — bulk-ready from day one.',
    grad:    'from-indigo-500/15 to-blue-600/10',
    border:  'border-indigo-500/25',
    iconCls: 'bg-indigo-500/15 text-indigo-400',
    glow:    'rgba(79,70,229,0.18)',
  },
  {
    icon:    <EyeOffIcon className="w-6 h-6" />,
    title:   'Zero Logs. Zero Traces.',
    desc:    'We collect no telemetry, no document metadata, no usage logs. What you redact stays redacted — forever.',
    grad:    'from-rose-500/15 to-red-600/10',
    border:  'border-rose-500/25',
    iconCls: 'bg-rose-500/15 text-rose-400',
    glow:    'rgba(225,29,72,0.18)',
  },
];

// ── Stats bar data ──────────────────────────────────────────────
const STATS = [
  // { value: '10M+',    label: 'Documents Redacted' },
  // { value: '256-bit', label: 'AES Encryption'     },
  { value: '100%',    label: 'Offline Processing'  },
  { value: '0',       label: 'Data Logs Stored'    },
];

// ── How it Works steps ─────────────────────────────────────────
const STEPS = [
  {
    icon:  <Upload className="w-6 h-6" />,
    step:  '01',
    title: 'Upload your documents',
    desc:  'Drop in a PDF — or a whole batch. Files open locally in your browser and are never uploaded anywhere.',
  },
  {
    icon:  <Highlighter className="w-6 h-6" />,
    step:  '02',
    title: 'Mark what to remove',
    desc:  'Draw redaction boxes or select text directly on the page. Everything you mark is queued for permanent removal.',
  },
  {
    icon:  <Download className="w-6 h-6" />,
    step:  '03',
    title: 'Download the clean file',
    desc:  'Confirm and export. The underlying text and metadata are destroyed inside the file — not just covered with boxes.',
  },
];

// ── Pricing tiers ──────────────────────────────────────────────
const PRICING = [
  {
    name:      'Free',
    price:     '$0',
    cadence:   'forever',
    blurb:     'Everything an individual needs to redact with confidence.',
    features:  ['Unlimited local redactions', 'Draw & text-select tools', '100% offline processing', 'No signup required'],
    cta:       'Start Redacting',
    highlight: false,
  },
  {
    name:      'Pro',
    price:     '$12',
    cadence:   'per month',
    blurb:     'For professionals handling sensitive documents daily.',
    features:  ['Everything in Free', 'Batch redaction automation', 'Saved redaction presets', 'AI-assisted PII detection'],
    cta:       'Get Pro',
    highlight: true,
  },
  {
    name:      'Enterprise',
    price:     'Custom',
    cadence:   'contact us',
    blurb:     'Compliance, SSO, and on-prem deployment for teams.',
    features:  ['Everything in Pro', 'SSO & audit logging', 'On-prem / air-gapped install', 'Dedicated support & SLA'],
    cta:       'Talk to Sales',
    highlight: false,
  },
];

// ── Docs categories ────────────────────────────────────────────
const DOCS = [
  {
    icon:  <Sparkles className="w-5 h-5" />,
    title: 'Getting Started',
    desc:  'Upload your first document and produce a redacted file in under a minute.',
  },
  {
    icon:  <Highlighter className="w-5 h-5" />,
    title: 'Redaction Guide',
    desc:  'Master the draw, select, and text tools — plus tips for clean multi-line redactions.',
  },
  {
    icon:  <Lock className="w-5 h-5" />,
    title: 'Security & Privacy',
    desc:  'How on-device processing works and why your files never leave the browser.',
  },
  {
    icon:  <HelpCircle className="w-5 h-5" />,
    title: 'FAQ',
    desc:  'Supported formats, file-size limits, and answers to common redaction questions.',
  },
];

// ── Component ──────────────────────────────────────────────────
export function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [redacted, setRedacted] = useState(0);
  const [phase, setPhase]       = useState<'redacting' | 'hold' | 'reset'>('redacting');
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (phase === 'redacting') {
      t = redacted < DOC_LINES.length
        ? setTimeout(() => setRedacted(n => n + 1), 720)
        : setTimeout(() => setPhase('hold'), 1800);
    } else if (phase === 'hold') {
      t = setTimeout(() => setPhase('reset'), 600);
    } else {
      t = setTimeout(() => { setRedacted(0); setPhase('redacting'); }, 400);
    }
    return () => clearTimeout(t);
  }, [phase, redacted]);

  /** Smooth-scroll to an on-page section by id (used by the hero/CTA buttons). */
  const scrollToId = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Honor a #hash on arrival (e.g. the navbar "Pricing" link from the Redact
  // page routes to /#pricing) once the target section is laid out.
  useEffect(() => {
    if (!location.hash) return;
    const raf = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  return (
    <div className="text-white overflow-x-hidden">

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center">

        {/* Background — dot grid + gradient blobs */}
        <div className="absolute inset-0 dot-grid pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-[15%]  w-[500px] h-[500px] rounded-full bg-violet-700/20  blur-[120px] animate-pulse-blob" />
          <div className="absolute bottom-1/4 right-[10%] w-[400px] h-[400px] rounded-full bg-purple-700/15 blur-[100px] animate-pulse-blob anim-delay-2000" />
          <div className="absolute top-2/3 left-1/2      w-[300px] h-[300px] rounded-full bg-fuchsia-700/10 blur-[90px]  animate-float-delayed" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 py-28 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center w-full">

          {/* ── Left: Copy ──────────────────────────────────── */}
          <div className="animate-fade-in-up">

            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-8">
              <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse inline-block" />
              Privacy-First Document Redaction
            </div>

            {/* Headline */}
            <h1 className="text-5xl lg:text-[3.6rem] font-black leading-[1.1] tracking-tight mb-6">
              Redact Sensitive&nbsp;Data.
              <br />
              <span className="shimmer-text">Stay Protected.</span>
            </h1>

            {/* Subtext */}
            <p className="text-[1.05rem] text-gray-400 leading-relaxed mb-10 max-w-[480px]">
              PrivateRedact uses on-device AI to detect and permanently remove PII, PHI, and
              confidential information from your documents — instantly, with zero data ever
              leaving your machine.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-4 mb-12">
              <button id="hero-cta-start"
                onClick={() => navigate('/redact')}
                className="group flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-xl shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.03]">
                Start Redacting Free
                <span className="group-hover:translate-x-1 transition-transform duration-200">
                  <ArrowRightIcon />
                </span>
              </button>
              <button id="hero-cta-demo"
                onClick={() => setDemoOpen(true)}
                className="flex items-center gap-2.5 px-8 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl font-semibold text-gray-300 transition-all duration-300 hover:scale-[1.03]">
                <PlayIcon />
                Watch Demo
              </button>
            </div>

            {/* Trust pills */}
            <div className="flex flex-wrap gap-5 text-sm text-gray-500">
              {['No signup required', '100% offline processing', 'HIPAA & GDPR compliant'].map(t => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckIcon className="w-3.5 h-3.5 text-emerald-500" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* ── Right: Animated Document Card ───────────────── */}
          <div className="animate-slide-right anim-delay-300 relative">

            {/* Glow halo behind the card */}
            <div className="absolute -inset-6 bg-gradient-to-r from-violet-600/20 to-purple-600/20 rounded-3xl blur-3xl" />

            {/* Card */}
            <div className="relative bg-[#0d0d1f] border border-white/10 rounded-2xl shadow-2xl scan-overlay">

              {/* Window chrome */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07] bg-white/[0.02]">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/60"    />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <span className="w-3 h-3 rounded-full bg-green-500/60"  />
                </div>
                <span className="text-[11px] text-gray-500 font-mono">medical_record_2024.pdf</span>
                <div className="flex items-center gap-1.5 text-[11px] text-violet-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse inline-block" />
                  AI Processing
                </div>
              </div>

              <div className="p-6">
                {/* CONFIDENTIAL banner */}
                <div className="text-center py-2 mb-5 border border-red-500/25 rounded-lg bg-red-500/5">
                  <p className="text-[10px] font-bold tracking-[0.2em] text-red-400/60 uppercase">
                    ⚠ Confidential Document
                  </p>
                </div>

                {/* Document rows */}
                <div className="space-y-3">
                  {DOC_LINES.map((line, i) => (
                    <div key={i}
                      className="flex items-center justify-between py-1.5 border-b border-white/[0.05] last:border-0">
                      <span className="text-[11px] text-gray-500 w-28 shrink-0">{line.label}:</span>

                      <div className="flex-1 ml-2">
                        {i < redacted ? (
                          <div className={`h-[18px] ${line.barW} rounded bg-[#1a1a2e] flex items-center px-1.5 gap-1 overflow-hidden`}
                               style={{ transition: 'all 0.25s ease' }}>
                            {Array.from({ length: 10 }).map((_, j) => (
                              <div key={j} className="w-[7px] h-[10px] rounded-[2px] bg-gray-700 shrink-0" />
                            ))}
                          </div>
                        ) : (
                          <span className="text-[12px] text-gray-300 font-mono">{line.value}</span>
                        )}
                      </div>

                      {i < redacted && (
                        <CheckIcon className="w-3.5 h-3.5 text-emerald-500/70 ml-2 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Card footer */}
                <div className="mt-5 pt-4 border-t border-white/[0.07] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <ShieldIcon className="w-3.5 h-3.5" />
                    AES-256 Encrypted
                  </div>
                  <span className="text-[11px] text-violet-400 font-semibold">
                    {redacted}/{DOC_LINES.length} fields redacted
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-700"
                    style={{ width: `${(redacted / DOC_LINES.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Floating badge — top right */}
            <div className="absolute -top-5 -right-5 glass border border-emerald-500/25 rounded-2xl px-4 py-2.5 shadow-xl animate-float animate-badge-pop anim-delay-500">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                <span className="text-emerald-400 font-semibold">Zero data stored</span>
              </div>
            </div>

            {/* Floating badge — bottom left */}
            <div className="absolute -bottom-5 -left-5 glass border border-violet-500/25 rounded-2xl px-4 py-3 shadow-xl animate-float-delayed animate-badge-pop anim-delay-700">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-2xl leading-none">🔒</span>
                <div>
                  <p className="text-white font-semibold">HIPAA Compliant</p>
                  <p className="text-gray-500 text-[10px]">Enterprise ready</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── Stats Bar ───────────────────────────────────────── */}
      <div className="border-y border-white/[0.05] bg-white/[0.015]">
        <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {STATS.map(s => (
            <div key={s.label}>
              <p className="text-3xl font-black bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent mb-1">
                {s.value}
              </p>
              <p className="text-xs text-gray-500 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="relative py-28 overflow-hidden">
        <div className="absolute inset-0 dot-grid pointer-events-none opacity-50" />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-5">
              Why PrivateRedact?
            </div>
            <h2 className="text-4xl font-black mb-4 tracking-tight">
              Built for Privacy.&nbsp;
              <span className="shimmer-text">Designed for Speed.</span>
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto text-[15px] leading-relaxed">
              Whether you're handling medical records, legal contracts, or financial filings —
              PrivateRedact keeps you compliant and your clients protected.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f, i) => (
              <div key={i}
                className={`group relative p-6 rounded-2xl bg-gradient-to-br ${f.grad} border ${f.border} transition-all duration-300 hover:scale-[1.03] cursor-default`}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 8px 40px ${f.glow}`)}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                <div className={`w-11 h-11 rounded-xl ${f.iconCls} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  {f.icon}
                </div>
                <h3 className="text-[15px] font-bold text-white mb-2">{f.title}</h3>
                <p className="text-gray-500 text-[13px] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it Works ────────────────────────────────────── */}
      <section id="how-it-works" className="relative scroll-mt-24 py-28 overflow-hidden border-t border-white/[0.04]">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-violet-800/10 blur-[130px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-5">
              How it Works
            </div>
            <h2 className="text-4xl font-black mb-4 tracking-tight">
              Three steps to a&nbsp;
              <span className="shimmer-text">permanently redacted</span> file
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto text-[15px] leading-relaxed">
              No accounts, no uploads, no waiting. Everything happens right here in your browser.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((s) => (
              <div
                key={s.step}
                className="relative p-7 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.035] transition-colors duration-300"
              >
                <span className="absolute top-6 right-6 text-4xl font-black text-white/[0.06] tabular-nums">
                  {s.step}
                </span>
                <div className="w-12 h-12 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center mb-5">
                  {s.icon}
                </div>
                <h3 className="text-[15px] font-bold text-white mb-2">{s.title}</h3>
                <p className="text-gray-500 text-[13px] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="relative scroll-mt-24 py-28 overflow-hidden border-t border-white/[0.04]">
        <div className="absolute inset-0 dot-grid pointer-events-none opacity-40" />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-5">
              Pricing
            </div>
            <h2 className="text-4xl font-black mb-4 tracking-tight">
              Free to start.&nbsp;
              <span className="shimmer-text">Priced for scale.</span>
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto text-[15px] leading-relaxed">
              Redaction is free for everyone, forever. Upgrade only when your team needs automation and compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto items-start">
            {PRICING.map((tier) => (
              <div
                key={tier.name}
                className={`relative p-7 rounded-2xl border transition-all duration-300 ${
                  tier.highlight
                    ? 'border-violet-500/40 bg-gradient-to-b from-violet-600/15 to-purple-600/5 shadow-xl shadow-violet-500/10 md:-translate-y-3'
                    : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.035]'
                }`}
              >
                {tier.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white text-[11px] font-semibold shadow-lg shadow-violet-500/30">
                    Most Popular
                  </span>
                )}
                <h3 className="text-[15px] font-bold text-white mb-1">{tier.name}</h3>
                <p className="text-gray-500 text-[12.5px] leading-relaxed mb-5 min-h-[34px]">{tier.blurb}</p>
                <div className="flex items-end gap-1.5 mb-6">
                  <span className="text-4xl font-black text-white tracking-tight">{tier.price}</span>
                  <span className="text-[12px] text-gray-500 mb-1.5">{tier.cadence}</span>
                </div>
                <button
                  onClick={() => navigate('/redact')}
                  className={`w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all mb-6 ${
                    tier.highlight
                      ? 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/25 hover:scale-[1.02]'
                      : 'border border-white/[0.12] text-gray-200 hover:bg-white/[0.05]'
                  }`}
                >
                  {tier.cta}
                </button>
                <ul className="space-y-2.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-gray-400">
                      <Check className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Docs ────────────────────────────────────────────── */}
      <section id="docs" className="relative scroll-mt-24 py-28 overflow-hidden border-t border-white/[0.04]">
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 items-center">
            {/* Left: intro */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-5">
                <BookOpen className="w-3.5 h-3.5" />
                Documentation
              </div>
              <h2 className="text-4xl font-black mb-4 tracking-tight">
                Everything you need to&nbsp;
                <span className="shimmer-text">redact with confidence</span>
              </h2>
              <p className="text-gray-400 text-[15px] leading-relaxed mb-8">
                Short, practical guides covering the workflow end to end — from your first redaction to how we
                guarantee nothing ever leaves your device.
              </p>
              <button
                onClick={() => navigate('/redact')}
                className="group flex items-center gap-2.5 px-7 py-3.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-xl shadow-violet-500/25 hover:scale-[1.03]"
              >
                Open the app
                <span className="group-hover:translate-x-1 transition-transform duration-200">
                  <ArrowRightIcon />
                </span>
              </button>
            </div>

            {/* Right: doc cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DOCS.map((d) => (
                <div
                  key={d.title}
                  className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-violet-500/25 transition-all duration-300 cursor-default"
                >
                  <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center mb-4">
                    {d.icon}
                  </div>
                  <h3 className="text-[14px] font-bold text-white mb-1.5">{d.title}</h3>
                  <p className="text-gray-500 text-[12.5px] leading-relaxed">{d.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ──────────────────────────────────────── */}
      <section className="relative py-28 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(124,58,237,0.12) 0%, transparent 70%)' }} />
        <div className="absolute inset-0 border-t border-white/[0.04] pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-7">
            Get started in 30 seconds
          </div>
          <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-5 leading-[1.1]">
            Start Protecting Your<br />Documents Today
          </h2>
          <p className="text-gray-400 text-lg mb-10">
            Join thousands of organizations that trust PrivateRedact to keep their sensitive data safe — for free.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <button id="bottom-cta-start"
              onClick={() => navigate('/redact')}
              className="group flex items-center gap-2.5 px-10 py-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 rounded-xl font-semibold text-white transition-all duration-300 shadow-xl shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.03]">
              Get Started — It's Free
              <span className="group-hover:translate-x-1 transition-transform"><ArrowRightIcon /></span>
            </button>
            <button id="bottom-cta-pricing"
              onClick={() => scrollToId('pricing')}
              className="px-10 py-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl font-semibold text-gray-300 transition-all duration-300">
              View Pricing
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer is in shared Layout ───────────────────────── */}

      {/* ── Demo video lightbox (Watch Demo CTA) ─────────────── */}
      <VideoModal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        src={DEMO_VIDEO_SRC}
        onFallbackAction={() => {
          setDemoOpen(false);
          navigate('/redact');
        }}
        fallbackActionLabel="Start redacting free"
      />

    </div>
  );
}