import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { callableErrorText, serverMessage } from './callableErrorText';

/**
 * Client for the Telegram alert callables (Super Admin → System Health).
 *
 * The same backend guards as the other consoles, so the same client shape:
 * re-authentication detection and its cancellation type come from
 * `./environmentVault.js` rather than a copy. The bot token goes up once, in
 * `savePlatformAlertToken`, and no response ever brings it, or the chat id, back.
 */

export { isReauthCancelled, isReauthRequired, ReauthCancelledError } from './environmentVault';

/** The server's own sentence where it wrote one for the operator, else the caller's. */
export function describeAlertsError(error, fallback = 'That operation could not be completed.') {
    return callableErrorText(error, fallback, {
        'invalid-argument': serverMessage,
        'failed-precondition': serverMessage,
        'resource-exhausted': serverMessage,
        unavailable: serverMessage,
    });
}

// Each name written out in full: `check-callable-contract.mjs` and the release
// health check find the callables a screen uses by that literal.
export async function getPlatformAlerts() {
    return (await httpsCallable(functions, 'getPlatformAlerts')({})).data;
}

export async function savePlatformAlertToken(token) {
    return (await httpsCallable(functions, 'savePlatformAlertToken')({ token })).data;
}

/**
 * A press hands out a one-time Start link, or connects the chat that used it.
 * `checkOnly` is the page asking by itself while its link waits: it never hands
 * out a link, and needs no recent sign-in. `chatShown` is whether the page showed
 * a chat when pressed: one that connected meanwhile answers a Connect chat press.
 */
export async function connectPlatformAlertChat({ checkOnly = false, chatShown } = {}) {
    let payload = {};
    if (checkOnly) payload = { checkOnly: true };
    else if (typeof chatShown === 'boolean') payload = { chatShown };
    return (await httpsCallable(functions, 'connectPlatformAlertChat')(payload)).data;
}

export async function sendPlatformAlertTest() {
    return (await httpsCallable(functions, 'sendPlatformAlertTest')({})).data;
}

export async function deletePlatformAlerts() {
    return (await httpsCallable(functions, 'deletePlatformAlerts')({})).data;
}
