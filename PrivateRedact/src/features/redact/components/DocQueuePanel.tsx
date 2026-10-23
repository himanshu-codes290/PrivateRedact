import { useRef } from 'react';
import { ArrowLeft, FilePlus, FileText, Lock, X } from 'lucide-react';
import { formatBytes, type QueuedFile } from '@/features/redact/lib/fileIntake';

export interface FileProgress {
  boxes: number;
  pages: number;
}

interface DocQueuePanelProps {
  files: readonly QueuedFile[];
  activeId?: string;
  progress: Readonly<Record<string, FileProgress>>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onBackToUpload: () => void;
  disabled?: boolean;
}

/** Left-hand queue: switch, add and remove documents. */
export function DocQueuePanel({
  files,
  activeId,
  progress,
  onSelect,
  onRemove,
  onAddFiles,
  onBackToUpload,
  disabled = false,
}: DocQueuePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const remove = (file: QueuedFile) => {
    const boxes = progress[file.id]?.boxes ?? 0;
    const ok =
      boxes === 0 ||
      window.confirm(
        `Remove ${file.name}? Its ${boxes} redaction box${boxes === 1 ? '' : 'es'} will be discarded.`,
      );
    if (ok) onRemove(file.id);
  };

  return (
    <aside
      className="hidden w-72 shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a16] lg:flex"
      aria-label="Document queue"
    >
      <div className="border-b border-white/[0.06] px-4 py-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <FileText className="h-4 w-4 text-violet-400" aria-hidden="true" />
          Documents
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500/20 px-1.5 text-[10px] font-bold text-violet-300">
            {files.length}
          </span>
        </h2>
      </div>

      <ul className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {files.map((item) => {
          const active = item.id === activeId;
          const p = progress[item.id];
          return (
            <li key={item.id} className="group relative">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(item.id)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 pr-9 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${
                  active
                    ? 'border-violet-500/40 bg-violet-500/10'
                    : 'border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                  {item.encrypted ? (
                    <Lock className="h-4 w-4 text-amber-400" aria-hidden="true" />
                  ) : (
                    <FileText
                      className={`h-4 w-4 ${active ? 'text-violet-300' : 'text-violet-500/70'}`}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13px] font-medium ${active ? 'text-white' : 'text-gray-300'}`}
                  >
                    {item.name}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {formatBytes(item.size)}
                    {item.encrypted
                      ? ' · encrypted'
                      : p && p.boxes > 0
                        ? ` · ${p.boxes} box${p.boxes === 1 ? '' : 'es'} on ${p.pages} page${p.pages === 1 ? '' : 's'}`
                        : ' · no boxes yet'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(item)}
                aria-label={`Remove ${item.name}`}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 opacity-60 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1 border-t border-white/[0.06] p-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (list.length > 0) onAddFiles(list);
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-violet-300 transition-colors hover:bg-violet-500/10"
        >
          <FilePlus className="h-4 w-4" aria-hidden="true" />
          Add PDFs
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onBackToUpload}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Start over
        </button>
      </div>
    </aside>
  );
}
