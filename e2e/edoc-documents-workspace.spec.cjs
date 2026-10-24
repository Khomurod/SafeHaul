// E2E coverage for the Documents workspace: the header, the four-view tab
// interface, the Overview default, the Sent Documents filters, the template
// library and the New Document choices.
//
// The e2eEdoc=mock harness seeds one artificial template ("E2E Test Document"),
// so the workspace can be exercised in a real browser without touching
// Firestore. No real template, recipient or signing data is loaded, and nothing
// here opens a send.
//
// The exact callbacks, ordering rules, required defaults and messages are
// covered by the vitest suites for DocumentsManager and each panel.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const URL = '/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock';

async function openDocuments(page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tablist', { name: 'Documents workspace views' })).toBeVisible();
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

test.describe('E-Doc Documents workspace', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens on Overview, not on a tool', async ({ page }) => {
    await openDocuments(page);

    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'At a glance' })).toBeVisible();
    await expect(
      page.getByText('Create, send, track and manage documents requiring completion or signature.'),
    ).toBeVisible();
  });

  test('offers New Document and Manage Templates in the header', async ({ page }) => {
    await openDocuments(page);
    await expect(page.getByRole('button', { name: 'New Document' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage Templates' })).toBeVisible();
  });

  test('switches between all four views through the tab interface', async ({ page }) => {
    await openDocuments(page);

    await tab(page, 'Sent Documents').click();
    await expect(tab(page, 'Sent Documents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('searchbox', { name: 'Search documents or recipients' })).toBeVisible();

    await tab(page, 'Templates').click();
    await expect(page.getByRole('region', { name: 'Template library' })).toBeVisible();

    await tab(page, 'Application Forms').click();
    await expect(page.getByRole('heading', { name: 'Forms shown after an application' })).toBeVisible();

    await tab(page, 'Overview').click();
    await expect(page.getByRole('region', { name: 'At a glance' })).toBeVisible();
  });

  test('drives the tabs from the keyboard with focus following selection', async ({ page }) => {
    await openDocuments(page);

    await tab(page, 'Overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Sent Documents')).toBeFocused();
    await expect(tab(page, 'Sent Documents')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(tab(page, 'Application Forms')).toBeFocused();
    await expect(tab(page, 'Application Forms')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(tab(page, 'Overview')).toBeFocused();
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  });

  /*
   * The approved `TabList`, and its `aria-controls` shape is deliberate rather
   * than incidental.
   *
   * This workspace renders **one** panel — the selected tab's — so the three
   * unselected tabs have no panel in the document to control. Pointing all four
   * at the single panel's id would be three references to something that is
   * not theirs; the primitive sets `aria-controls` on the selected tab only,
   * because an `aria-controls` naming an element that does not exist is worse
   * than its absence (the APG says as much for a lazily rendered panel).
   *
   * So the contract is: the selected tab points at the rendered panel, the panel
   * points back at it, and the others point at nothing. Asserting all three
   * halves is what stops this being read as a regression later.
   */
  test('connects the selected tab to the one rendered panel, and only that tab', async ({ page }) => {
    await openDocuments(page);
    const panel = page.getByRole('tabpanel');
    const panelId = await panel.getAttribute('id');
    expect(panelId).toBeTruthy();

    await expect(tab(page, 'Overview')).toHaveAttribute('aria-controls', panelId);
    await expect(panel).toHaveAttribute('aria-labelledby', String(await tab(page, 'Overview').getAttribute('id')));

    for (const name of ['Sent Documents', 'Templates', 'Application Forms']) {
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'false');
      await expect(tab(page, name)).not.toHaveAttribute('aria-controls', /./);
    }

    // …and the association follows the selection rather than being fixed to one
    // tab: activating another makes it the one that points at the panel.
    await tab(page, 'Templates').click();
    const nextPanelId = await page.getByRole('tabpanel').getAttribute('id');
    await expect(tab(page, 'Templates')).toHaveAttribute('aria-controls', nextPanelId);
    await expect(tab(page, 'Overview')).not.toHaveAttribute('aria-controls', /./);
  });

  test('offers exactly three ways to start a new document', async ({ page }) => {
    await openDocuments(page);
    await page.getByRole('button', { name: 'New Document' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Document' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: /Send from template/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Upload and send PDF/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Create reusable template/ })).toBeVisible();
  });

  test('sends the template choice to the template library', async ({ page }) => {
    await openDocuments(page);
    await page.getByRole('button', { name: 'New Document' }).click();
    await page.getByRole('button', { name: /Send from template/ }).click();

    await expect(tab(page, 'Templates')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Send E2E Test Document' })).toBeVisible();
  });

  test('shows the template card actions without hover', async ({ page }) => {
    await openDocuments(page);
    await tab(page, 'Templates').click();

    // The mock harness seeds exactly one artificial template.
    for (const action of ['Send', 'Edit', 'Duplicate', 'Configure', 'Delete']) {
      await expect(page.getByRole('button', { name: `${action} E2E Test Document` })).toBeVisible();
    }
    await expect(page.getByText('2 fields')).toBeVisible();
  });

  // The made-up sent documents (`e2eEdocSent=mock`): six, two signed, two with
  // a failure that needs attention.
  test('narrows sent documents from one row of controls, the count beside the heading', async ({ page }) => {
    await page.goto(`${URL}&e2eEdocSent=mock`);
    await tab(page, 'Sent Documents').click();
    const count = page.locator('header [role="status"]');
    await expect(count).toHaveText(/^6\s*sent documents$/, { timeout: 20_000 });

    await page.getByRole('searchbox', { name: 'Search documents or recipients' }).fill('W-9');
    await expect(count).toHaveText(/^1\s*sent document$/);
    await page.getByRole('searchbox', { name: 'Search documents or recipients' }).fill('');

    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Status').selectOption('signed');
    await expect(count).toHaveText(/^2\s*sent documents$/);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(/^6\s*sent documents$/);
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();

    await page.getByRole('switch', { name: 'Needs attention only' }).click();
    await expect(count).toHaveText(/^2\s*sent documents$/);
    const table = page.getByRole('table', { name: /^Document history/ });
    await expect(table.getByText('Drug and Alcohol Policy Acknowledgement')).toBeVisible();
    await expect(table.getByText('Lease Agreement')).toBeVisible();
  });

  test('keeps Application Forms configuration in its own view', async ({ page }) => {
    await openDocuments(page);
    await tab(page, 'Application Forms').click();

    await expect(page.getByRole('button', { name: /Save forms/ })).toBeEnabled();
    await expect(page.getByText('No follow-up forms enabled yet.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'E2E Test Document' })).toBeVisible();

    // The template library no longer carries this configuration.
    await tab(page, 'Templates').click();
    await expect(page.getByRole('button', { name: /Save forms/ })).toHaveCount(0);
  });

  test('does not overflow the document at desktop/tablet/mobile @mobile', async ({ page }, testInfo) => {
    const widths = testInfo.project.name.startsWith('mobile') ? [412] : [1440, 1024];
    await page.setViewportSize({ width: widths[0], height: widths[0] === 412 ? 915 : 900 });
    await openDocuments(page);
    await tab(page, 'Templates').click();
    await expect(page.getByRole('button', { name: 'Send E2E Test Document' })).toBeVisible();

    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
      await expect(tab(page, 'Templates')).toBeVisible();
      await expect(tab(page, 'Overview')).toBeVisible();
    }
  });

  test('has no serious/critical or contrast violations on any view @a11y', async ({ page }) => {
    await openDocuments(page);

    const check = async () => {
      const { violations } = await new AxeBuilder({ page })
        .include('[role="tablist"]')
        .include('[role="tabpanel"]')
        .analyze();
      const serious = violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}`);
      expect(serious).toEqual([]);
      expect(violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
    };

    await check();

    await tab(page, 'Sent Documents').click();
    await expect(page.getByRole('searchbox', { name: 'Search documents or recipients' })).toBeVisible();
    await check();

    await tab(page, 'Templates').click();
    await expect(page.getByRole('button', { name: 'Send E2E Test Document' })).toBeVisible();
    await check();

    await tab(page, 'Application Forms').click();
    await expect(page.getByRole('button', { name: /Save forms/ })).toBeVisible();
    await check();
  });
});
