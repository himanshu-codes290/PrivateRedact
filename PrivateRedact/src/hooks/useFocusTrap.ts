import { useEffect, type RefObject } from 'react';
import { useLatest } from './useLatest';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside `container` while it is mounted (modal
 * dialogs), call `onEscape` on Escape, and restore focus to whatever was
 * focused before the dialog opened.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  onEscape?: () => void,
): void {
  const escapeRef = useLatest(onEscape);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('inert'),
      );

    const initial = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? root;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [container, escapeRef]);
}
