const { test, expect } = require('@playwright/test');

/**
 * A driver referral link: `/apply/<slug>?ref=<code>` offers the quick interest
 * form beside the full application. The callable is answered here; what it
 * receives is asserted, and the server's own checks have their own tests.
 */

const REFERRAL_URL = '/apply/e2e-company?e2eIntake=choice&ref=abcd2345';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

async function answerQuickInterest(page) {
  const sent = [];
  await page.route(/\/submitReferralInterest$/, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().postDataJSON()?.data);
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) });
  });
  return sent;
}

async function sendQuickInterest(page) {
  await page.getByRole('button', { name: /Quick interest/ }).click();
  await page.getByLabel(/First name/).fill('Sam');
  await page.getByLabel(/Last name/).fill('Rivera');
  await page.getByLabel(/Phone/).fill('(312) 555-0142');
  await page.getByLabel(/Email/).fill('sam.rivera@example.com');
  await page.getByRole('checkbox', { name: /may contact me by phone call, text message/ }).check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe('guest referral intake', () => {
  test.describe.configure({ timeout: 60_000 });

  test('the quick interest form sends the four answers, the consent and the link code', async ({ page }) => {
    const sent = await answerQuickInterest(page);
    await page.goto(REFERRAL_URL);
    await expect(page.getByRole('button', { name: /Full application/ })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Quick interest/ }).click();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('First name is required.')).toBeVisible();
    expect(sent).toHaveLength(0);
    await page.getByRole('button', { name: 'Back' }).click();

    await sendQuickInterest(page);
    expect(sent).toEqual([{
      companyId: expect.any(String),
      referralCode: 'ABCD2345',
      firstName: 'Sam',
      lastName: 'Rivera',
      phone: '(312) 555-0142',
      email: 'sam.rivera@example.com',
      contactConsent: true,
    }]);

    await page.getByRole('button', { name: 'Fill out the full application' }).click();
    await expect(page.getByText('Fill Out Manually')).toBeVisible();
  });

  test('the full application starts from the usual chooser', async ({ page }) => {
    await page.goto(REFERRAL_URL);
    await page.getByRole('button', { name: /Full application/ }).click();
    await page.getByText('Fill Out Manually').click();
    await expect(page.locator('#step-title')).toHaveText('Step 1 of 9: Personal Information');
  });

  test('a link without a code shows the usual chooser', async ({ page }) => {
    await page.goto('/apply/e2e-company?e2eIntake=choice');
    await expect(page.getByText('Fill Out Manually')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Quick interest/ })).toHaveCount(0);
  });

  test('an older draft with a saved code does not bring the choice back without one', async ({ page }) => {
    // A draft from before steps were recorded: nothing skips the first screens,
    // and the code it carries is from an earlier link.
    await page.addInitScript(() => {
      localStorage.setItem('draft_e2e-company', JSON.stringify({ firstName: 'Sam', referralCode: 'ABCD2345' }));
    });
    await page.goto('/apply/e2e-company?e2eIntake=choice');
    await expect(page.getByText('Fill Out Manually')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Quick interest/ })).toHaveCount(0);
  });

  test('fits a narrow phone from the choice to the thank-you @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await answerQuickInterest(page);
    await page.goto(REFERRAL_URL);
    await expect(page.getByRole('button', { name: /Quick interest/ })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, 'choice');
    await page.getByRole('button', { name: /Quick interest/ }).click();
    await expectNoHorizontalOverflow(page, 'quick form');
    await page.getByRole('button', { name: 'Back' }).click();
    await sendQuickInterest(page);
    await expectNoHorizontalOverflow(page, 'thank-you');
  });
});
