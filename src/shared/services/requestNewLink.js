/**
 * "Ask <Company> for a new link" on a public link that no longer works: asks the
 * server to tell the company (`functions/requestNewLink.js`). It makes no link;
 * the company sends one.
 *
 * The server answers `{ ok: true }` for any well-formed request, so the page
 * learns nothing about the link from it. It refuses with `resource-exhausted`
 * when this network asked too often. A browser test (`VITE_E2E_TEST_MODE`)
 * asks nothing: the public pages use their own mocks there.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';

/**
 * @param {{ kind: 'sign', companyId: string, requestId: string }
 *   | { kind: 'verify' | 'review', token: string }} input
 * @returns {Promise<{ ok: true }>} rejects with the callable's error
 */
export async function requestNewLink(input) {
    if (isE2ETestMode) return { ok: true };
    const ask = httpsCallable(functions, 'requestNewLink');
    await ask(input);
    return { ok: true };
}
