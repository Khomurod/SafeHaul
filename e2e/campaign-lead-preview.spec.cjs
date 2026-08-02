// E2E coverage for the VirtualLeadList (recipient preview) design-system
// migration. The list mounts inside the CampaignEditor's Audience section, so
// the flow opens the editor via Create Campaign (e2eCampaign=mock). The
// `getFilteredLeadsPage` callable is intercepted at the network layer so the
// real remote path (callable + filter mapping + pagination) runs unchanged
// against deterministic fixtures — artificial names and fictional 555-01xx
// contacts only, never real recipient data.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock';

const row = (id, over = {}) => ({
  id,
  firstName: 'Artificial',
  lastName: id.toUpperCase(),
  phone: '555-0100',
  status: 'new',
  ...over,
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Intercepts the callable and answers with a fixed page (or a failure). */
async function stubLeadsCallable(page, { leads = [], lastDocId = null, fail = false } = {}) {
  await page.route('**/getFilteredLeadsPage**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    if (fail) {
      return route.fulfill({
        status: 500,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { status: 'INTERNAL', message: 'stubbed failure' } }),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ result: { leads, lastDocId } }),
    });
  });
}

async function openAudience(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Create Campaign/i }).click();
  await expect(page.getByRole('heading', { name: 'Target Audience' })).toBeVisible({ timeout: 20_000 });
}

test.describe('Campaign lead preview slice', () => {
  test.describe.configure({ timeout: 90_000 });

  test('renders recipient rows as toggle buttons with readable status badges', async ({ page }) => {
    await stubLeadsCallable(page, { leads: [row('l1'), row('l2', { status: 'hired' })] });
    await openAudience(page);

    const first = page.getByRole('button', { name: /Artificial L1/ });
    await expect(first).toBeVisible({ timeout: 20_000 });
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    // Status is a readable badge, not 10px text.
    await expect(page.getByText('new', { exact: true })).toBeVisible();
    await expect(page.getByText('hired', { exact: true })).toBeVisible();
    const fontSize = await page.getByText('hired', { exact: true }).evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test('toggles a row from the keyboard and reflects the pressed state', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await stubLeadsCallable(page, { leads: [row('l1')] });
    await openAudience(page);

    const first = page.getByRole('button', { name: /Artificial L1/ });
    await expect(first).toBeVisible({ timeout: 20_000 });

    // Focus must arrive via the keyboard for :focus-visible to apply.
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    const focus = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return { boxShadow: s.boxShadow, outline: s.outlineStyle };
    });
    expect(focus.boxShadow !== 'none' || focus.outline !== 'none').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Artificial L1/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Excluded from this campaign')).toBeAttached();
  });

  test('shows an accessible empty state when no leads match', async ({ page }) => {
    await stubLeadsCallable(page, { leads: [] });
    await openAudience(page);

    const status = page.getByRole('status').filter({ hasText: 'No leads match these filters.' });
    await expect(status).toBeVisible({ timeout: 20_000 });
  });

  test('surfaces a load failure as an alert with a retry action', async ({ page }) => {
    await stubLeadsCallable(page, { fail: true });
    await openAudience(page);

    const alert = page.getByRole('alert').filter({ hasText: 'Failed to load preview' });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Retry Connection' })).toBeVisible();

    // Retry re-runs the callable; a healthy response replaces the alert.
    await stubLeadsCallable(page, { leads: [row('l1')] });
    await page.getByRole('button', { name: 'Retry Connection' }).click();
    await expect(page.getByRole('button', { name: /Artificial L1/ })).toBeVisible({ timeout: 20_000 });
  });

  test('keeps the preview inside the viewport on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    await stubLeadsCallable(page, { leads: [row('l1'), row('l2')] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAudience(page);
    await expect(page.getByRole('button', { name: /Artificial L1/ })).toBeVisible({ timeout: 20_000 });

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('uses a mobile layout without document-level horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await stubLeadsCallable(page, { leads: [row('l1'), row('l2')] });
    await page.setViewportSize({ width: 412, height: 915 });
    await openAudience(page);
    await expect(page.getByRole('button', { name: /Artificial L1/ })).toBeVisible({ timeout: 20_000 });

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('has no serious/critical or contrast violations in the populated preview', async ({ page }) => {
    await stubLeadsCallable(page, { leads: [row('l1'), row('l2', { status: 'hired' })] });
    await openAudience(page);
    await expect(page.getByRole('button', { name: /Artificial L1/ })).toBeVisible({ timeout: 20_000 });

    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="audience-preview-list"]')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
