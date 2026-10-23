import { expect, test } from '@playwright/test';
import {
  applyButton,
  confirmDialog,
  continueToResults,
  downloadBytes,
  downloadFrom,
  drawBox,
  expectBoxCount,
  openWorkspace,
  queuePanel,
  supportDialog,
  waitForPageRender,
} from './support/app';
import {
  boxFor,
  extractText,
  PAGE2_LINE,
  pdfFile,
  PUBLIC_LINE,
  samplePdf,
  SECRET_LINE,
  twoPagePdf,
  unzip,
} from './support/pdf';

test.describe('Redaction pipeline', () => {
  test('removes the text under a box and leaves the rest', async ({ page }) => {
    await openWorkspace(page, pdfFile('report.pdf', await samplePdf()));
    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 1);

    await applyButton(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('report.pdf');
    await expect(dialog).toContainText('1 of 1');
    await expect(dialog).toContainText('1 box on 1 page will be applied');
    await expect(dialog.getByRole('button', { name: /Apply to all/ })).toBeHidden();

    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

    // A thank-you card covers the results first. Its sponsor link is a plain
    // outbound link; Continue reveals the files.
    const card = supportDialog(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 file redacted on your device');
    const sponsor = card.getByRole('link', { name: 'Sponsor on GitHub' });
    expect(await sponsor.getAttribute('href')).toContain('https://github.com/sponsors/');
    await expect(sponsor).toHaveAttribute('target', '_blank');
    await continueToResults(page, 1);
    const row = page.getByRole('listitem').filter({ hasText: 'report_redacted.pdf' });
    await expect(row).toContainText('Verified');
    await expect(row).toContainText(`${SECRET_LINE.text.length} characters removed`);
    await expect(page.getByRole('alert')).toBeHidden();

    const download = await downloadFrom(page, row.getByRole('link', { name: 'Download' }));
    expect(download.suggestedFilename()).toBe('report_redacted.pdf');
    const pages = await extractText(await downloadBytes(download));
    expect(pages).toHaveLength(1);
    expect(pages[0]).not.toContain(SECRET_LINE.text);
    expect(pages[0]).not.toContain('SECRET');
    expect(pages[0]).toContain(PUBLIC_LINE.text);
  });

  test('the original bytes stay intact after redaction', async ({ page }) => {
    const original = await samplePdf();
    await openWorkspace(page, pdfFile('doc.pdf', original));
    await drawBox(page, boxFor(SECRET_LINE));
    await applyButton(page).click();
    await confirmDialog(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await continueToResults(page, 1);

    const row = page.getByRole('listitem').filter({ hasText: 'doc_redacted.pdf' });
    const bytes = await downloadBytes(
      await downloadFrom(page, row.getByRole('link', { name: 'Download' })),
    );
    expect(Buffer.from(bytes).equals(original)).toBe(false);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    // The fixture itself still contains the secret: only the output was changed.
    expect((await extractText(original))[0]).toContain(SECRET_LINE.text);
  });

  test('back to editing keeps the boxes', async ({ page }) => {
    await openWorkspace(page, pdfFile('doc.pdf', await samplePdf()));
    await drawBox(page, boxFor(SECRET_LINE));
    await applyButton(page).click();

    await confirmDialog(page).getByRole('button', { name: 'Back to editing' }).click();
    await expect(confirmDialog(page)).toBeHidden();
    await expectBoxCount(page, 1);

    await applyButton(page).click();
    await confirmDialog(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await continueToResults(page, 1);

    await page.getByRole('button', { name: 'Edit boxes' }).click();
    await waitForPageRender(page);
    await expectBoxCount(page, 1);
  });

  test('applies to every queued file and zips the results', async ({ page }) => {
    await openWorkspace(page, [
      pdfFile('first.pdf', await samplePdf()),
      pdfFile('second.pdf', await twoPagePdf()),
    ]);
    await drawBox(page, boxFor(SECRET_LINE));

    await queuePanel(page)
      .getByRole('button', { name: /^second\.pdf/ })
      .click();
    await waitForPageRender(page);
    await page.getByRole('button', { name: 'Next page' }).click();
    await waitForPageRender(page);
    await drawBox(page, boxFor(PAGE2_LINE));
    await expectBoxCount(page, 2, 2);

    await applyButton(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('1 of 2');
    await dialog.getByRole('button', { name: 'Apply to all 2' }).click();

    await continueToResults(page, 2);
    await expect(page.getByText('first_redacted.pdf')).toBeVisible();
    await expect(page.getByText('second_redacted.pdf')).toBeVisible();
    await expect(page.getByText('Verified')).toHaveCount(2);

    const zip = await downloadFrom(page, page.getByRole('button', { name: 'Download all (.zip)' }));
    expect(zip.suggestedFilename()).toBe('redacted-documents.zip');
    const entries = unzip(await downloadBytes(zip));
    expect(Object.keys(entries).sort()).toEqual(['first_redacted.pdf', 'second_redacted.pdf']);

    const second = await extractText(entries['second_redacted.pdf']!);
    expect(second).toHaveLength(2);
    expect(second[0]).toContain(SECRET_LINE.text); // untouched page
    expect(second[1]).not.toContain(PAGE2_LINE.text);
  });

  test('skips a file and lists it as not included', async ({ page }) => {
    const bytes = await samplePdf();
    await openWorkspace(page, [pdfFile('keep.pdf', bytes), pdfFile('skip.pdf', bytes)]);
    await drawBox(page, boxFor(SECRET_LINE));
    await queuePanel(page)
      .getByRole('button', { name: /^skip\.pdf/ })
      .click();
    await waitForPageRender(page);
    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 2, 2);

    await applyButton(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('keep.pdf');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

    // After the first file the dialog stops to ask about the next one.
    await expect(dialog).toContainText('skip.pdf');
    await expect(dialog).toContainText('2 of 2');
    await dialog.getByRole('button', { name: 'Skip file' }).click();

    await continueToResults(page, 1);
    await expect(page.getByText('keep_redacted.pdf')).toBeVisible();
    await expect(page.getByText('Not included (skipped or no boxes): skip.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download all (.zip)' })).toBeHidden();
  });

  test('files without boxes are left out of the run', async ({ page }) => {
    const bytes = await samplePdf();
    await openWorkspace(page, [pdfFile('marked.pdf', bytes), pdfFile('untouched.pdf', bytes)]);
    await drawBox(page, boxFor(SECRET_LINE));
    await expectBoxCount(page, 1, 1);

    await applyButton(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('1 of 1');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();

    await continueToResults(page, 1);
    await expect(page.getByText('Not included (skipped or no boxes): untouched.pdf')).toBeVisible();

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
  });
});
