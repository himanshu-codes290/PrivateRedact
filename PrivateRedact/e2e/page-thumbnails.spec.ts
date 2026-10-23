import { expect, test, type Page } from '@playwright/test';
import { drawBox, openWorkspace, waitForPageRender } from './support/app';
import { boxFor, pdfFile, samplePdf, SECRET_LINE, twoPagePdf } from './support/pdf';

/** The right-hand strip with one thumbnail per page. */
const pagesPanel = (page: Page) => page.getByRole('complementary', { name: 'Pages' });
const currentThumb = (page: Page) => pagesPanel(page).locator('[aria-current="page"]');

test.describe('Workspace: page thumbnails', () => {
  test('lists every page and opens the clicked one', async ({ page }) => {
    await openWorkspace(page, pdfFile('two.pdf', await twoPagePdf()));

    const panel = pagesPanel(page);
    await expect(panel.getByRole('button')).toHaveCount(2);
    await expect(currentThumb(page)).toHaveAccessibleName('Page 1');
    // Thumbnails render real page images (canvas with a backing store).
    await expect
      .poll(() =>
        panel
          .locator('canvas')
          .evaluateAll((cs) => cs.filter((c) => (c as HTMLCanvasElement).width > 0).length),
      )
      .toBe(2);

    await panel.getByRole('button', { name: 'Page 2' }).click();
    await waitForPageRender(page);
    await expect(page.getByLabel(/Page number/)).toHaveValue('2');
    await expect(currentThumb(page)).toHaveAccessibleName('Page 2');
  });

  test('follows page navigation from the toolbar and keyboard', async ({ page }) => {
    await openWorkspace(page, pdfFile('two.pdf', await twoPagePdf()));

    await page.getByRole('button', { name: 'Next page' }).click();
    await waitForPageRender(page);
    await expect(currentThumb(page)).toHaveAccessibleName('Page 2');

    await page.keyboard.press('PageUp');
    await waitForPageRender(page);
    await expect(currentThumb(page)).toHaveAccessibleName('Page 1');
  });

  test('shows a badge and a preview for pages with boxes, and updates on undo', async ({
    page,
  }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    const panel = pagesPanel(page);

    await drawBox(page, boxFor(SECRET_LINE));
    const thumb = panel.getByRole('button', { name: 'Page 1, 1 redaction box' });
    await expect(thumb).toBeVisible();
    await expect(thumb.locator('[data-redaction-preview]')).toHaveCount(1);
    await expect(panel).toContainText('Boxes on 1 page');

    await page.keyboard.press('Control+z');
    await expect(panel.getByRole('button', { name: 'Page 1', exact: true })).toBeVisible();
    await expect(panel.locator('[data-redaction-preview]')).toHaveCount(0);
  });
});
