import { MousePointer2, Square, Type, Undo2, Trash2, ShieldCheck } from 'lucide-react';
import type { RedactionTool } from './RedactWorkspace';

interface ToolbarProps {
  tool: RedactionTool;
  onToolChange: (tool: RedactionTool) => void;
  fileName?: string;
  canUndo?: boolean;
  canClear?: boolean;
  onUndo?: () => void;
  onClear?: () => void;
}

const TOOLS: { id: RedactionTool; label: string; icon: typeof Square }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'text', label: 'Text', icon: Type },
];

/**
 * Tool strip above the canvas: drawing tools on the left, undo / clear /
 * redact actions on the right. Undo + clear delegate to the Fabric overlay
 * via callbacks lifted up from the workspace.
 */
export function Toolbar({ tool, onToolChange, fileName, canUndo, canClear, onUndo, onClear }: ToolbarProps) {
  return (
    <div className="h-14 shrink-0 border-b border-white/[0.06] bg-[#0a0a16] flex items-center gap-2 px-4">
      <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onToolChange(id)}
            title={label}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
              tool === id
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/25'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-white/[0.06] mx-1" />

      <div className="flex items-center gap-1">
        <button
          title="Undo"
          disabled={!canUndo}
          onClick={onUndo}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 disabled:opacity-40 disabled:text-gray-600 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          title="Clear redactions"
          disabled={!canClear}
          onClick={onClear}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 disabled:opacity-40 disabled:text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {fileName && (
          <p className="text-[13px] text-gray-400 truncate max-w-64 hidden lg:block">{fileName}</p>
        )}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 text-[11px] font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          Offline · Private
        </div>
      </div>
    </div>
  );
}
