// The personal application link lives on the Profile page, for every staff
// member; Settings has no My profile section. An old Settings → My profile
// address opens Profile with its other parameters kept. Link generation, the
// company-switch re-ask and the copy button are covered by
// `PersonalLinkCard.test.jsx`; the browser suite has no Firestore, so the card
// settles on whichever link it can offer, `?r=` or `?recruiter=`.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const PROFILE_URL = '/company/profile?e2eAuth=company_admin';

async function openLinkCard(page) {
  await page.goto(PROFILE_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'My Profile' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Your personal link' });
  await expect(card).toBeVisible();
  // The link, once the card has asked for it.
  await expect(card.getByText(/\/apply\/e2e-company\?(r|recruiter)=/)).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe('Profile: the personal link', () => {
  test.describe.configure({ timeout: 90_000 });

  test('an old Settings → My profile address opens Profile, keeping its parameters', async ({ page }) => {
    await page.goto('/company/settings?e2eAuth=company_admin&section=personal');
    await expect(page).toHaveURL(/\/company\/profile\?e2eAuth=company_admin$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My Profile' })).toBeVisible();
  });

  test('Settings offers no My profile section', async ({ page }) => {
    await page.goto('/company/settings?e2eAuth=company_admin');
    await expect(page.getByRole('heading', { level: 1, name: /^(Company profile|Settings)$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^My profile/ })).toHaveCount(0);
  });

  test('shows the link with its explanation and a Copy button, and no Username field', async ({ page }) => {
    const card = await openLinkCard(page);
    await expect(card).toContainText('Drivers who apply will be automatically assigned to you.');
    await expect(card.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Username' })).toHaveCount(0);
  });

  test('keeps the card inside a phone screen @mobile', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile presentation check.');
    await page.setViewportSize({ width: 412, height: 915 });
    const card = await openLinkCard(page);

    const geometry = await card.evaluate((element) => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardRight: element.getBoundingClientRect().right,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewport + 1);
  });

  test('has no serious or critical accessibility violations in the card', async ({ page }) => {
    await openLinkCard(page);

    const { violations } = await new AxeBuilder({ page })
      .include('[aria-labelledby="personal-recruiting-link-title"]')
      .analyze();
    const severe = violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .flatMap((violation) => violation.nodes.map((node) => (
        `${violation.id} [${violation.impact}] ${node.target.join(' ')}: ${node.failureSummary}`
      )));

    expect(severe).toEqual([]);
  });
});
