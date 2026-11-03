/**
 * A short-lived link to a file a driver uploaded with their application.
 *
 * Signed server-side by `getSignedApplicationFileUrl`, which accepts only a
 * driver-upload path of a company the caller may access. A signed URL is a
 * capability, so it is never persisted — the same reasoning `useGuestFileUpload`
 * gives for storing only the `storagePath`. The dossier reuses one in memory for
 * ten minutes, in this tab and sign-in (`reusableApplicationFileUrl`); a press
 * always signs afresh (`signedApplicationFileUrl`).
 */
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@lib/firebase';
import { isPevRequestPath } from './pevRequestPath';

/**
 * @param {string} storagePath e.g. `companies/{id}/applications/guest_uploads/…`
 * @returns {Promise<string>} a URL that opens the file
 */
export async function signedApplicationFileUrl(storagePath) {
    // The request PDF a verification sent lives in the PEV folders, which `getSignedPevUrl` signs.
    // Both names stay literal: `scripts/check-callable-contract.mjs` finds callables by them.
    const resign = isPevRequestPath(storagePath)
        ? httpsCallable(functions, 'getSignedPevUrl')
        : httpsCallable(functions, 'getSignedApplicationFileUrl');
    const { data } = await resign({ storagePath });
    if (!data?.url) throw new Error('No link was returned for this file.');
    return data.url;
}

/** Links live an hour (`functions/shared/signReadUrl.js`); reusing one for ten
 *  minutes leaves every link shown at least fifty. */
export const FILE_LINK_REUSE_MS = 10 * 60 * 1000;

/** `storagePath` -> the signing in flight or done; a failed one is removed. Memory only. */
const reusable = new Map();
/** The `auth.currentUser` the held links were signed for: a new object at each sign-in. */
let reusableFor = null;

/**
 * The dossier's link for a file: signed once, then reused for ten minutes in
 * this tab and sign-in. When `auth.currentUser` has changed since (another
 * sign-in or a sign-out), every held link is dropped before anything is reused.
 *
 * @param {string} storagePath
 * @returns {Promise<string>}
 */
export function reusableApplicationFileUrl(storagePath) {
    if (auth.currentUser !== reusableFor) {
        reusable.clear();
        reusableFor = auth.currentUser;
    }
    const held = reusable.get(storagePath);
    if (held && Date.now() - held.at < FILE_LINK_REUSE_MS) return held.link;
    const entry = { link: signedApplicationFileUrl(storagePath), at: Date.now() };
    reusable.set(storagePath, entry);
    entry.link.catch(() => { if (reusable.get(storagePath) === entry) reusable.delete(storagePath); });
    return entry.link;
}

/** For tests: forget every link. */
export function forgetApplicationFileLinks() {
    reusable.clear();
    reusableFor = null;
}
