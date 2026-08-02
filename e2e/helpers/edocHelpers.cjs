// Shared entry points for the E-Docs specs.
//
// The Documents workspace no longer has "Send One-off" / "Create Template"
// header buttons: the mode is chosen in the New Document dialog and is then
// FIXED inside the creator. Every spec that needs the creator goes through
// these helpers so the entry path lives in one place.
const { expect } = require('@playwright/test');

const DOCUMENTS_URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

/** Open the Documents workspace and wait for the header. */
async function openDocumentsWorkspace(page, url = DOCUMENTS_URL) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible({ timeout: 20_000 });
}

/**
 * Open the envelope creator in a fixed mode.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'request'|'template'} mode
 */
async function openCreator(page, mode = 'request', url = DOCUMENTS_URL) {
  await openDocumentsWorkspace(page, url);
  await page.getByRole('button', { name: 'New Document' }).click();
  await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
  await page
    .getByRole('button', { name: mode === 'template' ? /Create reusable template/ : /Upload and send PDF/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'New Document' })).toHaveCount(0);
}

module.exports = { DOCUMENTS_URL, openDocumentsWorkspace, openCreator };
