/**
 * `isE2ETestMode` switches on the browser suites' mock sign-in
 * (`?e2eAuth=super_admin`) and their fixtures. It holds only on a dev server
 * started with `VITE_E2E_TEST_MODE=1`, as Playwright starts it: a production
 * build is refused even when the variable is set by mistake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The module as a build with the stubbed variables would evaluate it. */
async function loadE2EMode() {
    vi.resetModules();
    return import('./e2eMode.js');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('isE2ETestMode', () => {
    it('is on for a dev server started with the E2E flag', async () => {
        vi.stubEnv('PROD', false);
        vi.stubEnv('VITE_E2E_TEST_MODE', '1');

        expect((await loadE2EMode()).isE2ETestMode).toBe(true);
    });

    it('is off for a production build, even with the E2E flag set', async () => {
        vi.stubEnv('PROD', true);
        vi.stubEnv('VITE_E2E_TEST_MODE', '1');

        expect((await loadE2EMode()).isE2ETestMode).toBe(false);
    });

    it('is off for a dev server without the flag', async () => {
        vi.stubEnv('PROD', false);
        vi.stubEnv('VITE_E2E_TEST_MODE', '');

        expect((await loadE2EMode()).isE2ETestMode).toBe(false);
    });
});
