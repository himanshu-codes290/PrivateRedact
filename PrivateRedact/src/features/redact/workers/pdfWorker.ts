import type { PdfRect } from '@/features/redact/lib/coordinates';
import type { WorkerRequest, WorkerResponse } from './pdfWorkerProtocol';

/**
 * Typed client for `pdfProcessor.worker.ts` (the flatten worker).
 *
 * One instance = one worker. The workspace keeps a single client for the
 * whole confirm session (jobs run strictly one at a time) and terminates it
 * on unmount / back-to-upload / edit-again — never leaked.
 */

export interface RedactJobOptions {
  /** Progress callback, 0..1. Mirrors `RedactPdfOptions.onProgress`. */
  onProgress?: (progress: number) => void;
}

export interface RedactJobResult {
  bytes: Uint8Array;
  strippedRunCount: number;
  burnedRectCount: number;
}

interface PendingJob {
  resolve: (result: RedactJobResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

export class PdfProcessorClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingJob>();

  constructor() {
    this.worker = new Worker(new URL('./pdfProcessor.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      const message = event.message || 'Redaction worker crashed.';
      for (const job of this.pending.values()) job.reject(new Error(message));
      this.pending.clear();
    };
  }

  private handleMessage(msg: WorkerResponse): void {
    if (msg.type === 'progress') {
      this.pending.get(msg.fileId)?.onProgress?.(msg.progress);
      return;
    }
    const job = this.pending.get(msg.fileId);
    if (!job) return;
    this.pending.delete(msg.fileId);
    if (msg.type === 'redact-result') {
      job.resolve({
        bytes: new Uint8Array(msg.bytes),
        strippedRunCount: msg.strippedRunCount,
        burnedRectCount: msg.burnedRectCount,
      });
    } else {
      job.reject(new Error(msg.message));
    }
  }

  /** Run one flatten job. The caller's `buffer` is detached (transferred). */
  redact(
    fileId: string,
    buffer: ArrayBuffer,
    pageRedactions: (PdfRect[] | undefined)[],
    options: RedactJobOptions = {},
  ): Promise<RedactJobResult> {
    return new Promise((resolve, reject) => {
      this.pending.set(fileId, { resolve, reject, onProgress: options.onProgress });
      const request: WorkerRequest = { type: 'redact', fileId, buffer, pageRedactions };
      this.worker.postMessage(request, [buffer]);
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const job of this.pending.values()) job.reject(new Error('Redaction worker terminated.'));
    this.pending.clear();
  }
}
