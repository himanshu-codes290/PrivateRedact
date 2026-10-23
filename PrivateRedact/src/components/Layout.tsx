import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Heart, Shield } from 'lucide-react';
import { APP_NAME, REPO_URL } from '@/config';

interface LayoutProps {
  children: ReactNode;
}

const SECTION_LINKS = [
  { label: 'Features', hash: 'features' },
  { label: 'How it works', hash: 'how-it-works' },
  { label: 'Limits', hash: 'what-is-removed' },
];

export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const isHome = pathname === '/';
  // The workspace is a full-height app view: no marketing footer under it.
  const isApp = pathname.startsWith('/redact');

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#06060f] text-white">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="glass fixed inset-x-0 top-0 z-50 border-b border-white/[0.06]">
        <nav
          className="flex h-[var(--nav-h)] items-center justify-between px-4 sm:px-6"
          aria-label="Main"
        >
          <Link to="/" className="group flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-800 shadow-lg shadow-violet-500/30">
              <Shield className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">{APP_NAME}</span>
          </Link>

          <div className="hidden items-center gap-7 text-sm text-gray-400 md:flex">
            {SECTION_LINKS.map((l) =>
              isHome ? (
                <a key={l.hash} href={`#${l.hash}`} className="transition-colors hover:text-white">
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.hash}
                  to={`/#${l.hash}`}
                  className="transition-colors hover:text-white"
                >
                  {l.label}
                </Link>
              ),
            )}
            <NavLink
              to="/privacy"
              className={({ isActive }) =>
                `transition-colors hover:text-white ${isActive ? 'text-white' : ''}`
              }
            >
              Privacy
            </NavLink>
            <NavLink
              to="/support"
              className={({ isActive }) =>
                `flex items-center gap-1.5 transition-colors hover:text-white ${isActive ? 'text-white' : ''}`
              }
            >
              <Heart className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              Support
            </NavLink>
          </div>

          <Link
            to="/redact"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold shadow-lg shadow-violet-500/20 transition-colors hover:bg-violet-500"
          >
            {isApp ? 'Workspace' : 'Open app'}
          </Link>
        </nav>
      </header>

      <main id="main" className="flex-1 pt-[var(--nav-h)]" tabIndex={-1}>
        {children}
      </main>

      {!isApp && (
        <footer className="border-t border-white/[0.05] py-8">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-[13px] text-gray-500 md:flex-row">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-purple-800">
                <Shield className="h-3.5 w-3.5 text-white" aria-hidden="true" />
              </span>
              <span className="font-semibold text-gray-400">{APP_NAME}</span>
            </div>
            <p>Open source under the MIT licence. Your files never leave your device.</p>
            <nav className="flex gap-6" aria-label="Footer">
              <Link to="/privacy" className="transition-colors hover:text-gray-300">
                Privacy
              </Link>
              <Link to="/support" className="transition-colors hover:text-gray-300">
                Support
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-gray-300"
              >
                Source
              </a>
              <a
                href={`${REPO_URL}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-gray-300"
              >
                Licence
              </a>
            </nav>
          </div>
        </footer>
      )}
    </div>
  );
}
