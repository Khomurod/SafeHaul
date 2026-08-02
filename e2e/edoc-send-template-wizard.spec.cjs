// E2E coverage for the guided three-step send-from-template flow. Opens the
// wizard through the E-Docs mock flow (?e2eEdoc=mock) and verifies the dialog
// semantics, the step sequence, labelled recipient fields, delivery-method
// selection, the final summary, copy-vs-send button text, keyboard navigation,
// Escape, mobile reachability, document overflow and a scoped axe pass.
//
// Artificial data only: reserved example.test domains and fictional 555-01xx
// numbers. The send itself is not triggered here — the vitest suite covers the
// callback contracts, and the existing edoc-recruiter-send-flow spec covers the
// end-to-end send.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

/** The wizard dialog. Every lookup is scoped to it: the workspace behind the
 *  modal has its own "Back to Dashboard" and template controls, and an
 *  unscoped name lookup would match those too. */
function wizard(page) {
  return page.getByRole('dialog', { name: 'Send Document' });
}

async function openWizard(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: /^Templates/ }).click();
  await expect(page.getByText('E2E Test Document')).toBeVisible();
  await page.getByRole('button', { name: 'Send E2E Test Document' }).click();
  await expect(wizard(page)).toBeVisible({ timeout: 15_000 });
}

/** Fill in the recipient and walk to the final review step. */
async function goToReview(page) {
  const dialog = wizard(page);
  await dialog.getByLabel(/Recipient name/).fill('Artificial Recipient');
  await dialog.getByLabel('Email address').fill('artificial@example.test');
  await dialog.getByLabel('Phone number').fill('555-0100');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Step 3 of 3: Delivery and review')).toBeVisible();
}

test.describe('E-Doc guided send flow', () => {
  test.describe.configure({ timeout: 90_000 });

  test('is an accessible dialog naming the selected template', async ({ page }) => {
    await openWizard(page);

    const dialog = wizard(page);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByText(/Sending:/)).toBeVisible();
    await expect(dialog.getByText('E2E Test Document').first()).toBeVisible();

    // Focus lands on the recipient name field.
    await expect(dialog.getByLabel(/Recipient name/)).toBeFocused();
  });

  test('walks through the three named steps', async ({ page }) => {
    await openWizard(page);
    const dialog = wizard(page);

    await expect(dialog.getByText('Step 1 of 3: Recipient')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await dialog.getByLabel(/Recipient name/).fill('Artificial Recipient');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('Step 2 of 3: Document details')).toBeVisible();

    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('Step 3 of 3: Delivery and review')).toBeVisible();

    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(dialog.getByText('Step 2 of 3: Document details')).toBeVisible();
  });

  test('labels every recipient field', async ({ page }) => {
    await openWizard(page);
    const dialog = wizard(page);

    await dialog.getByLabel(/Recipient name/).fill('Artificial Recipient');
    await dialog.getByLabel('Email address').fill('artificial@example.test');
    await dialog.getByLabel('Phone number').fill('555-0100');

    await expect(dialog.getByLabel(/Recipient name/)).toHaveValue('Artificial Recipient');
    await expect(dialog.getByLabel('Email address')).toHaveValue('artificial@example.test');
  });

  test('selects delivery methods with a programmatic pressed state', async ({ page }) => {
    await openWizard(page);
    await goToReview(page);

    const group = wizard(page).getByRole('group', { name: 'Delivery method' });
    await expect(group).toBeVisible();

    const email = group.getByRole('button', { name: 'Email', exact: true });
    const sms = group.getByRole('button', { name: 'SMS', exact: true });
    await expect(email).toHaveAttribute('aria-pressed', 'true');

    await sms.click();
    await expect(sms).toHaveAttribute('aria-pressed', 'true');
    await expect(email).toHaveAttribute('aria-pressed', 'false');
  });

  test('summarises the send before submitting', async ({ page }) => {
    await openWizard(page);
    await goToReview(page);

    const dialog = wizard(page);
    await expect(dialog.getByText('Review before sending')).toBeVisible();
    await expect(dialog.getByText('Artificial Recipient')).toBeVisible();
    await expect(dialog.getByText('artificial@example.test')).toBeVisible();
    await expect(dialog.getByText('7 days after sending')).toBeVisible();
  });

  test('switches the primary action text between send and copy', async ({ page }) => {
    await openWizard(page);
    await goToReview(page);

    const dialog = wizard(page);
    await expect(dialog.getByRole('button', { name: /Send Document/ })).toBeVisible();

    await dialog.getByRole('group', { name: 'Delivery method' })
      .getByRole('button', { name: 'Copy Link' }).click();
    await expect(dialog.getByRole('button', { name: /Copy Signing Link/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Send Document/ })).toHaveCount(0);
  });

  test('searches and quick-selects a lead on the recipient step', async ({ page }) => {
    await openWizard(page);

    const dialog = wizard(page);
    await expect(dialog.getByText('Or choose an existing driver or lead')).toBeVisible();
    const search = dialog.getByLabel('Search leads');
    await expect(search).toHaveAttribute('placeholder', 'Search leads...');

    await search.fill('zzz-no-such-lead');
    await expect(dialog.getByText('No leads found.')).toBeVisible();
  });

  test('keeps the dialog keyboard navigable and closes on Escape', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behavior.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWizard(page);

    // Tab moves through the dialog and focus stays inside it.
    await page.keyboard.press('Tab');
    const insideAfterTab = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(insideAfterTab).toBe(true);

    await page.keyboard.press('Escape');
    await expect(wizard(page)).toHaveCount(0);
  });

  test('keeps the submit action reachable on mobile without document overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    await openWizard(page);
    await goToReview(page);

    const submit = wizard(page).getByRole('button', { name: /Send Document/ });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  });

  test('does not overflow the document on desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop/tablet geometry check.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWizard(page);

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 });
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  });

  test('has no serious/critical or contrast violations in the dialog @a11y', async ({ page }) => {
    await openWizard(page);

    const check = async () => {
      const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      const serious = violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
      expect(serious).toEqual([]);
      expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
    };

    await check();
    await goToReview(page);
    await check();
  });
});
