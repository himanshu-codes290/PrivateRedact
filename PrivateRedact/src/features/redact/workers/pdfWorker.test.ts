import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyReport } from '@/features/redact/engine/types';
import { PdfProcessorClient, RedactJobError } from './pdfWorker';
import type { WorkerRequest, WorkerResponse } from './pdfWorkerProtocol';

/** Minimal Worker stand-in driven by the test. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  sent: WorkerRequest[] = [];

  postMessage(msg: WorkerRequest) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: WorkerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
}

function setup(timeoutMs = 10_000) {
  const workers: FakeWorker[] = [];
  const client = new PdfProcessorClient({
    timeoutMs,
    factory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { client, workers };
}

afterEach(() => vi.useRealTimers());

describe('PdfProcessorClient', () => {
  it('routes progress and results by job id', async () => {
    const { client, workers } = setup();
    const progress: number[] = [];
    const job = client.redact(new ArrayBuffer(4), [], { onProgress: (p) => progress.push(p) });
    const w = workers[0]!;
    const { jobId } = w.sent[0]!;
    w.reply({ type: 'progress', jobId: jobId + 99, progress: 0.9 }); // stale: ignored
    w.reply({ type: 'progress', jobId, progress: 0.5 });
    w.reply({
      type: 'redact-result',
      jobId,
      bytes: Uint8Array.of(7).buffer,
      report: emptyReport(),
    });
    const result = await job;
    expect(progress).toEqual([0.5]);
    expect(Array.from(result.bytes)).toEqual([7]);
  });

  it('rejects a second concurrent job instead of clobbering the first', async () => {
    const { client } = setup();
    void client.redact(new ArrayBuffer(1), []);
    await expect(client.redact(new ArrayBuffer(1), [])).rejects.toThrow(/already running/);
  });

  it('forwards typed engine errors', async () => {
    const { client, workers } = setup();
    const job = client.redact(new ArrayBuffer(1), []);
    const w = workers[0]!;
    w.reply({
      type: 'redact-error',
      jobId: w.sent[0]!.jobId,
      message: 'locked',
      code: 'encrypted',
    });
    await expect(job).rejects.toMatchObject({ code: 'encrypted', message: 'locked' });
  });

  it('cancel() terminates the worker and a new one is created next time', async () => {
    const { client, workers } = setup();
    const job = client.redact(new ArrayBuffer(1), []);
    client.cancel();
    await expect(job).rejects.toBeInstanceOf(RedactJobError);
    await expect(job).rejects.toMatchObject({ code: 'cancelled' });
    expect(workers[0]!.terminated).toBe(true);
    void client.redact(new ArrayBuffer(1), []);
    expect(workers).toHaveLength(2);
  });

  it('times out runaway jobs', async () => {
    vi.useFakeTimers();
    const { client, workers } = setup(1000);
    const job = client.redact(new ArrayBuffer(1), []);
    const assertion = expect(job).rejects.toMatchObject({ code: 'timeout' });
    vi.advanceTimersByTime(1001);
    await assertion;
    expect(workers[0]!.terminated).toBe(true);
  });

  it('discards a crashed worker', async () => {
    const { client, workers } = setup();
    const job = client.redact(new ArrayBuffer(1), []);
    workers[0]!.onerror?.({ message: 'boom', preventDefault() {} } as ErrorEvent);
    await expect(job).rejects.toMatchObject({ code: 'crashed', message: 'boom' });
    expect(workers[0]!.terminated).toBe(true);
    expect(client.busy).toBe(false);
  });
});
