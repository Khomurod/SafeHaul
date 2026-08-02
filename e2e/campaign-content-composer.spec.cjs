// E2E coverage for the ContentComposer design-system migration. Opens the
// CampaignEditor via Create Campaign (e2eCampaign=mock) and navigates to the
// Content section (lazy-loaded), then verifies the channel toggle + selected
// state, the labelled Subject/Message fields, variable insertion at the caret,
// the accessible character count, responsive overflow at 1440/1024/412, and an
// axe pass scoped to the composer.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openComposer(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Create Campaign/i }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign Name' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Content/ }).click();
  await expect(page.getByRole('heading', { name: 'Content Strategy' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Campaign content composer slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes an accessible channel toggle and conditional subject', async ({ page }) => {
    await openComposer(page);

    const group = page.getByRole('group', { name: 'Message channel' });
    await expect(group).toBeVisible();
    const email = page.getByRole('button', { name: 'Email' });
    await expect(page.getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
    await expect(email).toHaveAttribute('aria-pressed', 'false');

    // SMS mode has no subject; switching to Email reveals it.
    await expect(page.getByLabel('Subject Line')).toHaveCount(0);
    await email.click();
    await expect(email).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Subject Line')).toBeVisible();
  });

  test('inserts a variable at the caret in the message body', async ({ page }) => {
    await openComposer(page);

    const message = page.getByLabel('Message Body');
    await message.fill('Hi');
    await page.getByRole('button', { name: 'Insert Driver Name placeholder' }).click();
    await expect(message).toHaveValue('Hi [Driver Name] ');

    // The character count reflects the message length.
    await expect(page.getByText(/chars$/)).toBeVisible();
  });

  test('keeps the document within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openComposer(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without document-level horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openComposer(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the composer', async ({ page }) => {
    await openComposer(page);
    // Scope to the composer content region (max-w-4xl wrapper).
    const { violations } = await new AxeBuilder({ page }).include('.max-w-4xl').analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
