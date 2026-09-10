import { redactPdf } from '@/features/redact/lib/redactionEngine';
import type { WorkerRequest, WorkerResponse } from './pdfWorkerProtocol';

/**
 * Redaction worker — runs the heavy pdf-lib flatten job (strip text runs,
 * burn opaque boxes, normalize pages) off the main thread.
 *
 * The worker bundle deliberately contains only pdf-lib: the DEV cross-check
 * uses PDF.js, which stays on the main thread (see `lib/crossCheck.ts`).
 * The source bytes arrive transferred (zero-copy) and the redacted bytes
 * are copied into an exact-length buffer and transferred back.
 */

// The app compiles against the DOM lib (where `self` is Window); narrow it
// to the dedicated-worker API this file actually uses.
interface RedactionWorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const ctx = self as unknown as RedactionWorkerScope;

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'redact') return;

  const post = (message: WorkerResponse, transfer?: Transferable[]) =>
    ctx.postMessage(message, transfer);

  try {
    const result = await redactPdf(msg.buffer, msg.pageRedactions, {
      onProgress: (progress) => post({ type: 'progress', fileId: msg.fileId, progress }),
    });
    // pdf-lib's save() may return a padded backing buffer; hand back an
    // exact-length copy so the main thread can wrap it safely.
    const exact = new Uint8Array(result.bytes.byteLength);
    exact.set(result.bytes);
    post(
      {
        type: 'redact-result',
        fileId: msg.fileId,
        bytes: exact.buffer as ArrayBuffer,
        strippedRunCount: result.strippedRunCount,
        burnedRectCount: result.burnedRectCount,
      },
      [exact.buffer as ArrayBuffer],
    );
  } catch (err) {
    post({
      type: 'redact-error',
      fileId: msg.fileId,
      message: err instanceof Error ? err.message : 'Unknown redaction worker error.',
    });
  }
});
