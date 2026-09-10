import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ShieldIcon } from '@/utils/icons';

interface LayoutProps {
  children: ReactNode;
}

const NAV_LINKS = ['Features', 'How it Works', 'Pricing', 'Docs'];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="min-h-screen bg-[#06060f] text-white overflow-x-hidden flex flex-col">

      {/* ── Navbar ──────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4 glass border-b border-white/[0.06]">
        <Link to="/" id="nav-logo" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:shadow-violet-500/50 transition-shadow">
            <ShieldIcon className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[15px] tracking-tight">PrivateRedact</span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-sm text-gray-400">
          {isHome
            ? NAV_LINKS.map(link => (
                <a
                  key={link}
                  href={`#${link.toLowerCase().replace(/\s/g, '-')}`}
                  className="hover:text-white transition-colors duration-200"
                >
                  {link}
                </a>
              ))
            : NAV_LINKS.map(link => (
                <Link
                  key={link}
                  to={`/#${link.toLowerCase().replace(/\s/g, '-')}`}
                  className="hover:text-white transition-colors duration-200"
                >
                  {link}
                </Link>
              ))}
        </div>

        <div className="flex items-center gap-3">
          <button className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors px-3 py-2">
            Log in
          </button>
          <Link
            to="/redact"
            id="nav-get-started"
            className="text-sm bg-violet-600 hover:bg-violet-500 transition-colors px-4 py-2 rounded-lg font-semibold shadow-lg shadow-violet-500/20"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      {/* ── Page content ─────────────────────────────────────── */}
      <main className="flex-1 pt-[65px]">
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[13px] text-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-600 to-purple-800 flex items-center justify-center">
              <ShieldIcon className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-gray-400 font-semibold">PrivateRedact</span>
          </div>
          <p>© 2026 PrivateRedact. All rights reserved.</p>
          <div className="flex gap-6">
            {['Privacy', 'Terms', 'Contact'].map(l => (
              <a key={l} href="#" className="hover:text-gray-400 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>

    </div>
  );
}
