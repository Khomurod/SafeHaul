const { test, expect } = require('@playwright/test');

test.describe('E-Doc recruiter send flow', () => {
  test.describe.configure({ timeout: 60_000 });

  test('company admin sends template and lands in signer handoff route', async ({ page }) => {
    await page.goto('/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock');

    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible({ timeout: 20_000 });
    // The Documents workspace views are an ARIA tab interface, and each template's
    // actions carry the template title so they are uniquely addressable. The
    // send flow itself is unchanged — only these selectors moved.
    await page.getByRole('tab', { name: /^Templates/ }).click();

    await expect(page.getByText('E2E Test Document')).toBeVisible();
    await page.getByRole('button', { name: 'Send E2E Test Document' }).click();

    // The send is now a guided three-step flow: recipient, document details,
    // then delivery and review. The send itself — the write, the callable and
    // the handoff route below — is unchanged.
    const dialog = page.getByRole('dialog', { name: 'Send Document' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/Recipient name/).fill('Taylor Recruiter');
    await dialog.getByLabel('Email address').fill('taylor@example.com');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await expect(dialog.getByText('Step 3 of 3: Delivery and review')).toBeVisible();
    await dialog.getByRole('button', { name: /Send Document/i }).click();

    await expect(page).toHaveURL(/\/sign\/e2e-company\/e2e-edoc-send-req\?token=.*e2eSign=mock/);
    await expect(page.getByText('E2E Test Document')).toBeVisible({ timeout: 20_000 });
  });
});
