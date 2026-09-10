import { FileText, CheckCircle, ArrowLeft } from 'lucide-react';
import type { UploadedFileItem } from '@/features/redact/components/UploadDocument';

interface DocQueuePanelProps {
  files: UploadedFileItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onReset: () => void;
}

/**
 * Left-hand queue listing every uploaded PDF. Selecting a file swaps the
 * viewer in the workspace.
 */
export function DocQueuePanel({ files, activeId, onSelect, onReset }: DocQueuePanelProps) {
  return (
    <aside className="w-72 shrink-0 border-r border-white/[0.06] bg-[#0a0a16] flex flex-col">
      <div className="px-4 py-4 border-b border-white/[0.06]">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-400" />
          Document Queue
          <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold">
            {files.length}
          </span>
        </h2>
        <p className="text-[11px] text-gray-600 mt-1">Select a file to redact</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {files.map((item, index) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all border ${
                isActive
                  ? 'border-violet-500/40 bg-violet-500/10'
                  : 'border-transparent hover:bg-white/[0.04]'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <FileText className={`w-4 h-4 ${isActive ? 'text-violet-300' : 'text-violet-500/70'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-medium truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>
                  {item.name}
                </p>
                <p className="text-[11px] text-gray-600">
                  File {index + 1} · {item.size} MB
                </p>
              </div>
              <CheckCircle className="w-4 h-4 text-emerald-500/80 shrink-0" />
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-white/[0.06]">
        <button
          onClick={onReset}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Upload
        </button>
      </div>
    </aside>
  );
}
