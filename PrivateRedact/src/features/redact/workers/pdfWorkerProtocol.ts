import type { PageRedactions, RedactReport, RedactionErrorCode } from '@/features/redact/engine';

/**
 * Typed postMessage protocol between the main-thread client (`pdfWorker.ts`)
 * and the redaction worker (`pdfProcessor.worker.ts`).
 *
 * Every request carries a unique `jobId` that the worker echoes back, so
 * responses can never be routed to the wrong caller.
 */

export interface RedactRequest {
  type: 'redact';
  jobId: number;
  /** Original PDF bytes, transferred (zero-copy) to the worker. */
  buffer: ArrayBuffer;
  pageRedactions: PageRedactions;
}

export interface ProgressMessage {
  type: 'progress';
  jobId: number;
  /** 0..1 */
  progress: number;
}

export interface RedactResultMessage {
  type: 'redact-result';
  jobId: number;
  /** Redacted PDF bytes, transferred back (zero-copy). */
  bytes: ArrayBuffer;
  report: RedactReport;
}

export interface RedactErrorMessage {
  type: 'redact-error';
  jobId: number;
  message: string;
  code?: RedactionErrorCode;
  stack?: string;
}

export type WorkerRequest = RedactRequest;
export type WorkerResponse = ProgressMessage | RedactResultMessage | RedactErrorMessage;
