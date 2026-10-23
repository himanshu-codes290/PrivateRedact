import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { Home } from './pages/Home';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

// Heavy routes are code-split: PDF.js, pdf-lib (worker) and Fabric only load
// when the user opens the workspace, never on the landing page.
const Redact = lazy(() => import('./pages/Redact'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Support = lazy(() => import('./pages/Support'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-violet-500" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <Layout>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/redact" element={<Redact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/support" element={<Support />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
