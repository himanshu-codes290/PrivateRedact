import { useLayoutEffect, useRef } from 'react';

/**
 * Ref that always holds the latest value, for use inside long-lived event
 * handlers (Fabric, window listeners) without re-subscribing every render.
 * The ref is updated in a layout effect, never during render.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
