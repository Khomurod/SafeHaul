const { expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Shared helpers for the public verification portal specs
 * (`verification-portal-closeout.spec.cjs`, `verification-portal-typed-signature.spec.cjs`).
 *
 * Extracted on 2026-09-06 when the typed-signature tests (audit step J) pushed
 * the closeout spec past the 500-line maximum. Everything here is a *page
 * gesture*, not an assertion about the product: how to load the mock form, how
 * to put ink on the canvas the way a mouse or a finger does, how to read that
 * ink back, how to fill the shortest valid response. The specs own what is
 * asserted about each of those.
 */

/** The pending form, served from the E2E mock scenario — no real token. */
const MOCK = '/verify/e2e-token-1?e2eVerify=mock';

/** Load the pending form. */
async function gotoForm(page) {
  await page.goto(MOCK);
  await expect(page.getByRole('heading', { level: 1, name: /Previous Employment Verification/i }))
    .toBeVisible({ timeout: 20_000 });
}

const canvas = (page) => page.locator('canvas');
const submitButton = (page) => page.getByRole('button', { name: /Submit Verification Response/i });
/** The validation summary. Scoped by test id: each failing field also renders
 *  its own `role="alert"` FieldMessage, so the role alone is ambiguous. */
const errorSummary = (page) => page.getByTestId('verification-error-summary');

/** Number of non-transparent pixels currently on the signing surface. */
const inkCount = (page) => canvas(page).evaluate((el) => {
  const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
  return n;
});

/** Sign with a real mouse drag across the pad. */
async function signWithMouse(page) {
  await canvas(page).scrollIntoViewIfNeeded();
  const box = await canvas(page).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(box.x + 30 + i * 12, y + (i % 2 ? 22 : -22));
  }
  await page.mouse.up();
}

/** Sign with touch-typed pointer events, the way a phone signer does. */
async function signWithTouch(page) {
  await canvas(page).scrollIntoViewIfNeeded();
  const box = await canvas(page).boundingBox();
  await canvas(page).evaluate((el, b) => {
    const y = b.height / 2 + b.y;
    const fire = (type, x, cy) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: cy, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', b.x + 25, y);
    for (let i = 1; i <= 12; i += 1) fire('pointermove', b.x + 25 + i * 10, y + (i % 2 ? 18 : -18));
    fire('pointerup', b.x + 145, y);
  }, box);
}

/** Fill the shortest valid response, leaving the signature to the caller. */
async function fillRespondent(page) {
  await page.getByPlaceholder('e.g., John Smith').fill('Alex Employer');
  await page.getByPlaceholder('e.g., Safety Director, HR Manager').fill('HR Director');
  await page.getByPlaceholder('(555) 123-4567').fill('555-111-2222');
}

/**
 * Choose a radio option the way a user does — by clicking its label.
 *
 * The real `<input type="radio">` is `sr-only` inside the `<label>` (the
 * standard custom-radio pattern), so the visible dot intercepts a direct click
 * on the input. Keyboard operation is unaffected and is covered separately.
 */
const chooseInGroup = (page, groupName, optionName) => page
  .getByRole('group', { name: groupName })
  .getByText(optionName, { exact: true })
  .click();

/** Serious and critical axe violations on the current page, as printable ids. */
const seriousViolations = async (page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
};

module.exports = {
  MOCK,
  gotoForm,
  canvas,
  submitButton,
  errorSummary,
  inkCount,
  signWithMouse,
  signWithTouch,
  fillRespondent,
  chooseInGroup,
  seriousViolations,
};
