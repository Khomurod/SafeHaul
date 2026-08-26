// E2E coverage for the envelope creator's left sidebar. The creator is opened
// through the Documents workspace New Document dialog under the e2eEdoc mock, so
// no real recipient, document or signing data is involved and no send is
// triggered — the spec stops at the pre-upload state.
//
// The exact callbacks, delivery keys and palette template ids are covered by the
// vitest suite in
// src/features/signing/components/envelope-creator/EnvelopeSidebar.test.jsx.
const { test, expect } = require('@playwright/test');
const { openCreator: openEnvelopeCreator } = require('./helpers/edocHelpers.cjs');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

/**
 * The rail is the desktop presentation. Below `lg` the same sections live in
 * bottom sheets, covered by e2e/edoc-editor-mobile.spec.cjs — so this spec sets
 * a desktop viewport rather than asserting a rail that deliberately is not
 * there on a phone.
 */
async function openSidebar(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEnvelopeCreator(page, 'request', URL);
  await expect(page.getByRole('complementary', { name: 'Envelope setup' })).toBeVisible({ timeout: 20_000 });
}

test.describe('E-Doc envelope creator sidebar', () => {
  test.describe.configure({ timeout: 90_000 });

  test('exposes the sidebar as a labelled region with labelled recipient inputs', async ({ page }) => {
    await openSidebar(page);
    const sidebar = page.getByRole('complementary', { name: 'Envelope setup' });

    await expect(sidebar.getByRole('heading', { name: 'Recipient' })).toBeVisible();
    await expect(sidebar.getByLabel(/^Name/)).toBeVisible();
    await expect(sidebar.getByLabel('Email')).toBeVisible();
    await expect(sidebar.getByLabel('Phone')).toBeVisible();

    // Typing lands in the labelled control, not a placeholder-only input.
    await sidebar.getByLabel(/^Name/).fill('Pat Example');
    await expect(sidebar.getByLabel(/^Name/)).toHaveValue('Pat Example');
  });

  test('states the delivery selection without relying on colour', async ({ page }) => {
    await openSidebar(page);
    const group = page.getByRole('group', { name: 'Delivery' });

    await expect(group.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Both' }).click();
    await expect(group.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false');
  });

  /*
   * The picker is the approved `FileInput` dropzone since 2026-08-25, so its
   * accessible name is the FIELD ("Choose a PDF file") and "Choose File" is the
   * label's visible words. A file input maps to the `button` role, which is how
   * assistive technology sees it and why the name has to be the field rather
   * than the trigger's text. The frozen copy on screen is unchanged.
   */
  const picker = (page) => page.getByRole('button', { name: 'Choose a PDF file', exact: true });

  test('keeps the upload trigger reachable from the keyboard', async ({ page }) => {
    await openSidebar(page);
    await expect(page.getByText('Upload a PDF first')).toBeVisible();
    await expect(page.getByText('Choose File')).toBeVisible();

    const choose = picker(page);
    await choose.focus();
    await expect(choose).toBeFocused();
    // The ring is drawn on the label through `:focus-within`, because the input
    // itself is clipped to 1x1 — so that is where it has to be measured.
    const ring = await choose.evaluate((el) => {
      const s = getComputedStyle(el.closest('label'));
      return s.boxShadow !== 'none' || s.outlineStyle !== 'none';
    });
    expect(ring).toBe(true);
  });

  test('groups the rail into Setup, Add Fields and Fields', async ({ page }) => {
    await openSidebar(page);
    const sidebar = page.getByRole('complementary', { name: 'Envelope setup' });

    for (const name of [/^Setup/, /^Add Fields/, /^Fields/]) {
      await expect(sidebar.getByRole('button', { name, expanded: true })).toBeVisible();
    }
  });

  test('collapses a section and takes its contents out of reach', async ({ page }) => {
    await openSidebar(page);
    const sidebar = page.getByRole('complementary', { name: 'Envelope setup' });
    const setup = sidebar.getByRole('button', { name: /^Setup/ });

    await expect(picker(page)).toBeVisible();
    await setup.click();
    await expect(setup).toHaveAttribute('aria-expanded', 'false');
    await expect(picker(page)).toHaveCount(0);

    await setup.click();
    await expect(picker(page)).toBeVisible();
  });

  test('does not overflow the document at desktop and tablet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'The rail is desktop-only; see edoc-editor-mobile.');
    await openSidebar(page);

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      await expect(picker(page)).toBeVisible();
    }
  });

  test('has no serious/critical or contrast violations in the sidebar', async ({ page }) => {
    await openSidebar(page);

    const { violations } = await new AxeBuilder({ page })
      .include('aside[aria-label="Envelope setup"]')
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
    expect(serious).toEqual([]);
    expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
