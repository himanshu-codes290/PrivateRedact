import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PAGE_H, PAGE_W, type FilePayload, type PdfRect } from './pdf';

export async function gotoUpload(page: Page): Promise<void> {
  await page.goto('/redact');
  await expect(page.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
}

export async function addFiles(page: Page, files: FilePayload | FilePayload[]): Promise<void> {
  await page.getByLabel('Choose PDF files').setInputFiles(files);
}

/** Wait until the current page is rendered and the drawing overlay is live. */
export async function waitForPageRender(page: Page): Promise<void> {
  await expect(page.getByTestId('pdf-page')).toBeVisible();
  await expect(page.getByText(/Rendering page \d+/)).toBeHidden();
  await expect(
    page.getByTestId('redaction-overlay').locator('canvas.upper-canvas').last(),
  ).toBeVisible();
}

/** Go to /redact, queue the files and open the workspace. */
export async function openWorkspace(page: Page, files: FilePayload | FilePayload[]): Promise<void> {
  await gotoUpload(page);
  await addFiles(page, files);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await waitForPageRender(page);
}

export const toolbar = (page: Page): Locator =>
  page.getByRole('toolbar', { name: 'Redaction tools' });
export const toolButton = (page: Page, name: 'Select' | 'Box' | 'Text'): Locator =>
  page.getByRole('group', { name: 'Tool' }).getByRole('button', { name, exact: true });
export const queuePanel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Document queue' });
export const statusBar = (page: Page): Locator => page.getByTestId('workspace-status');
export const applyButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Apply redactions' });
export const confirmDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Apply redactions' });

export async function expectBoxCount(page: Page, boxes: number, files = 1): Promise<void> {
  if (boxes === 0) {
    await expect(statusBar(page)).toContainText('Draw boxes over anything you want removed');
    return;
  }
  await expect(statusBar(page)).toContainText(
    `${boxes} box${boxes === 1 ? '' : 'es'} across ${files} file${files === 1 ? '' : 's'}`,
  );
}

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Map a PDF-space rectangle onto the overlay's screen pixels. */
export async function toScreen(page: Page, rect: PdfRect): Promise<ScreenRect> {
  const overlay = page.getByTestId('redaction-overlay');
  const box = await overlay.boundingBox();
  if (!box) throw new Error('Overlay is not visible');
  const s = box.width / PAGE_W;
  return {
    x: box.x + rect.x * s,
    y: box.y + (PAGE_H - rect.y - rect.height) * s,
    width: rect.width * s,
    height: rect.height * s,
  };
}

/** Drag out a redaction box with the Box tool. `rect` is in PDF points. */
export async function drawBox(page: Page, rect: PdfRect): Promise<void> {
  await toolButton(page, 'Box').click();
  const r = await toScreen(page, rect);
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 4 });
  await page.mouse.move(r.x + r.width, r.y + r.height, { steps: 6 });
  await page.mouse.up();
}

/** Click the centre of a rectangle (in PDF points) on the overlay. */
export async function clickAt(page: Page, rect: PdfRect): Promise<void> {
  const r = await toScreen(page, rect);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

export async function downloadFrom(page: Page, trigger: Locator): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger.click()]);
  return download;
}

export async function downloadBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(await readFile(path));
}
