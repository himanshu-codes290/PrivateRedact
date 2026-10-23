import { Link } from 'react-router';
import { REPO_URL } from '@/config';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Your files stay on your device',
    body: [
      'PDFs you add are read by your browser and processed in memory on this device. They are never uploaded: PrivateRedact has no server-side component.',
      'Redaction runs in a Web Worker inside this browser tab. The redacted copy is handed to you as a local download.',
    ],
  },
  {
    title: 'No tracking',
    body: [
      'There is no analytics, no advertising, no cookies and no account. Fonts and PDF.js resources are served from this site, not from third-party CDNs.',
      'In production the page sends a Content-Security-Policy that only allows connections to this site, so the app cannot send your data elsewhere even by accident.',
    ],
  },
  {
    title: 'What stays in memory, and for how long',
    body: [
      'Files and redacted copies live in this tab’s memory until you choose “Start over”, close the tab or reload. Download links are temporary blob: URLs that are revoked when you leave the workspace.',
      'The app can be installed and cached for offline use. The cache contains only the application code, never your documents.',
    ],
  },
  {
    title: 'Verify it yourself',
    body: [
      'Open your browser’s developer tools, switch to the Network tab and redact a file: no request carries your document. The full source code is public.',
    ],
  },
];

export default function Privacy() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="mb-3 text-3xl font-black tracking-tight sm:text-4xl">Privacy</h1>
      <p className="mb-12 text-[15px] text-gray-400">
        The short version: your documents never leave your device.
      </p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="mb-10">
          <h2 className="mb-3 text-lg font-bold text-white">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="mb-3 text-[14.5px] leading-relaxed text-gray-300">
              {p}
            </p>
          ))}
        </section>
      ))}
      <p className="text-[14px] text-gray-400">
        Source code:{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-300 underline"
        >
          {REPO_URL.replace('https://', '')}
        </a>
        .{' '}
        <Link to="/redact" className="text-violet-300 underline">
          Open the app
        </Link>
        .
      </p>
    </article>
  );
}
