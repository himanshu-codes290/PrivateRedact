import { useEffect } from 'react';
import { useLatest } from '@/hooks/useLatest';

export interface ShortcutHandlers {
  selectTool: (tool: 'select' | 'rect' | 'text') => void;
  undo: () => void;
  redo: () => void;
  deleteSelection: () => void;
  deselect: () => void;
  nextPage: () => void;
  prevPage: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

/** True when the event target is a text field, where shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * Workspace keyboard shortcuts:
 *   V / R / T          select, rectangle, text tool
 *   Ctrl+Z, Ctrl+Y     undo, redo (Ctrl+Shift+Z also redoes)
 *   Delete/Backspace   delete selected boxes
 *   Esc                deselect
 *   PageUp/PageDown    previous / next page
 *   Ctrl + / - / 0     zoom in / out / fit
 */
export function useWorkspaceShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useLatest(handlers);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const h = ref.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && key === 'z') return run(e.shiftKey ? h.redo : h.undo);
      if (mod && key === 'y') return run(h.redo);
      if (mod && (key === '+' || key === '=')) return run(h.zoomIn);
      if (mod && key === '-') return run(h.zoomOut);
      if (mod && key === '0') return run(h.zoomReset);
      if (mod || e.altKey) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          return run(h.deleteSelection);
        case 'Escape':
          return h.deselect();
        case 'PageDown':
          return run(h.nextPage);
        case 'PageUp':
          return run(h.prevPage);
      }
      if (key === 'v') return h.selectTool('select');
      if (key === 'r') return h.selectTool('rect');
      if (key === 't') return h.selectTool('text');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, ref]);
}
