import type { PdfRect } from '@/features/redact/lib/coordinates';

/**
 * Typed postMessage protocol between the main-thread client
 * (`pdfWorker.ts`) and the flatten worker (`pdfProcessor.worker.ts`).
 * `fileId` echoes the request so the client can route one-at-a-time jobs.
 */

export interface RedactRequest {
  type: 'redact';
  fileId: string;
  /** Original PDF bytes — transferred to the worker (zero-copy). */
  buffer: ArrayBuffer;
  /** `pageRedactions[i]` = rects for page i (index 0 = page 1). */
  pageRedactions: (PdfRect[] | undefined)[];
}

export interface ProgressMessage {
  type: 'progress';
  fileId: string;
  /** 0..1 across all pages. */
  progress: number;
}

export interface RedactResultMessage {
  type: 'redact-result';
  fileId: string;
  /** Redacted PDF bytes — exact-length buffer, transferred back. */
  bytes: ArrayBuffer;
  strippedRunCount: number;
  burnedRectCount: number;
}

export interface RedactErrorMessage {
  type: 'redact-error';
  fileId: string;
  message: string;
}

export type WorkerRequest = RedactRequest;
export type WorkerResponse = ProgressMessage | RedactResultMessage | RedactErrorMessage;
