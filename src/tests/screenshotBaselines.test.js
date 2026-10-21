import { describe, expect, it } from 'vitest';
import { planBaselines } from '../../scripts/lib/screenshotBaselines.mjs';

const SPECS = ['app.spec.cjs', 'catalog.spec.cjs'];
const shot = (folder, name, hash) => ({ path: `test-results/${folder}/${name}-actual.png`, hash });

describe('planBaselines', () => {
    it('maps each actual render to its spec baseline', () => {
        const plan = planBaselines([
            shot('app--visual-application-screens-super-admin-desktop-visual', 'super-admin-desktop', 'a'),
            shot('catalog-button-variants-visual', 'button-variants', 'b'),
        ], SPECS);
        expect(plan).toEqual({
            updates: [
                { from: 'test-results/app--visual-application-screens-super-admin-desktop-visual/super-admin-desktop-actual.png', to: 'e2e/visual/__screenshots__/app.spec.cjs/super-admin-desktop.png' },
                { from: 'test-results/catalog-button-variants-visual/button-variants-actual.png', to: 'e2e/visual/__screenshots__/catalog.spec.cjs/button-variants.png' },
            ],
            unstable: [],
        });
    });

    it('takes a snapshot once when every attempt rendered the same bytes', () => {
        const plan = planBaselines([
            shot('app--visual-login-visual', 'login-desktop', 'same'),
            shot('app--visual-login-visual-retry1', 'login-desktop', 'same'),
            shot('app--visual-login-visual-retry2', 'login-desktop', 'same'),
        ], SPECS);
        expect(plan.updates).toHaveLength(1);
        expect(plan.unstable).toEqual([]);
    });

    it('leaves a snapshot alone when its attempts differ', () => {
        const plan = planBaselines([
            shot('app--visual-login-visual', 'login-desktop', 'one'),
            shot('app--visual-login-visual-retry1', 'login-desktop', 'two'),
        ], SPECS);
        expect(plan).toEqual({ updates: [], unstable: ['e2e/visual/__screenshots__/app.spec.cjs/login-desktop.png'] });
    });

    it('ignores expected and diff images, the HTML report and unknown specs', () => {
        const plan = planBaselines([
            { path: 'test-results/app--visual-login-visual/login-desktop-expected.png', hash: 'x' },
            { path: 'test-results/app--visual-login-visual/login-desktop-diff.png', hash: 'x' },
            { path: 'playwright-report/data/0a1b-actual.png', hash: 'x' },
            shot('other-thing-visual', 'other', 'x'),
        ], SPECS);
        expect(plan).toEqual({ updates: [], unstable: [] });
    });
});
