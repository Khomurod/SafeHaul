const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/**
 * Driver Dossier foundation evidence.
 *
 * Covers the dossier *shell* — the dialog, its section navigation, its page
 * states and its responsive layout — at 1440 / 1024 / 412 px and on the
 * Mobile Chrome lane.
 *
 * KNOWN LIMIT, stated so nobody reads more into a green run than is there:
 * under `VITE_E2E_TEST_MODE=1` Firestore is deliberately unreachable, so
 * `useAppFetch` resolves to the dossier's **error** state. That is genuinely
 * useful here (the loading → error page-state transition is real, and the shell,
 * navigation, header actions and responsive layout all render regardless), but
 * it means the application summary, the document gallery and the document
 * preview cannot be exercised end-to-end. Those surfaces are covered by the
 * focused contract tests in
 * `src/features/company-admin/components/modals/driver-dossier/`.
 */

const AUTH = '?e2eAuth=company_admin';
const ROW_NAME = 'Open driver dossier for Maria Garcia';
const DIALOG = { name: 'Driver dossier' };

const SECTIONS = [
  ['Application', 'Application Review'],
  ['Documents', 'Document Gallery'],
  ['DQ File', 'Driver Qualification File'],
  ['Previous Employment', 'Previous Employment Verification'],
  ['Activity', 'Activity Timeline'],
  ['Notes', 'Internal Notes'],
];

/** Every action a user needs to leave, export or act on the dossier. */
const ESSENTIAL_ACTIONS = [
  'Close driver dossier',
  'Download application PDF',
  'Delete application',
];

async function openList(page) {
  await page.goto(`/company/drivers/applications${AUTH}`);
  await expect(page.getByRole('table', { name: 'Driver Applications table' })).toBeVisible();
}

async function openDossier(page) {
  const row = page.getByRole('row', { name: ROW_NAME });
  await row.click();
  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
  return row;
}

/** The document must never scroll horizontally; scoped regions may. */
async function expectNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      // The dialog panel is `overflow-hidden`, so anything wider than its own
      // client width is not merely scrolled off — it is clipped and gone.
      panelScroll: dlg ? dlg.scrollWidth : 0,
      panelClient: dlg ? dlg.clientWidth : 0,
    };
  });
  expect(metrics.docScroll, `${label}: document overflows horizontally`)
    .toBeLessThanOrEqual(metrics.docClient + 1);
  expect(metrics.panelScroll, `${label}: dialog panel clips its own content`)
    .toBeLessThanOrEqual(metrics.panelClient + 1);
}

/** Actions clipped outside the viewport are unusable, not merely ugly. */
async function offscreenActions(page) {
  return page.evaluate((names) => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
    const out = [];
    for (const name of names) {
      const el = dlg.querySelector(`[aria-label="${name}"]`);
      if (!el) { out.push(`${name}: missing`); continue; }
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) { out.push(`${name}: zero size`); continue; }
      if (b.left < -0.5 || b.right > window.innerWidth + 0.5) {
        out.push(`${name}: ${Math.round(b.left)}–${Math.round(b.right)} outside 0–${window.innerWidth}`);
      }
    }
    return out;
  }, ESSENTIAL_ACTIONS);
}

/** No interface text below the 12 px floor anywhere in the dossier. */
async function undersizedText(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
    const out = [];
    for (const el of dlg.querySelectorAll('*')) {
      if (!el.textContent || !el.textContent.trim()) continue;
      if (el.children.length > 0) continue;
      if (el.classList.contains('ds-visually-hidden')) continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size && size < 12) out.push(`${el.tagName} ${size}px "${el.textContent.trim().slice(0, 30)}"`);
    }
    return out;
  });
}

test.describe('Driver Dossier shell', () => {
  test.describe.configure({ timeout: 120_000 });

  test('opens with focus inside the dialog and never on the tel: link', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    const state = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
      const active = document.activeElement;
      return {
        inside: dlg.contains(active),
        activeRole: active.getAttribute('role'),
        onTelLink: active.tagName === 'A' && (active.getAttribute('href') || '').startsWith('tel:'),
      };
    });

    expect(state.inside).toBe(true);
    // Regression: `Modal` focuses the first focusable child by default, which in
    // DOM order is the sidebar's `tel:` link — Enter would have dialled.
    expect(state.onTelLink).toBe(false);
    expect(state.activeRole).toBe('tabpanel');
  });

  test('restores focus to the row it was opened from', async ({ page }) => {
    await openList(page);
    // Opened from the keyboard, so the row really is the previously-focused
    // element. Escape is handled on the dialog panel, so focus has to still be
    // inside the dialog when it is pressed — which the focus trap guarantees.
    const row = page.getByRole('row', { name: ROW_NAME });
    await row.focus();
    await row.press('Enter');
    await expect(page.getByRole('dialog', DIALOG)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);

    const restored = await page.evaluate(
      (name) => document.activeElement.getAttribute('aria-label') === name,
      ROW_NAME,
    );
    expect(restored).toBe(true);
  });

  test('exposes a real tablist and walks it with Arrow, Home and End', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    const tablist = page.getByRole('tablist', { name: 'Driver dossier sections' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab')).toHaveCount(SECTIONS.length);

    const selected = () => page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
      const tab = [...dlg.querySelectorAll('[role="tab"]')]
        .find((t) => t.getAttribute('aria-selected') === 'true');
      const panel = dlg.querySelector('[role="tabpanel"]');
      return {
        label: tab.textContent.replace(/\s*\(selected\)\s*/, '').trim(),
        focused: document.activeElement === tab,
        panelMatchesTab: panel.getAttribute('aria-labelledby') === tab.id,
      };
    });

    await page.getByRole('tab', { name: /^Application/ }).focus();

    // Automatic activation: each arrow both moves focus and selects, so the
    // panel and its title always match the focused tab.
    for (const [label, title] of SECTIONS.slice(1)) {
      await page.keyboard.press('ArrowDown');
      const state = await selected();
      expect(state.label, `ArrowDown should select ${label}`).toBe(label);
      expect(state.focused).toBe(true);
      expect(state.panelMatchesTab).toBe(true);
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }

    await page.keyboard.press('ArrowDown');
    expect((await selected()).label, 'wraps past the last tab').toBe('Application');

    await page.keyboard.press('ArrowUp');
    expect((await selected()).label, 'wraps back past the first tab').toBe('Notes');

    await page.keyboard.press('Home');
    expect((await selected()).label).toBe('Application');

    await page.keyboard.press('End');
    expect((await selected()).label).toBe('Notes');
  });

  test('keeps every section reachable and titled', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    // The DQ, Previous Employment, Activity and Notes bodies are deliberately
    // NOT migrated; this asserts only that the shell still reaches them.
    for (const [label, title] of SECTIONS) {
      await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
  });

  test('never leaves the tab panel silently blank', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    // Deliberately NOT asserting the error state specifically. Firestore is
    // unreachable in E2E mode, but *how* it fails is environment-dependent: it
    // errors out in some runs and stays pending in others. What must hold in
    // every run is that the panel always says something, and that whatever it
    // says is announced.
    const state = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      const live = panel.querySelector('[role="status"], [role="alert"]');
      return {
        text: panel.textContent.trim(),
        liveRole: live && live.getAttribute('role'),
        liveText: live && live.textContent.trim(),
      };
    });

    expect(state.text, 'the tab panel rendered nothing at all').not.toBe('');
    expect(['status', 'alert'], 'the panel state is not announced').toContain(state.liveRole);
    expect(state.liveText).toMatch(/Loading driver dossier|Error loading application details|not available/);
  });

  test('raises and dismisses the delete confirmation without closing the dossier', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    const deleteAction = page.getByRole('button', { name: 'Delete application' });
    await deleteAction.focus();
    await deleteAction.click();

    const confirm = page.getByRole('dialog', { name: 'Delete this application?' });
    await expect(confirm).toBeVisible();
    // Destructive dialogs open on the least destructive action.
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    // Escape belongs to the topmost dialog only.
    await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
    await expect(deleteAction).toBeFocused();
  });

  test('has no axe violations in the dossier or its confirmation', async ({ page }) => {
    await openList(page);
    await openDossier(page);

    const dossier = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-label="Driver dossier"]')
      .analyze();
    expect(dossier.violations.map((v) => v.id)).toEqual([]);

    await page.getByRole('button', { name: 'Delete application' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete this application?' })).toBeVisible();

    const confirmScan = await new AxeBuilder({ page })
      .include('[aria-labelledby="delete-app-title"]')
      .analyze();
    expect(confirmScan.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('Driver Dossier responsive presentation', () => {
  test.describe.configure({ timeout: 120_000 });

  const WIDTHS = [
    { name: 'desktop 1440', width: 1440, height: 900 },
    { name: 'tablet 1024', width: 1024, height: 768 },
    { name: 'mobile 412', width: 412, height: 915 },
  ];

  for (const { name, width, height } of WIDTHS) {
    test(`no clipping and no hidden actions at ${name}`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name.startsWith('mobile'),
        'Device-emulation lanes own their own viewport; this test sets one explicitly.',
      );
      await page.setViewportSize({ width, height });
      await openList(page);
      await openDossier(page);

      await expectNoHorizontalOverflow(page, name);
      // REGRESSION: at 412 px the header action group was `shrink-0`, so
      // `flex-wrap` never engaged, the group stayed 489 px wide inside a 412 px
      // panel, and Close and Delete were clipped away entirely — leaving a phone
      // user, who has no Escape key, with no way to close the dossier.
      expect(await offscreenActions(page), `${name}: essential action off-screen`).toEqual([]);
      expect(await undersizedText(page), `${name}: text below 12px`).toEqual([]);

      // The section navigation has to survive the layout change too.
      await expect(page.getByRole('tablist', { name: 'Driver dossier sections' })).toBeVisible();
      await page.getByRole('tab', { name: /^Documents/ }).click();
      await expect(page.getByRole('heading', { name: 'Document Gallery' })).toBeVisible();
      await expectNoHorizontalOverflow(page, `${name} documents`);
    });
  }
});

test.describe('Driver Dossier on a real mobile device lane', () => {
  test.describe.configure({ timeout: 120_000 });

  test('is usable end to end on Mobile Chrome', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Device-emulation lanes only.');

    await openList(page);
    await openDossier(page);

    // Full-screen sheet below `sm`, and the navigation becomes a horizontal
    // strip — same DOM order, so the tab sequence never changes.
    const layout = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Driver dossier"]');
      const tablist = dlg.querySelector('[role="tablist"]');
      return {
        orientation: tablist.getAttribute('aria-orientation'),
        flexDirection: getComputedStyle(tablist).flexDirection,
        panelWidth: Math.round(dlg.getBoundingClientRect().width),
        viewport: window.innerWidth,
      };
    });
    expect(layout.panelWidth).toBe(layout.viewport);
    // `useCompactViewport` and the CSS must agree about which layout is on
    // screen, or `aria-orientation` describes something the user cannot see.
    expect(layout.flexDirection).toBe('row');
    expect(layout.orientation).toBe('horizontal');

    expect(await offscreenActions(page), 'essential action off-screen on mobile').toEqual([]);
    await expectNoHorizontalOverflow(page, 'mobile-chrome');
    expect(await undersizedText(page), 'text below 12px on mobile').toEqual([]);

    // Every section must still be reachable by touch on the scrolling strip.
    for (const [label, title] of SECTIONS) {
      await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }

    const scan = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-label="Driver dossier"]')
      .analyze();
    expect(scan.violations.map((v) => v.id)).toEqual([]);

    // The close action is the only exit on a device with no Escape key.
    await page.getByRole('button', { name: 'Close driver dossier' }).click();
    await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
  });
});
