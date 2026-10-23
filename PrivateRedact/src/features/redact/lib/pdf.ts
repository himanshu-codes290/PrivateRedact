import type * as PdfjsModule from 'pdfjs-dist';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

/**
 * Lazy PDF.js access.
 *
 * PDF.js (≈400 KB) and its worker (≈1.2 MB) are only needed on the
 * redaction route, so they are loaded on first use instead of at import
 * time. The worker is a module-level singleton shared by every document
 * and torn down with `releasePdfjs()` when the workspace unmounts.
 */
type Pdfjs = typeof PdfjsModule;

let pdfjsPromise: Promise<Pdfjs> | null = null;
let workerPort: Worker | null = null;

export function getPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, { default: PdfJsWorker }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs?worker'),
    ]);
    if (!workerPort) {
      workerPort = new PdfJsWorker();
      pdfjs.GlobalWorkerOptions.workerPort = workerPort;
    }
    return pdfjs;
  })();
  return pdfjsPromise;
}

/** Terminate the shared PDF.js worker (it is recreated on next use). */
export function releasePdfjs(): void {
  workerPort?.terminate();
  workerPort = null;
  if (pdfjsPromise) {
    void pdfjsPromise.then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerPort = null;
    });
  }
  pdfjsPromise = null;
}

/** Same-origin URLs for PDF.js runtime assets (see build-plugins/pdfjsAssets.ts). */
function assetUrl(dir: string): string {
  return `${import.meta.env.BASE_URL}pdfjs/${dir}/`;
}

/** Open a PDF from bytes with the app's standard PDF.js options. */
export async function openPdf(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({
    data,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    // Never execute document JavaScript or render XFA: display only.
    enableXfa: false,
  });
}

export function isPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException';
}
