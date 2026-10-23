import type { RedactReport } from '@/features/redact/engine';
import type { VerificationResult } from './verifyRedaction';

/** One redacted output file, as shown on the download page. */
export interface DownloadItem {
  fileId: string;
  name: string;
  /** Blob URL, owned (and revoked) by the workspace. */
  url: string;
  bytes: Uint8Array;
  report: RedactReport;
  verification: VerificationResult | null;
}

export type FileStatus = 'verified' | 'review' | 'failed';

/**
 * Overall status of an output file:
 *  - failed:   the independent check still extracts text from under a box
 *  - review:   the engine raised a warning, or verification could not run
 *  - verified: nothing extractable under any box, no warnings
 */
export function fileStatus(item: Pick<DownloadItem, 'report' | 'verification'>): FileStatus {
  if (item.verification && item.verification.charactersUnderBoxes > 0) return 'failed';
  if (item.report.warnings.some((w) => w.severity === 'warning')) return 'review';
  return item.verification ? 'verified' : 'review';
}
