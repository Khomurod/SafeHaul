/**
 * Client for the website-lead archive callable.
 *
 * ## What this replaced
 *
 * `landingSettings.js` wrapped seven callables for Super Admin → Landing Page
 * Settings: reading masked Telegram configuration, saving it, toggling delivery,
 * sending a test message, listing leads and retrying a failed delivery. The
 * marketing site is gone and all of that is retired by owner decision — **except
 * the leads, which were kept.** One call survives.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Turns a callable error into something a screen can show.
 *
 * Kept from the settings client, and for the reason it was written: the codes
 * come from the server and never carry any part of a stored value, so the
 * message shown to an operator cannot leak a lead's contact details.
 */
export function describeLeadsError(error, fallback = 'That operation could not be completed.') {
    const code = error?.code || '';
    if (code.includes('unauthenticated')) return 'Sign in again to continue.';
    if (code.includes('permission-denied')) return 'Only a super admin can view captured leads.';
    if (code.includes('resource-exhausted')) return 'Too many requests. Wait a moment and try again.';
    return error?.message || fallback;
}

/**
 * Lists archived leads, newest first.
 *
 * The server caps this at 200 however high the argument goes; the screen asks for
 * that cap because the archive is read whole, including for the CSV export.
 */
export async function listWebsiteLeads(limit = 200) {
    const call = httpsCallable(functions, 'listLandingLeads');
    const { data } = await call({ limit });
    return Array.isArray(data?.leads) ? data.leads : [];
}
