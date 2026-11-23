import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/*
 * Finishing a Gmail connection when Google sends the admin back to
 * `/oauth/google/callback` (`GmailReturnScreen` shows the outcome). Nothing
 * here logs the code or the state: a failure is logged by its code only.
 */

export const GMAIL_RETURN_EXPIRED = 'This Gmail connection expired. Start again from Settings → Email.';
export const GMAIL_RETURN_REFUSED = 'Google did not connect Gmail. Start again from Settings → Email.';

/** What Google put in the address: the one-time `code` and `state`, or an `error`. */
export function readGmailReturn(search) {
    const params = new URLSearchParams(search);
    return {
        code: params.get('code') || '',
        state: params.get('state') || '',
        error: params.get('error') || '',
    };
}

/**
 * The one call per return. The code works once, so every mount of the page for
 * the same `state` (StrictMode's rehearsal, a remount) shares the first call
 * and its outcome, which never rejects. It lives here, outside any component,
 * so it outlasts the mount that started it.
 */
let finishing = null;

function finish(state, code) {
    if (finishing?.state === state) return finishing.outcome;
    const entry = { state, settled: false };
    entry.outcome = httpsCallable(functions, 'completeGmailConnection')({ state, code })
        .then(
            ({ data }) => ({ kind: 'connected', email: typeof data?.email === 'string' ? data.email : '' }),
            (error) => {
                console.warn('[gmailReturn] Gmail was not connected:', error?.code || 'error');
                // The server's refusals are sentences for the admin, its `internal` one too.
                return { kind: 'failed', message: plainErrorMessage(error, 'Gmail could not be connected.', { trustInternal: true }) };
            },
        )
        .then((outcome) => {
            entry.settled = true;
            return outcome;
        });
    finishing = entry;
    return entry.outcome;
}

/**
 * What a return comes to, from `readGmailReturn`'s fields: `connected` (with
 * the Gmail address), `cancelled` at Google, `failed` (with the sentence to
 * show), or `nothing` to finish. It never rejects.
 */
export function gmailReturnOutcome({ code, state, error }) {
    if (error === 'access_denied') return Promise.resolve({ kind: 'cancelled' });
    if (error) return Promise.resolve({ kind: 'failed', message: GMAIL_RETURN_REFUSED });
    if (code && state) return finish(state, code);
    if (code || state) return Promise.resolve({ kind: 'failed', message: GMAIL_RETURN_EXPIRED });
    // An address already cleared (Back, or a remount): a call still running is this return's.
    if (finishing && !finishing.settled) return finishing.outcome;
    return Promise.resolve({ kind: 'nothing' });
}
