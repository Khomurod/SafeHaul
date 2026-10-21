import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { callableErrorText } from './callableErrorText';

/**
 * Client for `dataCleanup` (Super Admin → Maintenance → Data cleanup).
 *
 * `check` counts and writes nothing; `run` changes the data and needs a recent
 * sign-in (the screen's `useReauthGuard` asks for the password). A run stops
 * inside the server's time budget and answers `done: false` when work is left.
 * The timeout is the function's own 540 seconds, so the screen never gives up
 * on a run the server is still finishing.
 */

export { isReauthCancelled } from './environmentVault';

export const DATA_CLEANUP_TIMEOUT_MS = 540000;

/**
 * @param {'check'|'run'} mode
 * @param {string} item one of `DATA_CLEANUP_ITEMS`' ids
 * @returns {Promise<{ item: string, mode: string, done: boolean, total: number,
 *   counts: Record<string, number>, notes?: Record<string, string[]> }>}
 */
export async function callDataCleanup(mode, item) {
    // The name written out in full: `check-callable-contract.mjs` finds it by that literal.
    const call = httpsCallable(functions, 'dataCleanup', { timeout: DATA_CLEANUP_TIMEOUT_MS });
    return (await call({ mode, item })).data;
}

/** The operator's sentence for a failed check or run. */
export function describeCleanupError(error) {
    return callableErrorText(error, 'The cleanup could not be completed. Press Check to see what is left.', {
        'deadline-exceeded': 'The server took too long to answer. Press Check to see what is left.',
    });
}
