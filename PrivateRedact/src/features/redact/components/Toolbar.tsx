import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MousePointer2,
  MoveHorizontal,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { ZoomMode } from '@/features/redact/lib/coordinates';

export type RedactionTool = 'select' | 'rect' | 'text';

interface ToolbarProps {
  tool: RedactionTool;
  onToolChange: (tool: RedactionTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  pageRedactionCount: number;
  onClearPage: () => void;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  zoom: ZoomMode;
  /** Scale actually used for the current render (for the % readout). */
  scale: number;
  onZoom: (zoom: ZoomMode) => void;
  onZoomStep: (direction: 1 | -1) => void;
  disabled?: boolean;
}

const TOOLS: { id: RedactionTool; label: string; key: string; icon: LucideIcon; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    icon: MousePointer2,
    hint: 'Move, resize or delete boxes',
  },
  { id: 'rect', label: 'Box', key: 'R', icon: Square, hint: 'Drag to draw a redaction box' },
  { id: 'text', label: 'Text', key: 'T', icon: Type, hint: 'Select text to redact it' },
];

const iconButton =
  'flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

/** Tool strip above the page: tools, history, page navigation and zoom. */
export function Toolbar(props: ToolbarProps) {
  const {
    tool,
    onToolChange,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    pageRedactionCount,
    onClearPage,
    page,
    pageCount,
    onPageChange,
    zoom,
    scale,
    onZoom,
    onZoomStep,
    disabled = false,
  } = props;

  const clearPage = () => {
    if (pageRedactionCount === 0) return;
    const ok = window.confirm(
      `Remove all ${pageRedactionCount} box${pageRedactionCount === 1 ? '' : 'es'} on page ${page}? You can undo this.`,
    );
    if (ok) onClearPage();
  };

  return (
    <div
      className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0a0a16] px-3 py-2"
      role="toolbar"
      aria-label="Redaction tools"
    >
      <div
        className="flex items-center gap-1 rounded-xl bg-white/[0.03] p-1"
        role="group"
        aria-label="Tool"
      >
        {TOOLS.map(({ id, label, key, icon: Icon, hint }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onToolChange(id)}
            aria-pressed={tool === id}
            title={`${hint} (${key})`}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-40 ${
              tool === id
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/25'
                : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="mx-1 hidden h-6 w-px bg-white/[0.06] sm:block" />

      <div className="flex items-center gap-1" role="group" aria-label="History">
        <button
          type="button"
          className={iconButton}
          disabled={disabled || !canUndo}
          onClick={onUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={disabled || !canRedo}
          onClick={onRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${iconButton} hover:!text-red-400`}
          disabled={disabled || pageRedactionCount === 0}
          onClick={clearPage}
          aria-label={`Clear boxes on page ${page}`}
          title="Clear boxes on this page"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <PageNavigator
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
          disabled={disabled}
        />
        <div className="hidden h-6 w-px bg-white/[0.06] md:block" />
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button
            type="button"
            className={iconButton}
            disabled={disabled}
            onClick={() => onZoomStep(-1)}
            aria-label="Zoom out"
            title="Zoom out (Ctrl -)"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-gray-400" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className={iconButton}
            disabled={disabled}
            onClick={() => onZoomStep(1)}
            aria-label="Zoom in"
            title="Zoom in (Ctrl +)"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${iconButton} ${zoom === 'fit-width' ? 'text-violet-300' : ''}`}
            disabled={disabled}
            onClick={() => onZoom('fit-width')}
            aria-label="Fit width"
            aria-pressed={zoom === 'fit-width'}
            title="Fit width"
          >
            <MoveHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${iconButton} ${zoom === 'fit-page' ? 'text-violet-300' : ''}`}
            disabled={disabled}
            onClick={() => onZoom('fit-page')}
            aria-label="Fit page"
            aria-pressed={zoom === 'fit-page'}
            title="Fit page (Ctrl 0)"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PageNavigator({
  page,
  pageCount,
  onPageChange,
  disabled,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled: boolean;
}) {
  // Draft text while the user types; `null` means "show the real page".
  const [draft, setDraft] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(draft ?? '', 10);
    if (Number.isFinite(n)) onPageChange(Math.min(pageCount, Math.max(1, n)));
    setDraft(null);
  };

  return (
    <form className="flex items-center gap-1" onSubmit={submit} aria-label="Page navigation">
      <button
        type="button"
        className={iconButton}
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        title="Previous page (PageUp)"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="sr-only">Page</span>
        <input
          className="h-8 w-11 rounded-md border border-white/10 bg-white/[0.04] text-center text-xs text-white tabular-nums focus:border-violet-500 focus:outline-none"
          inputMode="numeric"
          disabled={disabled || pageCount === 0}
          value={draft ?? String(page)}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setDraft(e.target.value.replace(/\D/g, ''))
          }
          onBlur={() => setDraft(null)}
          aria-label={`Page number, 1 to ${pageCount}`}
        />
        <span className="tabular-nums">of {pageCount || '–'}</span>
      </label>
      <button
        type="button"
        className={iconButton}
        disabled={disabled || page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        title="Next page (PageDown)"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
