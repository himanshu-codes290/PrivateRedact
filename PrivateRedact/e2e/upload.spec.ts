import { expect, test } from '@playwright/test';
import { addFiles, gotoUpload } from './support/app';
import { fakeEncryptedPdf, notAPdf, pdfFile, samplePdf } from './support/pdf';

test.describe('Upload step', () => {
  test('cannot open the workspace without files', async ({ page }) => {
    await gotoUpload(page);
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeDisabled();
    await expect(page.getByText('Drag & drop PDFs, or click to browse')).toBeVisible();
  });

  test('queues a valid PDF and enables the workspace', async ({ page }) => {
    await gotoUpload(page);
    await addFiles(page, pdfFile('contract.pdf', await samplePdf()));

    const queue = page.getByRole('heading', { name: /^Queue/ });
    await expect(queue).toContainText('1');
    const row = page.getByRole('listitem').filter({ hasText: 'contract.pdf' });
    await expect(row).toContainText('Ready');
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeEnabled();
  });

  test('rejects files that are not PDFs', async ({ page }) => {
    await gotoUpload(page);

    // Wrong extension: rejected by the dropzone before any bytes are read.
    await addFiles(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: notAPdf() });
    await expect(page.getByRole('alert')).toContainText('notes.txt is not a PDF.');

    // Right extension, wrong bytes: rejected by the signature check.
    await addFiles(page, pdfFile('fake.pdf', notAPdf()));
    await expect(page.getByRole('alert')).toContainText('fake.pdf is not a PDF document.');
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeDisabled();

    await page.getByRole('button', { name: 'Dismiss errors' }).click();
    await expect(page.getByRole('alert')).toBeHidden();
  });

  test('refuses duplicates and empty files', async ({ page }) => {
    await gotoUpload(page);
    const bytes = await samplePdf();
    await addFiles(page, pdfFile('a.pdf', bytes));
    await addFiles(page, pdfFile('a.pdf', bytes));
    await expect(page.getByRole('alert')).toContainText('a.pdf is already in the queue.');

    await addFiles(page, pdfFile('empty.pdf', Buffer.alloc(0)));
    await expect(page.getByRole('alert')).toContainText('empty.pdf is empty.');
    await expect(page.getByRole('heading', { name: /^Queue/ })).toContainText('1');
  });

  test('removes single files and clears the queue', async ({ page }) => {
    await gotoUpload(page);
    const bytes = await samplePdf();
    await addFiles(page, [pdfFile('one.pdf', bytes), pdfFile('two.pdf', bytes)]);
    await expect(page.getByRole('heading', { name: /^Queue/ })).toContainText('2');

    await page.getByRole('button', { name: 'Remove one.pdf' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'one.pdf' })).toBeHidden();
    await expect(page.getByRole('heading', { name: /^Queue/ })).toContainText('1');

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByRole('heading', { name: /^Queue/ })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeDisabled();
  });

  test('flags encrypted PDFs before the workspace opens', async ({ page }) => {
    await gotoUpload(page);
    await addFiles(page, pdfFile('locked.pdf', await fakeEncryptedPdf()));
    const row = page.getByRole('listitem').filter({ hasText: 'locked.pdf' });
    await expect(row).toContainText('Encrypted');
    await expect(
      page.getByText(
        'Encrypted PDFs can be viewed but not redacted. Remove their protection first.',
      ),
    ).toBeVisible();
    // Viewing is still allowed.
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeEnabled();
  });
});
