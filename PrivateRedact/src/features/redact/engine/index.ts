/**
 * Public surface of the redaction engine.
 *
 * The engine depends only on pdf-lib (no DOM, no PDF.js), so it runs
 * unchanged inside the Web Worker and inside Node for tests.
 */
export { redactPdf } from './redactPdf';
export type { PdfRect, Box, Matrix } from './geometry';
export {
  RedactionError,
  type PageRedactions,
  type RedactPdfOptions,
  type RedactPdfResult,
  type RedactReport,
  type RedactionErrorCode,
  type RedactionWarning,
  type WarningCode,
} from './types';
