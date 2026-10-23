import { expect, test } from '@playwright/test';

test.describe('Navigation', () => {
  test('landing page leads to the redaction workspace', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PrivateRedact/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Redact PDFs.');

    await page.getByRole('link', { name: 'Start redacting' }).click();
    await expect(page).toHaveURL(/\/redact$/);
    await expect(page.getByRole('heading', { name: 'Choose your documents' })).toBeVisible();
  });

  test('header links reach the privacy page and back home', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();

    await nav.getByRole('link', { name: /PrivateRedact home/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Start redacting' })).toBeVisible();
  });

  test('support page links out to GitHub Sponsors without loading anything from it', async ({
    page,
  }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (!new URL(req.url()).origin.startsWith('http://localhost')) external.push(req.url());
    });
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Support' })
      .click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Support the project' }),
    ).toBeVisible();

    const sponsor = page.getByRole('link', { name: 'Sponsor on GitHub' });
    await expect(sponsor).toHaveAttribute('href', /^https:\/\/github\.com\/sponsors\//);
    await expect(sponsor).toHaveAttribute('target', '_blank');
    await expect(sponsor).toHaveAttribute('rel', /noopener/);
    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
  });

  test('unknown routes show the not-found page', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('landing page never loads the PDF engine', async ({ page }) => {
    const heavy: string[] = [];
    page.on('request', (req) => {
      if (/pdfjs-dist|fabric|pdf-lib|pdf\.worker/i.test(req.url())) heavy.push(req.url());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(heavy).toEqual([]);
  });
});
