// Shared harness for the PEVRequestModal suites: the env/fetch stubs the
// original `beforeEach`/`afterEach` installed, and the base employer fixture.
// Nothing here is mocked at module level — the modal runs for real against a
// stubbed `fetch` — so this module carries no `*Mock()` factories.
import { vi } from 'vitest';

/** The original `beforeEach` body, verbatim, for each suite to call. */
export function stubHarness() {
    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', 'test-token');
    vi.stubGlobal(
        'fetch',
        vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
        ),
    );
}

/** The original `afterEach` body, verbatim, for each suite to call. */
export async function restoreHarness() {
    await new Promise((r) => {
        setTimeout(r, 0);
    });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
}

export const baseEmployer = {

  companyName: 'Swift Transportation',

  companyEmail: '',

  email: '',

  fax: '',

  phone: '',

};


