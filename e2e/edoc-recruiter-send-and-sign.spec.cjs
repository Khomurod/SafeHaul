const { test, expect } = require('@playwright/test');

/**
 * Reads the geometry of a field overlay relative to its page container.
 * Overlays are percent-positioned inside the page, so these ratios must match
 * the authored xPosition/yPosition/width at ANY viewport size or zoom level.
 */
async function overlayRatios(page, fieldId) {
  const overlay = page.locator(`[data-field-id="${fieldId}"]`);
  const pageEl = page.locator('[data-signing-page="1"]');
  await expect(overlay).toBeVisible();
  const [box, pageBox] = await Promise.all([overlay.boundingBox(), pageEl.boundingBox()]);
  expect(box).toBeTruthy();
  expect(pageBox).toBeTruthy();
  return {
    x: (box.x - pageBox.x) / pageBox.width,
    y: (box.y - pageBox.y) / pageBox.height,
    w: box.width / pageBox.width,
    h: box.height / pageBox.height,
    box,
    pageBox,
  };
}

async function openMockSigningRoom(page) {
  await page.goto('/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock');
  await expect(page.getByText('E2E Test Document')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();
  await expect(page.locator('[data-signing-page="1"]')).toBeVisible({ timeout: 10_000 });
}

/**
 * Drives the signing room's pinch handler with real TouchEvents: two fingers
 * on the first page, spread apart by `factor`, then lifted. Fails loudly
 * rather than skipping if the page has no touch constructors.
 */
async function pinchOut(page, factor) {
  await page.evaluate((f) => {
    const scroller = document.querySelector('[data-signing-scroller]');
    const pageEl = document.querySelector('[data-signing-page="1"]');
    if (!scroller || !pageEl) throw new Error('signing scroller or page 1 not found');
    if (typeof TouchEvent !== 'function' || typeof Touch !== 'function') {
      throw new Error('Touch constructors unavailable: this lane needs hasTouch: true');
    }
    const rect = scroller.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + Math.min(rect.height / 2, 300);
    const finger = (id, x, y) => new Touch({
      identifier: id, target: pageEl, clientX: x, clientY: y, pageX: x, pageY: y,
      screenX: x, screenY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
    });
    const fire = (type, touches) => pageEl.dispatchEvent(new TouchEvent(type, {
      touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true,
    }));
    const start = 40;
    fire('touchstart', [finger(1, cx - start, cy), finger(2, cx + start, cy)]);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const d = start * (1 + (f - 1) * (i / steps));
      fire('touchmove', [finger(1, cx - d, cy), finger(2, cx + d, cy)]);
    }
    fire('touchend', []);
  }, factor);
}

test.describe('E-Doc recruiter send and public sign', () => {
  test.describe.configure({ timeout: 60_000 });

  test('company admin can open E-Docs workspace', async ({ page }) => {
    await page.goto('/company/e-docs?e2eAuth=company_admin');
    await expect(page.getByText(/E-Docs|Documents/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test('public signer completes mock signing room', async ({ page }) => {
    await page.goto('/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock');
    await expect(page.getByText('E2E Test Document')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();
    await page.getByRole('button', { name: /Finish & Submit/i }).click();
    await expect(page.getByText('Document Signed!')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Document-first mobile signing', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('renders the PDF with anchored overlays, keeps taps accurate after zoom, and submits', async ({ page }) => {
    await openMockSigningRoom(page);

    // The document (not an extracted form) is the mobile experience: the
    // checkbox overlay sits at its authored position ON the page.
    const before = await overlayRatios(page, 'check1');
    expect(before.x).toBeGreaterThan(0.08);
    expect(before.x).toBeLessThan(0.12); // authored xPosition: 10%
    expect(before.w).toBeGreaterThan(0.02);
    expect(before.w).toBeLessThan(0.08); // authored width: 4% — no 44px layout inflation

    // Tap accuracy at base zoom: mock pre-checks check1 → tap to uncheck.
    const checkbox = page.locator('[data-field-id="check1"] input[type="checkbox"]');
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();

    // Zoom in 2 steps (100% → 200%); the page re-renders wider and overlays
    // must scale with it (percent geometry, not absolute pixels).
    const zoomIn = page.getByRole('button', { name: 'Zoom in' }).last();
    await zoomIn.click();
    await zoomIn.click();
    await expect(async () => {
      const after = await overlayRatios(page, 'check1');
      expect(after.pageBox.width).toBeGreaterThan(before.pageBox.width * 1.8);
      // Anchors hold: same x/width ratios within a 1.5% tolerance.
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.015);
      expect(Math.abs(after.w - before.w)).toBeLessThan(0.015);
    }).toPass({ timeout: 5_000 });

    // Tap accuracy AFTER zoom: hit-testing is native DOM, so the same tap
    // must land on the same checkbox with no translation-matrix drift.
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // All required fields complete → the thumb bar offers Finish & Submit.
    await page.getByRole('button', { name: /Finish & Submit/i }).click();
    await expect(page.getByText('Document Signed!')).toBeVisible({ timeout: 15_000 });
  });

  test('corner fields stay anchored on iPhone SE and Galaxy Z Fold widths', async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 568 },  // iPhone SE (1st gen) — smallest mainstream phone
      { width: 884, height: 1104 }, // Galaxy Z Fold unfolded — tablet-ish inner screen
    ]) {
      await page.setViewportSize(viewport);
      await openMockSigningRoom(page);

      // corner_tl is authored at 0%, 0% — it must hug the top-left edge.
      const tl = await overlayRatios(page, 'corner_tl');
      expect(Math.abs(tl.x)).toBeLessThan(0.01);
      expect(Math.abs(tl.y)).toBeLessThan(0.01);

      // corner_br is authored at 93%, 95% (6% × 4%) — bottom-right corner,
      // fully inside the page bounds.
      const br = await overlayRatios(page, 'corner_br');
      expect(Math.abs(br.x - 0.93)).toBeLessThan(0.015);
      expect(Math.abs(br.y - 0.95)).toBeLessThan(0.015);
      expect(br.box.x + br.box.width).toBeLessThanOrEqual(br.pageBox.x + br.pageBox.width + 1);
      expect(br.box.y + br.box.height).toBeLessThanOrEqual(br.pageBox.y + br.pageBox.height + 1);
    }
  });

  test('orientation change preserves entered values and overlay anchors', async ({ page }) => {
    await openMockSigningRoom(page);

    const cornerInput = page.locator('[data-signer-input="corner_tl"]');
    await cornerInput.fill('EDGE-VALUE');
    await expect(cornerInput).toHaveValue('EDGE-VALUE');

    // Rotate portrait → landscape mid-fill.
    await page.setViewportSize({ width: 812, height: 375 });

    // No data loss, and the overlay re-anchors to the re-fit page instantly.
    await expect(cornerInput).toHaveValue('EDGE-VALUE');
    await expect(async () => {
      const tl = await overlayRatios(page, 'corner_tl');
      expect(Math.abs(tl.x)).toBeLessThan(0.01);
      expect(Math.abs(tl.y)).toBeLessThan(0.01);
    }).toPass({ timeout: 5_000 });
  });

  test('keyboard Enter advances focus to the next field in reading order', async ({ page }) => {
    await openMockSigningRoom(page);

    const text1 = page.locator('[data-signer-input="text1"]');
    await text1.click();
    await expect(text1).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-signer-input="date1"]')).toBeFocused();
  });

  test('pinch gesture zooms the document (two-finger touch sequence)', async ({ page }) => {
    await openMockSigningRoom(page);

    const before = await page.locator('[data-signing-page="1"]').boundingBox();

    // Until 2026-09-06 this asked CDP for `Input.synthesizePinchGesture`, which
    // headless CI Chromium refuses, so the test skipped on every run. The hook
    // (`usePdfZoomGestures`) listens for touchstart/touchmove/touchend on the
    // scroller and reads `e.touches`, so the gesture is driven with exactly
    // those events: two fingers 80px apart, spread to 160px over six moves, then
    // lifted — the same ×2 the CDP call asked for. `hasTouch: true` on this
    // describe gives the page the Touch and TouchEvent constructors.
    await pinchOut(page, 2);

    // The pinch commits on release: the page re-renders wider and overlays
    // scale with it.
    await expect(async () => {
      const after = await page.locator('[data-signing-page="1"]').boundingBox();
      expect(after.width).toBeGreaterThan(before.width * 1.3);
    }).toPass({ timeout: 5_000 });

    const ratios = await overlayRatios(page, 'check1');
    expect(Math.abs(ratios.x - 0.10)).toBeLessThan(0.015);
  });
});
