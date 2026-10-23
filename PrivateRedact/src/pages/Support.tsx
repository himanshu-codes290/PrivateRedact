import { Link } from 'react-router';
import { Bug, ExternalLink, Heart, Share2, Star } from 'lucide-react';
import { APP_NAME, ISSUES_URL, REPO_URL, SUPPORT } from '@/config';

const OTHER_WAYS: { icon: typeof Star; title: string; body: string; href: string }[] = [
  {
    icon: Star,
    title: 'Star the repository',
    body: 'A star on GitHub helps other people find the project.',
    href: REPO_URL,
  },
  {
    icon: Bug,
    title: 'Report a PDF that does not redact cleanly',
    body: 'Open an issue describing the file (never attach the real document). Every fixed case becomes a regression test.',
    href: ISSUES_URL,
  },
  {
    icon: Share2,
    title: 'Tell someone who handles sensitive documents',
    body: 'Lawyers, doctors, HR teams and journalists often upload files to redaction services that keep copies.',
    href: `${REPO_URL}#readme`,
  },
];

export default function Support() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="mb-3 text-3xl font-black tracking-tight sm:text-4xl">Support the project</h1>
      <p className="mb-12 text-[15px] text-gray-400">
        {APP_NAME} is free, open source, and has no ads, accounts or tracking. If it saved you from
        uploading a confidential file somewhere, you can say thanks with a one-off or monthly
        sponsorship.
      </p>

      <section className="mb-12 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 sm:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
            <Heart className="h-7 w-7 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white">GitHub Sponsors</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-gray-300">
              Any amount, one-off or monthly, paid by card from anywhere. The button opens{' '}
              {SUPPORT.host} in a new tab.
            </p>
          </div>
          <a
            href={SUPPORT.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-[14px] font-bold text-gray-950 shadow-lg shadow-amber-500/25 transition hover:from-amber-300 hover:to-orange-400"
          >
            <Heart className="h-4 w-4" aria-hidden="true" />
            {SUPPORT.label}
            <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-bold text-white">Other ways to help</h2>
        <ul className="space-y-3">
          {OTHER_WAYS.map(({ icon: Icon, title, body, href }) => (
            <li key={title}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.06]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-white">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-gray-400">
                    {body}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-bold text-white">What this page does not do</h2>
        <p className="mb-3 text-[14.5px] leading-relaxed text-gray-300">
          There is no embedded donation widget. A widget would load a third-party script on every
          visit, which this site’s Content-Security-Policy forbids and the{' '}
          <Link to="/privacy" className="text-violet-300 underline">
            privacy promise
          </Link>{' '}
          rules out. The sponsor button is a plain link: nothing is loaded from {SUPPORT.host} until
          you choose to click it, and your documents are never involved either way.
        </p>
        <p className="text-[14.5px] leading-relaxed text-gray-300">
          Supporting the project changes nothing about the app. There is no paid tier, no feature
          gate and no account.
        </p>
      </section>

      <p className="text-[14px] text-gray-400">
        <Link to="/redact" className="text-violet-300 underline">
          Back to the app
        </Link>
        .
      </p>
    </article>
  );
}
