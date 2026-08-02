// E2E coverage for the AudienceBuilder design-system migration. Opens the
// CampaignEditor via Create Campaign (e2eCampaign=mock); Audience is the default
// section. Verifies the accessible source/import tablists and their selected
// state, labelled filters, pressed status pills, the single file-input trigger,
// keyboard operation, responsive overflow at 1440/1024/412, and an axe pass
// scoped to the audience panel. Targeting/counting itself is unchanged and is
// covered by the vitest suite.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

async function openAudience(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Create Campaign/i }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign Name' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Target Audience' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Campaign audience builder slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes an accessible source tablist with labelled CRM filters', async ({ page }) => {
    await openAudience(page);

    await expect(page.getByRole('tablist', { name: 'Audience source' })).toBeVisible();
    const crm = page.getByRole('tab', { name: 'CRM Filters' });
    const upload = page.getByRole('tab', { name: /Upload List/ });
    await expect(crm).toHaveAttribute('aria-selected', 'true');
    await expect(upload).toHaveAttribute('aria-selected', 'false');

    // Every CRM filter is programmatically labelled.
    await expect(page.getByLabel('Source', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Owner', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Exclude Previously Messaged')).toBeVisible();
    await expect(page.getByLabel('Limit Volume')).toBeVisible();
  });

  test('toggles status pills with a programmatic pressed state', async ({ page }) => {
    await openAudience(page);

    const hired = page.getByRole('button', { name: 'Hired' });
    const before = await hired.getAttribute('aria-pressed');
    await hired.click();
    await expect(hired).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  });

  test('switches to the upload panel and shows one file-input trigger', async ({ page }) => {
    await openAudience(page);

    await page.getByRole('tab', { name: /Upload List/ }).click();
    await expect(page.getByRole('tab', { name: /Upload List/ })).toHaveAttribute('aria-selected', 'true');

    await expect(page.getByRole('tablist', { name: 'Import method' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
    // Upload mode defaults the exclusion window to 7 days.
    await expect(page.getByLabel('Exclude Previously Messaged')).toHaveValue('7');

    await page.getByRole('tab', { name: 'Google Sheets' }).click();
    await expect(page.getByLabel('Google Sheet URL')).toBeVisible();
  });

  test('moves the source tab with arrow keys and shows visible focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAudience(page);

    const crm = page.getByRole('tab', { name: 'CRM Filters' });
    const upload = page.getByRole('tab', { name: /Upload List/ });

    await crm.focus();
    await page.keyboard.press('ArrowRight');
    await expect(upload).toBeFocused();
    await expect(upload).toHaveAttribute('aria-selected', 'true');

    const focus = await upload.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);
  });

  test('keeps the document within the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openAudience(page);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without document-level horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openAudience(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical violations in the audience builder', async ({ page }) => {
    await openAudience(page);
    // Scope to the migrated audience surface (its max-w-6xl wrapper). The preview
    // list is now included too: VirtualLeadList was migrated in its own slice, so
    // its former low-contrast "Scanning Database..." label and 10px status pills
    // are gone. Populated-row coverage lives in campaign-lead-preview.spec.cjs.
    const { violations } = await new AxeBuilder({ page })
      .include('.max-w-6xl')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
  });
});
