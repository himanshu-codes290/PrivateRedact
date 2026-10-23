/**
 * Validation for files entering the redaction queue.
 *
 * MIME types and extensions are trivially spoofed, so every file is also
 * checked for the `%PDF-` signature. Encrypted PDFs are detected up front:
 * PDF.js may still display them, but the redaction engine cannot rewrite
 * them, so the user is told before spending time drawing boxes.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 20;

export interface QueuedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  /** The file declares an /Encrypt dictionary: viewable, not redactable. */
  encrypted: boolean;
}

export interface IntakeResult {
  accepted: QueuedFile[];
  errors: string[];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ENCRYPT = Array.from('/Encrypt', (c) => c.charCodeAt(0));

function indexOf(hay: Uint8Array, needle: readonly number[], from = 0, to = hay.length): number {
  outer: for (let i = from; i + needle.length <= to; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

async function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Inspect a file's bytes: is it a PDF, and is it encrypted? */
export async function inspectPdf(file: Blob): Promise<{ isPdf: boolean; encrypted: boolean }> {
  // The spec allows junk before the header; readers accept it within 1 KB.
  const head = await readBytes(file.slice(0, 1024));
  if (indexOf(head, PDF_MAGIC) < 0) return { isPdf: false, encrypted: false };
  // /Encrypt lives in the trailer (or the xref stream dictionary), which is
  // never compressed — scanning the tail and the head covers both layouts.
  const tailStart = Math.max(0, file.size - 64 * 1024);
  const tail = await readBytes(file.slice(tailStart));
  let encrypted = indexOf(tail, ENCRYPT) >= 0;
  if (!encrypted && tailStart > 0) {
    const start = await readBytes(file.slice(0, Math.min(file.size, 64 * 1024)));
    encrypted = indexOf(start, ENCRYPT) >= 0;
  }
  return { isPdf: true, encrypted };
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Validate candidate files against the current queue. Returns the files to
 * add and human-readable reasons for everything rejected.
 */
export async function intakeFiles(
  candidates: readonly File[],
  existing: readonly QueuedFile[],
): Promise<IntakeResult> {
  const accepted: QueuedFile[] = [];
  const errors: string[] = [];
  let count = existing.length;
  let total = existing.reduce((n, f) => n + f.size, 0);
  const seen = new Set(existing.map((f) => `${f.name}:${f.size}`));

  for (const file of candidates) {
    const key = `${file.name}:${file.size}`;
    if (seen.has(key)) {
      errors.push(`${file.name} is already in the queue.`);
      continue;
    }
    if (file.size === 0) {
      errors.push(`${file.name} is empty.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`);
      continue;
    }
    if (count >= MAX_FILES) {
      errors.push(`${file.name} was not added: the queue is limited to ${MAX_FILES} files.`);
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      errors.push(
        `${file.name} was not added: the queue is limited to ${formatBytes(MAX_TOTAL_BYTES)} in total.`,
      );
      continue;
    }
    const { isPdf, encrypted } = await inspectPdf(file);
    if (!isPdf) {
      errors.push(`${file.name} is not a PDF document.`);
      continue;
    }
    accepted.push({ id: newId(), file, name: file.name, size: file.size, encrypted });
    seen.add(key);
    count++;
    total += file.size;
  }
  return { accepted, errors };
}
