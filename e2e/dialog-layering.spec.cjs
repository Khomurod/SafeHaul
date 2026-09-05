// The stacking scale, checked in a real browser against the real stylesheet.
//
// `WorkspaceFrame`'s mobile navigation drawer read `--ds-z-modal` (60) until
// 2026-09-05, which is the dialog layer — so in the CSS the drawer outranked
// every `<Modal>`, and nine hand-written `z-[60]`, `z-[70]` and `z-[9999]`
// overlays across the tree existed because each new thing that had to sit on
// top picked a number bigger than whatever it had lost to.
//
// **What this does NOT claim.** The drawer-over-dialog conflict is not
// reachable through the company workspace UI today: while the drawer is open
// its backdrop covers every page control, and nothing rendered inside the
// drawer opens a dialog — both verified while writing this. So the ordering was
// wrong rather than visibly broken, and what is fixed is a trap: any future
// "open a dialog from the navigation" would have fallen into it, and the
// escalation war above shows what that costs. Saying so is better than claiming
// a user-visible bug that cannot be demonstrated.
//
// It runs in the `chromium` project deliberately. CI runs `--project=chromium`
// only (`main.yml`), so the mobile-gated style the other shell tests use
// (`test.skip(!testInfo.project.name.startsWith('mobile'))`) would never gate
// anything. The drawer's rules apply below 768px, so the viewport is set here.
const { test, expect } = require('@playwright/test');

const MOBILE = { width: 412, height: 915 };
const DASHBOARD_URL = '/company/dashboard?e2eAuth=company_admin';

const LAYERS = ['raised', 'sticky', 'dropdown', 'drawer-backdrop', 'drawer', 'modal', 'toast'];

test.describe('Stacking layers', () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize(MOBILE);
        await page.goto(DASHBOARD_URL);
        await expect(page.locator('.ds-workspace__navigation')).toBeAttached();
    });

    test('resolve in order, with the drawer below the dialog layer', async ({ page }) => {
        const layers = await page.evaluate((roles) => {
            const style = getComputedStyle(document.documentElement);
            return roles.map((role) => Number(style.getPropertyValue(`--ds-z-${role}`).trim()));
        }, LAYERS);

        expect(layers.every(Number.isFinite), `unresolved layer in ${JSON.stringify(layers)}`).toBe(true);
        expect(layers).toEqual([...layers].sort((a, b) => a - b));
        expect(new Set(layers).size).toBe(layers.length);

        const drawer = layers[LAYERS.indexOf('drawer')];
        const modal = layers[LAYERS.indexOf('modal')];
        expect(drawer, 'the drawer must not reach the dialog layer').toBeLessThan(modal);
    });

    test('the drawer element reads the drawer layer, not the dialog one', async ({ page }) => {
        // The computed value, not the declaration: a media query, a later rule or
        // a stale utility class could each put it back on 60 without the token
        // changing, and that is the regression this exists for.
        const [drawerZ, expected] = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return [
                getComputedStyle(document.querySelector('.ds-workspace__navigation')).zIndex,
                style.getPropertyValue('--ds-z-drawer').trim(),
            ];
        });
        expect(drawerZ).toBe(expected);
    });

    test('the drawer precedes the main region, so a tie is resolved in the dialog\'s favour', async ({ page }) => {
        // Until every call site is on the chrome contract, some overlays still
        // write a bare `z-50` — the same layer as the drawer. Painting order then
        // comes down to document order, and this is the property that makes the
        // intermediate state safe rather than lucky.
        const order = await page.evaluate(() => {
            const drawer = document.querySelector('.ds-workspace__navigation');
            const main = document.querySelector('.ds-workspace__main');
            if (!drawer || !main) return null;
            // eslint-disable-next-line no-bitwise
            return Boolean(drawer.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(order, 'the drawer must come before the main region').toBe(true);
    });

    test('the drawer backdrop sits below the drawer it dims', async ({ page }) => {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        const drawer = page.locator('.ds-workspace__navigation');
        await expect(drawer).toHaveAttribute('data-open', 'true');

        const [backdropZ, drawerZ] = await page.evaluate(() => [
            getComputedStyle(document.querySelector('.ds-workspace__backdrop')).zIndex,
            getComputedStyle(document.querySelector('.ds-workspace__navigation')).zIndex,
        ]);
        expect(Number(backdropZ)).toBeLessThan(Number(drawerZ));
    });
});
