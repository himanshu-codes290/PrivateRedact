import type { PageRedactions, RedactReport, RedactionErrorCode } from '@/features/redact/engine';
import type { WorkerRequest, WorkerResponse } from './pdfWorkerProtocol';

/**
 * Main-thread client for the redaction worker.
 *
 *  - one job at a time per client; each job gets a unique id
 *  - `cancel()` terminates the worker (the only way to stop synchronous
 *    work mid-flight) and a fresh worker is created on the next job
 *  - a watchdog rejects jobs that run longer than `timeoutMs`
 *  - a crashed worker is discarded rather than reused
 */

export interface RedactJobResult {
  bytes: Uint8Array;
  report: RedactReport;
}

export class RedactJobError extends Error {
  readonly code: RedactionErrorCode | 'cancelled' | 'timeout' | 'crashed';

  constructor(code: RedactJobError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RedactJobError';
    this.code = code;
  }
}

interface PendingJob {
  id: number;
  resolve: (result: RedactJobResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type WorkerFactory = () => Worker;

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('./pdfProcessor.worker.ts', import.meta.url), { type: 'module' });

export class PdfProcessorClient {
  private worker: Worker | null = null;
  private job: PendingJob | null = null;
  private nextId = 1;
  private readonly factory: WorkerFactory;
  private readonly timeoutMs: number;

  constructor(options: { factory?: WorkerFactory; timeoutMs?: number } = {}) {
    this.factory = options.factory ?? defaultFactory;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  get busy(): boolean {
    return this.job !== null;
  }

  /** Run one redaction job. The caller's `buffer` is detached (transferred). */
  redact(
    buffer: ArrayBuffer,
    pageRedactions: PageRedactions,
    options: { onProgress?: (progress: number) => void } = {},
  ): Promise<RedactJobResult> {
    if (this.job) {
      return Promise.reject(new Error('A redaction job is already running.'));
    }
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<RedactJobResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new RedactJobError('timeout', 'Redaction took too long and was stopped.'), true);
      }, this.timeoutMs);
      this.job = { id, resolve, reject, onProgress: options.onProgress, timer };
      const request: WorkerRequest = { type: 'redact', jobId: id, buffer, pageRedactions };
      worker.postMessage(request, [buffer]);
    });
  }

  /** Stop the running job (if any). */
  cancel(): void {
    if (this.job) this.fail(new RedactJobError('cancelled', 'Redaction was cancelled.'), true);
  }

  /** Release the worker. Any running job is rejected. */
  terminate(): void {
    if (this.job) this.fail(new RedactJobError('cancelled', 'Redaction worker was stopped.'), true);
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail(
        new RedactJobError('crashed', event.message || 'The redaction worker crashed.'),
        true,
      );
    };
    worker.onmessageerror = () => {
      this.fail(
        new RedactJobError('crashed', 'The redaction worker sent an unreadable message.'),
        true,
      );
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(msg: WorkerResponse): void {
    const job = this.job;
    if (!job || msg.jobId !== job.id) return; // stale message from a cancelled job
    if (msg.type === 'progress') {
      job.onProgress?.(msg.progress);
      return;
    }
    clearTimeout(job.timer);
    this.job = null;
    if (msg.type === 'redact-result') {
      job.resolve({ bytes: new Uint8Array(msg.bytes), report: msg.report });
    } else {
      job.reject(new RedactJobError(msg.code ?? 'crashed', msg.message));
    }
  }

  /** Reject the current job; optionally kill the worker so it cannot linger. */
  private fail(error: Error, killWorker: boolean): void {
    const job = this.job;
    this.job = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    if (killWorker) {
      this.worker?.terminate();
      this.worker = null;
    }
  }
}
