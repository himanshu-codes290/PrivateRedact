import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { ISSUES_URL } from '@/config';

interface Props {
  children: ReactNode;
  /** Changing this value resets the boundary (e.g. the current route). */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

/**
 * Catches render errors so one broken component (a malformed PDF crashing
 * a viewer, say) shows a recovery screen instead of a blank page.
 *
 * Deliberately no error-reporting SDK: sending stack traces to a third
 * party would contradict the privacy promise. The error stays local.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert">
        <div className="max-w-md rounded-2xl border border-red-500/25 bg-red-500/5 p-8 text-center">
          <TriangleAlert className="mx-auto mb-4 h-8 w-8 text-red-400" aria-hidden="true" />
          <h1 className="mb-2 text-lg font-bold text-white">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-400">
            The page hit an unexpected error. Nothing was uploaded; your files are still only on
            this device.
          </p>
          <pre className="mb-6 max-h-32 overflow-auto rounded-lg bg-black/40 p-3 text-left text-[11px] text-red-200/80">
            {error.message}
          </pre>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reload
            </button>
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-white/5"
            >
              Report an issue
            </a>
          </div>
        </div>
      </div>
    );
  }
}
