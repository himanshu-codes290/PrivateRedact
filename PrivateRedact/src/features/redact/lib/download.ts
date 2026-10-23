import { zipSync } from 'fflate';

/** `report.pdf` → `report_redacted.pdf`. */
export function redactedFileName(name: string): string {
  return `${name.replace(/\.pdf$/i, '')}_redacted.pdf`;
}

/** Wrap bytes in a PDF Blob URL. The caller must revoke it. */
export function bytesToObjectUrl(bytes: Uint8Array, type = 'application/pdf'): string {
  // Blob copies the bytes, so a subarray view never leaks its padding.
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
}

/** Programmatic download (no server, no navigation). */
export function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Make file names unique inside an archive: a.pdf, a (2).pdf, … */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

/**
 * Bundle files into a ZIP. PDFs are already compressed internally, so
 * entries are STORED (level 0): faster, and no meaningful size loss.
 */
export function buildZip(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  files.forEach((f, i) => {
    entries[names[i]!] = [f.bytes, { level: 0 }];
  });
  return zipSync(entries);
}
