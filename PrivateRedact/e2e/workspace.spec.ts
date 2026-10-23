import { expect, test } from '@playwright/test';
import {
  applyButton,
  clickAt,
  drawBox,
  expectBoxCount,
  openWorkspace,
  queuePanel,
  toolbar,
  toolButton,
  waitForPageRender,
} from './support/app';
import {
  boxFor,
  fakeEncryptedPdf,
  PAGE2_LINE,
  pdfFile,
  PUBLIC_LINE,
  samplePdf,
  SECRET_LINE,
  twoPagePdf,
} from './support/pdf';

test.describe('Workspace: viewing', () => {
  test('renders the first page with the box tool active', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));

    await expect(toolButton(page, 'Box')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel(/Page number/)).toHaveValue('1');
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(applyButton(page)).toBeDisabled();
    await expectBoxCount(page, 0);

    // The PDF.js text layer carries the page's text for the text tool.
    await expect(page.locator('.text-layer')).toContainText(SECRET_LINE.text);
  });

  test('navigates between pages with buttons, input and keyboard', async ({ page }) => {
    await openWorkspace(page, pdfFile('two.pdf', await twoPagePdf()));
    const pageInput = page.getByLabel(/Page number, 1 to 2/);

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(pageInput).toHaveValue('2');
    await waitForPageRender(page);
    await expect(page.locator('.text-layer')).toContainText(PAGE2_LINE.text);
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(pageInput).toHaveValue('1');

    await pageInput.fill('2');
    await pageInput.press('Enter');
    await expect(pageInput).toHaveValue('2');

    await page.getByTestId('pdf-page').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('PageUp');
    await expect(pageInput).toHaveValue('1');
    await page.keyboard.press('PageDown');
    await expect(pageInput).toHaveValue('2');
  });

  test('zoom controls resize the page', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    const pdfPage = page.getByTestId('pdf-page');
    const start = await pdfPage.boundingBox();
    const percent = toolbar(page).getByText(/^\d+%$/);
    const startPercent = await percent.textContent();

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(percent).not.toHaveText(startPercent ?? '');
    await expect
      .poll(async () => (await pdfPage.boundingBox())?.width ?? 0)
      .toBeGreaterThan(start?.width ?? 0);

    await page.getByRole('button', { name: 'Fit page' }).click();
    await expect(percent).toHaveText(startPercent ?? '');

    await page.getByRole('button', { name: 'Fit width' }).click();
    await expect
      .poll(async () => (await pdfPage.boundingBox())?.width ?? 0)
      .toBeGreaterThan(start?.width ?? 0);
  });

  test('keyboard shortcuts switch tools', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    await page.getByTestId('pdf-page').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('v');
    await expect(toolButton(page, 'Select')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('t');
    await expect(toolButton(page, 'Text')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('r');
    await expect(toolButton(page, 'Box')).toHaveAttribute('aria-pressed', 'true');
  });

  test('encrypted documents are view-only', async ({ page }) => {
    await openWorkspace(page, pdfFile('locked.pdf', await fakeEncryptedPdf()));
    await expect(page.getByRole('alert')).toContainText('This PDF is encrypted');
    await expect(applyButton(page)).toBeDisabled();
    await expect(page.getByTestId('redaction-overlay')).toHaveCSS('pointer-events', 'none');
  });
});

test.describe('Workspace: drawing boxes', () => {
  test('draws, undoes, redoes and clears boxes', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));

    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 1);
    await expect(queuePanel(page)).toContainText('1 box on 1 page');
    await expect(applyButton(page)).toBeEnabled();

    await drawBox(page, boxFor(PUBLIC_LINE));
    await expectBoxCount(page, 2);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expectBoxCount(page, 1);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expectBoxCount(page, 2);

    await page.getByTestId('pdf-page').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expectBoxCount(page, 1);
    await page.keyboard.press('Control+y');
    await expectBoxCount(page, 2);

    // Clearing asks for confirmation: dismissing keeps the boxes, accepting removes them.
    page.once('dialog', (d) => void d.dismiss());
    await page.getByRole('button', { name: 'Clear boxes on page 1' }).click();
    await expectBoxCount(page, 2);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Clear boxes on page 1' }).click();
    await expectBoxCount(page, 0);
    await expect(applyButton(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Clear boxes on page 1' })).toBeDisabled();
  });

  test('tiny drags do not create boxes', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    await drawBox(page, { x: 300, y: 300, width: 0.5, height: 0.5 });
    await expectBoxCount(page, 0);
  });

  test('select tool deletes a box with the keyboard', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    const box = boxFor(SECRET_LINE);
    await drawBox(page, box);
    await expectBoxCount(page, 1);

    await toolButton(page, 'Select').click();
    await clickAt(page, box);
    await page.keyboard.press('Delete');
    await expectBoxCount(page, 0);
  });

  test('boxes are kept per page', async ({ page }) => {
    await openWorkspace(page, pdfFile('two.pdf', await twoPagePdf()));
    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 1);

    await page.getByRole('button', { name: 'Next page' }).click();
    await waitForPageRender(page);
    await expect(page.getByRole('button', { name: 'Clear boxes on page 2' })).toBeDisabled();
    await drawBox(page, boxFor(PAGE2_LINE));
    await expectBoxCount(page, 2);
    await expect(queuePanel(page)).toContainText('2 boxes on 2 pages');

    await page.getByRole('button', { name: 'Previous page' }).click();
    await waitForPageRender(page);
    await expect(page.getByRole('button', { name: 'Clear boxes on page 1' })).toBeEnabled();
    await expectBoxCount(page, 2);
  });

  test('text tool turns a text selection into a box', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    await toolButton(page, 'Text').click();

    const span = page.locator('.text-layer span').filter({ hasText: SECRET_LINE.text }).first();
    const b = await span.boundingBox();
    if (!b) throw new Error('text span not visible');
    const cy = b.y + b.height / 2;
    await page.mouse.move(b.x + 1, cy);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 1, cy, { steps: 8 });
    await page.mouse.up();

    await expectBoxCount(page, 1);
  });
});

test.describe('Workspace: document queue', () => {
  test('switches, adds and removes documents', async ({ page }) => {
    const bytes = await samplePdf();
    await openWorkspace(page, [pdfFile('a.pdf', bytes), pdfFile('b.pdf', await twoPagePdf())]);
    const panel = queuePanel(page);
    await expect(panel.getByRole('button', { name: /^a\.pdf/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 1, 1);

    await panel.getByRole('button', { name: /^b\.pdf/ }).click();
    await waitForPageRender(page);
    await expect(page.getByLabel(/Page number, 1 to 2/)).toBeVisible();
    await drawBox(page, boxFor(PUBLIC_LINE));
    await expectBoxCount(page, 2, 2);

    // Add a third document through the panel's hidden file input.
    await panel.locator('input[type=file]').setInputFiles(pdfFile('c.pdf', bytes));
    await expect(panel.getByRole('button', { name: /^c\.pdf/ })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Documents/ })).toContainText('3');

    // Adding a duplicate surfaces a notice instead of a second entry.
    await panel.locator('input[type=file]').setInputFiles(pdfFile('c.pdf', bytes));
    await expect(
      page.getByRole('status').filter({ hasText: 'already in the queue' }),
    ).toBeVisible();

    // Removing a document with boxes asks for confirmation.
    page.once('dialog', (d) => void d.accept());
    await panel.getByRole('button', { name: 'Remove a.pdf' }).click();
    await expect(panel.getByRole('button', { name: /^a\.pdf/ })).toBeHidden();
    await expectBoxCount(page, 1, 1);
  });

  test('start over returns to an empty upload step', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    await queuePanel(page).getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeDisabled();
  });
});
