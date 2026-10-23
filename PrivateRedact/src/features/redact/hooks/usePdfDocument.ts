import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isPasswordError, openPdf } from '@/features/redact/lib/pdf';

interface LoadState {
  file: File | null;
  doc: PDFDocumentProxy | null;
  error: string | null;
}

/**
 * Parse a File with PDF.js ONCE and keep the proxy for as long as the file
 * is displayed. Zooming, resizing and page changes reuse the same proxy
 * instead of re-reading and re-parsing the whole document.
 */
export function usePdfDocument(file: File | undefined): {
  doc: PDFDocumentProxy | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<LoadState>({ file: null, doc: null, error: null });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let task: Awaited<ReturnType<typeof openPdf>> | null = null;

    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        task = await openPdf(data);
        if (cancelled) {
          void task.destroy();
          return;
        }
        const doc = await task.promise;
        if (!cancelled) setState({ file, doc, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = isPasswordError(err)
          ? 'This PDF is password-protected. Remove the password first, then upload the unprotected copy.'
          : err instanceof Error
            ? `This PDF could not be opened: ${err.message}`
            : 'This PDF could not be opened.';
        setState({ file, doc: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [file]);

  const current = state.file === file;
  return {
    doc: current ? state.doc : null,
    loading: Boolean(file) && !current,
    error: current ? state.error : null,
  };
}
