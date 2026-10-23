import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

/**
 * The Socrata app token for the FMCSA census. A browser test asks for a
 * placeholder with `?e2eSafer=mock` and answers the lookup's requests itself; a
 * production build never takes one. `''` when there is none: callers then skip
 * the lookup.
 */
export function fmcsaLookupToken() {
    const token = import.meta.env.VITE_SOCRATA_APP_TOKEN;
    if (token) return token;
    const mocked = isE2ETestMode && !import.meta.env.PROD && getE2EQueryParam('e2eSafer', '') === 'mock';
    return mocked ? 'e2e-placeholder' : '';
}
