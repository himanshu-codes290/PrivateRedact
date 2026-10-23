// Global test setup. DOM matchers are only meaningful in jsdom tests, but
// registering them is harmless in the Node environment used by the engine.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Testing Library only auto-unmounts when Vitest globals are enabled; this
// project imports test APIs explicitly, so unmount rendered trees here.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// PDF.js 6 relies on Promise.withResolvers (Node >= 22). CI runs Node 22;
// this keeps the suite runnable on older local Node versions too.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}
