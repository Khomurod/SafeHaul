const { test, expect } = require('@playwright/test');
const { openCreator } = require('./helpers/edocHelpers.cjs');

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

    // Not CDP's `Input.synthesizePinchGesture`, which headless CI Chromium
    // refuses. The hook (`usePdfZoomGestures`) listens for touchstart/touchmove/
    // touchend on the scroller and reads `e.touches`, so the gesture is driven
    // with exactly those events: two fingers 80px apart, spread to 160px over six
    // moves, then lifted — a ×2 pinch. `hasTouch: true` on this describe gives
    // the page the Touch and TouchEvent constructors.
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

/** Opens the drawing sheet from the mock's signature field, which is signed already. */
async function openSignaturePad(page) {
  await openMockSigningRoom(page);
  const sheet = page.getByRole('dialog', { name: /Draw your signature/i });
  await expect(async () => {
    await page.getByRole('button', { name: 'Signature added — tap to redraw' }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  return sheet;
}

/** Draws one zigzag stroke near the top left of the pad with the mouse. */
async function drawStroke(page, canvas) {
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(box.x + 40 + i * 12, box.y + 60 + (i % 2) * 24, { steps: 2 });
  }
  await page.mouse.up();
}

/** The size of a PNG data URL, and whether ink touches each of its four edges. */
async function inkImage(page, dataUrl) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const inked = (x, y) => data[(y * c.width + x) * 4 + 3] !== 0;
    const row = (y) => Array.from({ length: c.width }, (_, x) => inked(x, y)).some(Boolean);
    const col = (x) => Array.from({ length: c.height }, (_, y) => inked(x, y)).some(Boolean);
    return { width: c.width, height: c.height, edges: [row(0), row(c.height - 1), col(0), col(c.width - 1)] };
  }, dataUrl);
}

test.describe('Signature pad', () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ viewport: { width: 375, height: 812 } });

  test('the adopted signature is cropped to its ink', async ({ page }) => {
    const sheet = await openSignaturePad(page);
    const canvas = sheet.getByTestId('signature-sheet-canvas');
    await drawStroke(page, canvas);
    const pad = await canvas.evaluate((c) => ({ width: c.width, height: c.height }));
    await sheet.getByRole('button', { name: /Adopt & continue/i }).click();
    await expect(sheet).toBeHidden();

    const src = await page.locator('[data-field-id="sig1"] img').getAttribute('src');
    const adopted = await inkImage(page, src);
    // The ink fills the field box when stamped: no blank margin on any side.
    expect(adopted.edges).toEqual([true, true, true, true]);
    expect(adopted.width).toBeLessThan(pad.width / 2);
    expect(adopted.height).toBeLessThan(pad.height / 2);
  });

  test('a rotation that wipes the pad leaves nothing to adopt', async ({ page }) => {
    const sheet = await openSignaturePad(page);
    const canvas = sheet.getByTestId('signature-sheet-canvas');
    const before = await page.locator('[data-field-id="sig1"] img').getAttribute('src');
    await drawStroke(page, canvas);
    const width = await canvas.evaluate((c) => c.width);

    // The phone turns on its side: the pad is measured again, and a canvas
    // given new dimensions loses its pixels.
    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(() => canvas.evaluate((c) => c.width)).not.toBe(width);

    await sheet.getByRole('button', { name: /Adopt & continue/i }).click();
    await expect(sheet.getByRole('status')).toHaveText('Draw your signature before adopting it.');
    await expect(sheet).toBeVisible();
    expect(await page.locator('[data-field-id="sig1"] img').getAttribute('src')).toBe(before);
  });
});

// --- The company signature ------------------------------------------------
//
// E2E mode has no Storage or Functions: the image upload, the PDF upload and
// the short-lived image link are answered here at the network edge, and what
// they receive is asserted. Nobody is signed in to Firebase there, so the
// request write after the PDF upload cannot happen: the send is proved to have
// passed its checks by the PDF upload it starts, and the request it writes is
// pinned by `envelopePersistence.companySignature.test.js`. Every name, address
// and image is made up.


const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const STAMP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const STAMP_URL = `data:image/png;base64,${STAMP_PNG_BASE64}`;
const MISSING_IMAGE = 'Upload the company signature image before sending. A company signature on this document has no image yet.';

/** Minimal single-page PDF, generated inline so no fixture file is needed. */
const ONE_PAGE_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj',
  'trailer<</Root 1 0 R>>',
].join('\n');

/** Answers the named callable with `answer(data)`, recording what it was sent. */
async function answerCallable(page, name, answer) {
  const received = [];
  await page.route(`**/${name}`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const data = route.request().postDataJSON()?.data;
    received.push(data);
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result: answer(data) }) });
  });
  return received;
}

/** Answers Storage uploads as the bucket would, recording each object's path. */
async function answerStorageUploads(page) {
  const uploaded = [];
  await page.route(/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o/, (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(request.url()).searchParams.get('name');
    uploaded.push(name);
    const at = new Date().toISOString();
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ name, bucket: 'safehaul-e2e.appspot.com', generation: '1', metageneration: '1', size: '68', timeCreated: at, updated: at }),
    });
  });
  return uploaded;
}

test.describe('Company signature in the editor', () => {
  test.describe.configure({ timeout: 90_000 });

  test('is placed, refuses to send without an image, takes an uploaded image and sends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const uploaded = await answerStorageUploads(page);
    const links = await answerCallable(page, 'getSignedDocumentUrl', () => ({ success: true, url: STAMP_URL }));

    await openCreator(page, 'request');
    await expect(page.getByLabel('Document title')).toBeVisible({ timeout: 15_000 });
    await page.setInputFiles('#pdf-upload', { name: 'artificial-agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(ONE_PAGE_PDF, 'utf8') });
    await page.getByRole('button', { name: 'Add Company Signature field', exact: true }).click();
    await expect(page.locator('[data-page-num="1"]').first()).toBeVisible({ timeout: 20_000 });

    const placed = page.getByRole('group', { name: /company signature field on page 1/ });
    await expect(placed).toContainText('No image yet');

    const setup = page.getByRole('complementary', { name: 'Envelope setup' });
    await setup.getByLabel(/^Name/).fill('Pat Example');
    await setup.getByRole('textbox', { name: 'Email' }).fill('pat@example.test');

    // Without its image the document is not sent, and nothing is uploaded.
    await page.getByRole('button', { name: 'Send Document' }).click();
    await expect(page.getByText(MISSING_IMAGE)).toBeVisible();
    expect(uploaded).toEqual([]);

    await page.getByRole('list', { name: /^Placed/ }).getByRole('button', { name: /Company Signature.*P1/ }).click();
    const inspector = page.getByRole('complementary', { name: 'Document inspector' });
    await inspector.getByLabel('Company signature image').setInputFiles({
      name: 'stamp.png', mimeType: 'image/png', buffer: Buffer.from(STAMP_PNG_BASE64, 'base64'),
    });

    await expect(inspector.getByRole('img', { name: 'Company signature' })).toBeVisible({ timeout: 15_000 });
    await expect(placed.getByRole('img', { name: 'Company signature' })).toBeVisible();
    await expect(inspector.getByText('Replace image')).toBeVisible();
    expect(uploaded).toEqual([
      expect.stringMatching(/^secure_documents\/e2e-company\/originals\/company-signatures\/[0-9a-f-]{36}\.png$/),
    ]);
    expect(links).toEqual([{ storagePath: uploaded[0] }]);

    // With it, the send goes on to upload the document itself.
    await page.getByRole('button', { name: 'Send Document' }).click();
    await expect.poll(() => uploaded.length, { timeout: 15_000 }).toBe(2);
    expect(uploaded[1]).toMatch(/^secure_documents\/e2e-company\/originals\/\d+_artificial-agreement\.pdf$/);
  });
});

test.describe('Company signature in the signing room', () => {
  test.describe.configure({ timeout: 90_000 });

  const ENVELOPE = {
    title: 'Artificial Lease Agreement',
    recipientName: 'Pat Example',
    status: 'sent',
    pdfUrl: `data:application/pdf;base64,${Buffer.from(ONE_PAGE_PDF, 'utf8').toString('base64')}`,
    fields: [
      { id: 'text1', type: 'text', label: 'Printed name', pageNumber: 1, required: true, xPosition: 10, yPosition: 10, width: 30, height: 5 },
      {
        id: 'cs1', type: 'company_signature', label: 'Company Signature', pageNumber: 1, xPosition: 10, yPosition: 30,
        width: 25, height: 8, required: false, readOnly: true, prefillPolicy: 'locked', defaultValue: '', companySignatureUrl: STAMP_URL,
      },
      { id: 'sig1', type: 'signature', label: 'Signature', pageNumber: 1, required: true, xPosition: 10, yPosition: 60, width: 30, height: 8 },
    ],
  };

  test('shows the fixed company signature, and the driver signs without it @mobile', async ({ page }) => {
    await answerCallable(page, 'getPublicEnvelope', () => ENVELOPE);
    const submitted = await answerCallable(page, 'submitPublicEnvelope', () => ({ success: true }));

    await page.goto('/sign/e2e-company/e2e-company-signature?token=e2e-token');
    await expect(page.getByText('Artificial Lease Agreement').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /I Agree - Proceed to Sign/i }).click();

    const stamp = page.locator('[data-field-id="cs1"]');
    await expect(stamp.getByRole('img', { name: 'Company signature' })).toBeVisible({ timeout: 20_000 });
    await expect(stamp.locator('button, input, [tabindex]')).toHaveCount(0);
    // The printed name and the signature are left; the company signature is not counted.
    await expect(page.getByRole('status').filter({ hasText: /remaining|left/ })).toContainText('2');

    await page.locator('[data-signer-input="text1"]').fill('Pat Example');
    const sheet = page.getByRole('dialog', { name: /Draw your signature/i });
    await expect(async () => {
      await page.getByRole('button', { name: 'Tap to sign' }).click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await drawStroke(page, sheet.getByTestId('signature-sheet-canvas'));
    await sheet.getByRole('button', { name: /Adopt & continue/i }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: /Finish & Submit/i }).click();
    await expect(page.getByText('Document Signed!')).toBeVisible({ timeout: 15_000 });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ companyId: 'e2e-company', requestId: 'e2e-company-signature', accessToken: 'e2e-token' });
    expect(Object.keys(submitted[0].fieldValues).sort()).toEqual(['sig1', 'text1']);
  });
});
