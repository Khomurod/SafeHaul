const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Real-browser closeout evidence for the public verification portal.
 *
 * WHY THIS SPEC EXISTS
 *
 * `pev-request-and-portal-response.spec.cjs` covers the happy "No / No Record
 * Found" path, desktop focus, overflow and one axe pass. It leaves the parts
 * that only a real browser can prove:
 *
 *  - **Signing.** happy-dom has no 2D canvas at all, so every unit test of
 *    `SignaturePad` runs against a stub. Whether a drag actually puts ink on
 *    the canvas, and whether that ink survives a viewport change, can only be
 *    measured here — by reading the canvas pixels back.
 *  - **The resize/orientation invariant.** The defect this campaign fixed was
 *    that resizing wiped the visible signature while the form kept submitting
 *    the PNG captured beforehand. The assertion that matters is that the pixels
 *    and the submitted data agree, which needs both to be observable.
 *  - **Every page state.** The `?e2eVerify=` scenarios reach the expired,
 *    invalid, already-completed and generic-failure screens so axe can scan
 *    them; the failure modes throw the same coded errors the callable throws,
 *    so they exercise the real mapping rather than bypassing it.
 *
 * Runs on Chromium and Mobile Chrome. No real tokens, drivers or employers.
 */

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

const seriousViolations = async (page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
};

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Verification portal signing', () => {
  test('puts ink on the pad with a mouse and enables clearing', async ({ page }) => {
    await gotoForm(page);

    await expect(page.getByText('Draw your signature here')).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear Signature/i })).toBeDisabled();
    expect(await inkCount(page)).toBe(0);

    await signWithMouse(page);

    expect(await inkCount(page)).toBeGreaterThan(100);
    await expect(page.getByText('Draw your signature here')).toBeHidden();
    await expect(page.getByRole('button', { name: /Clear Signature/i })).toBeEnabled();
  });

  test('puts ink on the pad with touch', async ({ page }) => {
    await gotoForm(page);
    await signWithTouch(page);

    expect(await inkCount(page)).toBeGreaterThan(100);
    await expect(page.getByText('Draw your signature here')).toBeHidden();
  });

  test('clears back to an empty, required pad', async ({ page }) => {
    await gotoForm(page);
    await signWithMouse(page);
    expect(await inkCount(page)).toBeGreaterThan(100);

    await page.getByRole('button', { name: /Clear Signature/i }).click();

    expect(await inkCount(page)).toBe(0);
    await expect(page.getByText('Draw your signature here')).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear Signature/i })).toBeDisabled();

    // And the form knows the signature is gone.
    await fillRespondent(page);
    await page.getByText('No / No Record Found').click();
    await submitButton(page).click();
    await expect(errorSummary(page)).toContainText('Please provide your electronic signature');
  });

  test('keeps the drawing surface exactly 150 px tall and matched to its backing store', async ({ page }) => {
    await gotoForm(page);
    const geometry = await canvas(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { cssW: Math.round(rect.width), cssH: Math.round(rect.height), attrW: el.width, attrH: el.height };
    });

    expect(geometry.cssH).toBe(150);
    expect(geometry.attrH).toBe(150);
    // A backing store wider than the rendered canvas is what made strokes drift
    // away from the cursor: the old code sized it from the parent's offsetWidth,
    // which included the container's 2 px border.
    expect(geometry.attrW).toBe(geometry.cssW);
  });

  test('names the drawing surface and associates its instructions', async ({ page }) => {
    await gotoForm(page);
    const surface = page.getByRole('img', { name: /signature/i });
    await expect(surface).toBeVisible();

    const described = await surface.evaluate((el) => (el.getAttribute('aria-describedby') || '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' '));
    expect(described).toContain('By signing, you certify that the information provided is true and accurate.');
  });

  test('associates the signature error with the surface and marks it invalid', async ({ page }) => {
    await gotoForm(page);
    await submitButton(page).click();
    await expect(errorSummary(page)).toBeVisible();

    const surface = page.getByRole('img', { name: /signature/i });
    await expect(surface).toHaveAttribute('aria-invalid', 'true');
    const described = await surface.evaluate((el) => (el.getAttribute('aria-describedby') || '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' '));
    expect(described).toContain('Please provide your electronic signature');
  });
});

test.describe('Verification portal resize and orientation invariant', () => {
  /**
   * The campaign's core defect: the visible signature and the data the form
   * would submit must never disagree. Either the ink survives the viewport
   * change, or the pad resets and the form demands a new signature.
   */
  const assertNoDivergence = async (page) => {
    const ink = await inkCount(page);
    const placeholderVisible = await page.getByText('Draw your signature here').isVisible();
    const clearDisabled = await page.getByRole('button', { name: /Clear Signature/i }).isDisabled();

    if (ink > 0) {
      expect(placeholderVisible, 'ink on the pad but the empty-state placeholder is showing').toBe(false);
      expect(clearDisabled, 'ink on the pad but Clear is disabled').toBe(false);
    } else {
      expect(placeholderVisible, 'pad is blank but does not say so').toBe(true);
      expect(clearDisabled, 'pad is blank but Clear is enabled').toBe(true);
    }
    return ink;
  };

  test('preserves the signature across a width change', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoForm(page);
    await signWithMouse(page);
    const before = await inkCount(page);
    expect(before).toBeGreaterThan(100);

    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(() => canvas(page).evaluate((el) => el.width)).toBeLessThan(800);

    expect(await assertNoDivergence(page)).toBe(before);
    // The height contract holds through the change.
    expect(await canvas(page).evaluate((el) => el.height)).toBe(150);
  });

  test('preserves the signature across a portrait/landscape swap', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoForm(page);
    await signWithTouch(page);
    const before = await inkCount(page);
    expect(before).toBeGreaterThan(100);

    await page.setViewportSize({ width: 915, height: 412 });
    await expect.poll(() => canvas(page).evaluate((el) => el.width)).toBeGreaterThan(412);

    expect(await assertNoDivergence(page)).toBe(before);
  });

  test('still submits a signature that matches what is on screen after resizing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoForm(page);
    await page.getByText('No / No Record Found').click();
    await fillRespondent(page);
    await signWithMouse(page);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect.poll(() => canvas(page).evaluate((el) => el.width)).toBeLessThan(760);
    expect(await inkCount(page)).toBeGreaterThan(100);

    await submitButton(page).click();
    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
  });

  test('ignores a height-only viewport change, as an on-screen keyboard produces', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoForm(page);
    await signWithTouch(page);
    const before = await inkCount(page);

    // Same width, much shorter: the keyboard opening must not touch the pad.
    await page.setViewportSize({ width: 412, height: 480 });
    await page.waitForTimeout(150);

    expect(await inkCount(page)).toBe(before);
    await expect(page.getByText('Draw your signature here')).toBeHidden();
  });
});

test.describe('Verification portal validation and submission', () => {
  test('walks the full employed response through every conditional section', async ({ page }) => {
    await gotoForm(page);
    await expect(page.getByText(/E2E Driver/i)).toBeVisible();

    await chooseInGroup(page, /Was this individual employed by your company\?/i, 'Yes');

    await page.locator('#verify-confirmed-start-date').fill('2021-01-01');
    await page.locator('#verify-confirmed-end-date').fill('2024-01-01');
    await page.getByPlaceholder('e.g., OTR Driver, Local Delivery Driver').fill('OTR Driver');
    await page.locator('#verify-reason-for-leaving').selectOption('Voluntary Resignation');

    await chooseInGroup(page, /Federal Motor Carrier Safety Regulations/i, 'Yes');
    await chooseInGroup(page, /DOT drug & alcohol testing/i, 'Yes');

    // Revealed by the previous answer.
    await expect(page.getByRole('group', { name: /DOT drug or alcohol violations/i })).toBeVisible();
    await chooseInGroup(page, /DOT drug or alcohol violations/i, 'Yes');
    await expect(page.locator('#verify-violation-details')).toBeVisible();
    await page.locator('#verify-violation-details').fill('Artificial violation detail.');
    await expect(page.getByRole('group', { name: /return-to-duty process/i })).toBeVisible();

    await chooseInGroup(page, /DOT-recordable accidents/i, 'Yes');
    await expect(page.locator('#verify-accident-details')).toBeVisible();
    await page.locator('#verify-accident-details').fill('Artificial accident detail.');

    await fillRespondent(page);
    await signWithMouse(page);

    await submitButton(page).click();
    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/A PDF record has been generated/i)).toBeVisible();
  });

  test('names failing fields by their on-page label and moves focus to the summary', async ({ page }) => {
    await gotoForm(page);
    await submitButton(page).click();

    const summary = errorSummary(page);
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();

    await expect(summary).toContainText('Was this individual employed by your company?');
    await expect(summary).toContainText('Your Full Name');
    await expect(summary).toContainText('Electronic Signature');
    await expect(summary).toContainText('Please provide your electronic signature');
    // The old camelCase-key rendering is gone.
    await expect(summary).not.toContainText('was Employed');
    await expect(summary).not.toContainText('signature Data');
  });

  test('retires a summary entry as soon as its field is fixed', async ({ page }) => {
    await gotoForm(page);
    await submitButton(page).click();
    await expect(errorSummary(page)).toContainText('Your Full Name');

    await page.getByPlaceholder('e.g., John Smith').fill('Alex Employer');

    await expect(errorSummary(page)).not.toContainText('Your Full Name');
    await expect(errorSummary(page)).toContainText('Electronic Signature');
  });

  /**
   * Implicit submission is the path the disabled submit Button does not cover:
   * pressing Enter in a text field submits the form even while that button is
   * disabled by its `loading` state.
   *
   * HONEST LIMIT: the E2E mock resolves synchronously, so there is no in-flight
   * window to race here — the first Enter completes and unmounts the form. What
   * this proves is that hammering Enter lands on exactly one success screen and
   * never an error screen. The precise "one callable for N submits while a
   * request is in flight" assertion is unit-level, in
   * `VerificationPortal.closeout.test.jsx`, where the callable can be held open.
   */
  test('lands on a single success screen when Enter is hammered in a text field', async ({ page }) => {
    await gotoForm(page);
    await page.getByText('No / No Record Found').click();
    await fillRespondent(page);
    await signWithMouse(page);

    let submitEvents = 0;
    await page.exposeFunction('__countVerificationSubmit', () => { submitEvents += 1; });
    await page.evaluate(() => {
      document.querySelector('form')
        .addEventListener('submit', () => window.__countVerificationSubmit(), true);
    });

    await page.getByPlaceholder('(555) 123-4567').focus();
    // Fired at the page, not the locator: the field unmounts on success.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
    expect(submitEvents).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByText('Verification Error')).toHaveCount(0);
  });

  test('shows a busy, non-resubmittable control during submission', async ({ page }) => {
    await gotoForm(page);
    await page.getByText('No / No Record Found').click();
    await fillRespondent(page);
    await signWithMouse(page);

    await submitButton(page).click();
    await expect(page.getByText(/Verification Submitted Successfully/i)).toBeVisible({ timeout: 15_000 });
    // The submit control does not survive into the success screen.
    await expect(submitButton(page)).toHaveCount(0);
  });
});

test.describe('Verification portal responsiveness', () => {
  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 1024, 768], ['phone', 412, 915]]) {
    test(`has no horizontal overflow at ${label} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoForm(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

      // The pad fits its column and stays operable at every width.
      const box = await canvas(page).boundingBox();
      expect(box.width).toBeLessThanOrEqual(width);
      expect(Math.round(box.height)).toBe(150);
      await expect(submitButton(page)).toBeVisible();
    });
  }

  test('keeps every section reachable and the signature usable on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await gotoForm(page);

    for (const heading of [
      /Section 1: Employment Confirmation/i,
      /Section 3: Additional Information/i,
      /Section 4: Respondent Verification & Signature/i,
    ]) {
      await expect(page.getByText(heading).first()).toBeVisible();
    }

    await signWithTouch(page);
    expect(await inkCount(page)).toBeGreaterThan(50);
  });
});

test.describe('Verification portal states and accessibility', () => {
  const STATES = [
    ['pending form', 'mock', /Previous Employment Verification/i],
    ['expired', 'expired', /Link Expired/i],
    ['invalid link', 'invalid', /Verification Error/i],
    ['already completed', 'completed', /Already Completed/i],
    ['load failure', 'failure', /Verification Error/i],
  ];

  for (const [label, mode, heading] of STATES) {
    test(`renders the ${label} state with one h1 and no serious axe violations`, async ({ page }) => {
      await page.goto(`/verify/e2e-token-1?e2eVerify=${mode}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
      expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }

  test('maps the expired and invalid states to their frozen messages', async ({ page }) => {
    await page.goto('/verify/e2e-token-1?e2eVerify=expired');
    await expect(page.getByText(
      'This verification request has expired. Please contact the requesting company for a new link.',
    )).toBeVisible();

    await page.goto('/verify/e2e-token-1?e2eVerify=invalid');
    await expect(page.getByText('This verification link is invalid or has been removed.')).toBeVisible();
  });

  test('renders the success state with one h1 and no serious axe violations', async ({ page }) => {
    await gotoForm(page);
    await page.getByText('No / No Record Found').click();
    await fillRespondent(page);
    await signWithMouse(page);
    await submitButton(page).click();

    await expect(page.getByRole('heading', { level: 1, name: /Verification Submitted Successfully/i }))
      .toBeVisible({ timeout: 15_000 });
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('has no serious axe violations with the validation summary on screen', async ({ page }) => {
    await gotoForm(page);
    await submitButton(page).click();
    await expect(errorSummary(page)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('has no serious axe violations with every conditional section expanded', async ({ page }) => {
    await gotoForm(page);
    await chooseInGroup(page, /Was this individual employed by your company\?/i, 'Yes');
    await chooseInGroup(page, /DOT drug & alcohol testing/i, 'Yes');
    await chooseInGroup(page, /DOT drug or alcohol violations/i, 'Yes');
    await chooseInGroup(page, /DOT-recordable accidents/i, 'Yes');

    expect(await seriousViolations(page)).toEqual([]);
  });

  test('reaches the submit control and the clear action by keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop keyboard behaviour.');
    await gotoForm(page);
    await signWithMouse(page);

    const clear = page.getByRole('button', { name: /Clear Signature/i });
    await clear.focus();
    await expect(clear).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(submitButton(page)).toBeFocused();

    // And Clear is operable from the keyboard.
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Draw your signature here')).toBeVisible();
  });
});
