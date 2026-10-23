import type { PdfRect } from './geometry';

/** `pageRedactions[i]` = rects for page i (index 0 = page 1). */
export type PageRedactions = readonly (readonly PdfRect[] | undefined)[];

export interface RedactPdfOptions {
  /** Progress callback, 0..1 across load → pages → sanitize → save. */
  onProgress?: (progress: number) => void;
}

export type WarningCode =
  /** A page had boxes but nothing removable was found under them. */
  | 'nothing-removed'
  /** An image is only partly under a box: covered, but still in the file. */
  | 'image-partial'
  /** Glyph widths had to be estimated (font without usable metrics). */
  | 'metrics-estimated'
  /** Vertical (top-to-bottom) text: glyph boxes are approximated. */
  | 'vertical-text'
  /** A Form XObject could not be inspected; it was removed to fail closed. */
  | 'xobject-removed'
  /** Interactive form could not be flattened; fields were removed instead. */
  | 'form-not-flattened';

export interface RedactionWarning {
  code: WarningCode;
  /** 1-based page number, when the warning is page specific. */
  page?: number;
  /** `info` = transparency note; `warning` = the user should look. */
  severity: 'info' | 'warning';
  message: string;
}

/** What the engine actually did. Surfaced on the download page. */
export interface RedactReport {
  pagesProcessed: number;
  rectsBurned: number;
  /** Individual glyphs removed from text-showing operators. */
  glyphsRemoved: number;
  /** Text-showing operators rewritten (each may lose one or more glyphs). */
  textOpsRewritten: number;
  imagesRemoved: number;
  annotationsRemoved: number;
  formXObjectsRewritten: number;
  formFlattened: boolean;
  /** Document-level items scrubbed (metadata, outlines, attachments, …). */
  documentItemsRemoved: string[];
  /** Objects dropped by the final garbage collection pass. */
  orphanObjectsRemoved: number;
  warnings: RedactionWarning[];
}

export interface RedactPdfResult {
  bytes: Uint8Array;
  report: RedactReport;
}

export type RedactionErrorCode = 'encrypted' | 'unreadable' | 'undecodable-content';

/** Error with a machine-readable code, so the UI can show tailored help. */
export class RedactionError extends Error {
  readonly code: RedactionErrorCode;

  constructor(code: RedactionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RedactionError';
    this.code = code;
  }
}

export function emptyReport(): RedactReport {
  return {
    pagesProcessed: 0,
    rectsBurned: 0,
    glyphsRemoved: 0,
    textOpsRewritten: 0,
    imagesRemoved: 0,
    annotationsRemoved: 0,
    formXObjectsRewritten: 0,
    formFlattened: false,
    documentItemsRemoved: [],
    orphanObjectsRemoved: 0,
    warnings: [],
  };
}
