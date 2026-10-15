import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { callableErrorText, serverReason } from './callableErrorText';

/**
 * Client for the Super Admin Release Management callables.
 *
 * ## What this client deliberately cannot do
 *
 * It cannot name a release. There is no parameter here that lets the browser
 * choose which commit reaches app.safehaul.io — the server resolves that itself
 * from GitHub Deployment records and re-verifies it before dispatching anything.
 *
 * `expectedSha` looks like an exception and is not. It is never used as the
 * thing to promote; it is compared against what the server independently
 * resolved, so that a stale confirmation dialog (a new Testing release landed
 * while the operator was reading it) is refused instead of quietly shipping
 * something they never approved. Sending a different value makes the request
 * fail — it cannot make it promote that value.
 *
 * No deployment credential exists on this side of the wire. Not in the bundle,
 * not in the payload, not in storage.
 */

/**
 * True when a failure means "re-enter your password", rather than a real
 * refusal.
 *
 * Releasing is a privileged action, so the backend requires the caller to have
 * authenticated within the last fifteen minutes — a silent token refresh does
 * not satisfy it. Re-exported from the vault client rather than re-derived here:
 * the sentinel it matches is one string produced by one guard, and two copies of
 * that check would eventually disagree about what counts as a stale session.
 */
export { isReauthCancelled, isReauthRequired, reauthenticateWithPassword, ReauthCancelledError } from './environmentVault';

/** User-facing text for a callable failure. */
export function describeReleaseError(error, fallback = 'That release action could not be completed.') {
    return callableErrorText(error, fallback, {
        'permission-denied': 'Super Admin access is required to manage releases.',
        'resource-exhausted': 'Too many release requests. Wait a moment and try again.',
        aborted: (failure) => serverReason(failure, 'A release is already running.'),
        unavailable: 'The deployment pipeline could not be reached. Try again in a moment.',
    });
}

export async function getReleaseStatus() {
    const call = httpsCallable(functions, 'getReleaseStatus');
    const result = await call({});
    return result.data;
}

/**
 * Release the tested version to Production.
 *
 * @param {object} options
 * @param {string} [options.expectedSha] the release the operator confirmed
 * @param {string} [options.reason] free text recorded in the audit trail
 */
export async function promoteTestingToProduction({ expectedSha, reason } = {}) {
    const call = httpsCallable(functions, 'promoteTestingToProduction');
    const result = await call({ expectedSha, reason });
    return result.data;
}

/**
 * Put Production back on the previous release.
 *
 * The server chooses which release that is, from its own records. This call
 * carries no version identifier at all.
 */
export async function rollbackProductionRelease({ expectedSha, reason } = {}) {
    const call = httpsCallable(functions, 'rollbackProductionRelease');
    const result = await call({ expectedSha, reason });
    return result.data;
}
