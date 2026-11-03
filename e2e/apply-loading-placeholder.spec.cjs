const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { APPLY_SCREEN_CODE, holdRequests } = require('./helpers/holdRequest.cjs');

/**
 * While the driver application's code downloads, the page shows one grey outline
 * of its start screen, not a chain of different "Loading" screens.
 *
 * The screen's code is held at the network edge, so the route-code wait stays on
 * screen. The session check cannot be held here: in browser-test mode the session
 * settles in the provider's first effect. `RouteLoadingFallback.test.jsx` and
 * `DataContext.test.jsx` cover that wait.
 */
test.describe('driver application loading placeholder', () => {
    test.describe.configure({ timeout: 90_000 });

    test('shows one placeholder until the start screen is ready @mobile', async ({ page }) => {
        const hold = await holdRequests(page, APPLY_SCREEN_CODE);
        await page.goto('/apply/e2e-company?e2eIntake=choice');

        const placeholder = page.getByRole('main', { name: 'Loading Application...' });
        await expect(placeholder).toBeVisible();
        // Not busy: a busy region may hold back its own status announcement.
        await expect(placeholder).not.toHaveAttribute('aria-busy');
        expect(hold.matched()).toBeGreaterThan(0);
        // React's first render replaced `index.html`'s start-up splash: one picture, not two.
        await expect(page.locator('#startup-splash')).toHaveCount(0);

        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Loading Platform...')).toHaveCount(0);

        const { violations } = await new AxeBuilder({ page }).analyze();
        const severe = violations
            .filter((violation) => ['serious', 'critical'].includes(violation.impact))
            .map((violation) => `${violation.id} [${violation.impact}]`);
        expect(severe).toEqual([]);

        // The component's own class is its chrome contract, not a styling utility.
        const shape = page.locator('.ds-skeleton').first();
        const animationName = () => shape.evaluate((node) => getComputedStyle(node).animationName);
        expect(await animationName()).not.toBe('none');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await animationName()).toBe('none');

        hold.release();
        await expect(page.getByRole('button', { name: /Fill Out Manually/ })).toBeVisible();
        await expect(placeholder).toHaveCount(0);
    });
});
