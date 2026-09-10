import * as pdfjsLib from 'pdfjs-dist';
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

// Wire PDF.js to run parsing/rendering in a dedicated Web Worker
// instead of blocking the main thread. Vite bundles the worker
// as a separate chunk via the `?worker` import.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfJsWorker();

export { pdfjsLib };
