import { chromium, type FullConfig } from '@playwright/test';
import { pdfFile, samplePdf } from './support/pdf';

/**
 * Warm the dev server before the suite runs. Vite discovers the heavy
 * /redact dependencies (PDF.js, Fabric, pdf-lib) lazily and reloads the page
 * once it has pre-bundled them, which would interrupt whichever test happened
 * to run first. Opening the workspace once here absorbs that reload.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${baseURL}/redact`, { waitUntil: 'networkidle' });
    await page
      .getByLabel('Choose PDF files')
      .setInputFiles(pdfFile('warmup.pdf', await samplePdf()));
    await page.getByRole('button', { name: 'Open workspace' }).click();
    await page.getByTestId('redaction-overlay').waitFor({ timeout: 120_000 });
    await page.waitForLoadState('networkidle');
  } finally {
    await browser.close();
  }
}
