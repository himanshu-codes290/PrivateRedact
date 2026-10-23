/// <reference lib="webworker" />
import { RedactionError, redactPdf } from '@/features/redact/engine';
import type { WorkerRequest, WorkerResponse } from './pdfWorkerProtocol';

/**
 * Redaction worker: runs the pdf-lib engine off the main thread so the UI
 * stays responsive on large files. The bundle contains pdf-lib only (no
 * PDF.js, no React).
 */
declare const self: DedicatedWorkerGlobalScope;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'redact') return;
  const { jobId } = msg;

  redactPdf(msg.buffer, msg.pageRedactions, {
    onProgress: (progress) => post({ type: 'progress', jobId, progress }),
  })
    .then(({ bytes, report }) => {
      // pdf-lib returns an exact-length array; copy only if it is a view.
      const exact =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes
          : bytes.slice();
      const buffer = exact.buffer as ArrayBuffer;
      post({ type: 'redact-result', jobId, bytes: buffer, report }, [buffer]);
    })
    .catch((err: unknown) => {
      post({
        type: 'redact-error',
        jobId,
        message: err instanceof Error ? err.message : 'Unknown error in the redaction worker.',
        code: err instanceof RedactionError ? err.code : undefined,
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
});
