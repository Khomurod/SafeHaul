/**
 * Opening a file a driver uploaded with their application, from a press.
 *
 * The link is minted when the file is pressed (`signedApplicationFileUrl`): a
 * signed URL lives minutes, so a stored one is dead by the time anybody looks.
 *
 * The tab is opened inside the press itself and pointed at the file once the link
 * arrives. A browser that allows a new tab only during the click's own user
 * activation blocks one opened after an `await`, and a cold callable can take
 * seconds — the tab would silently never appear. `opener` is cleared at once,
 * which is what `noopener` would have done for a URL opened directly.
 */
import { signedApplicationFileUrl } from './applicationFileLink';

export const BLOCKED_TAB_MESSAGE = 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.';

/**
 * Whether a storage path is a driver's upload, the only kind
 * `getSignedApplicationFileUrl` signs: `companies/{id}/(applications|autofill)/guest_uploads/…`.
 */
export function isDriverUploadPath(path) {
    return typeof path === 'string' && /^companies\/[^/]+\/(applications|autofill)\/guest_uploads\/./.test(path);
}

/**
 * Opens the upload in a new tab. Call it from the press itself.
 *
 * @param {string} storagePath
 * @returns {Promise<void> | null} `null` when the browser blocked the tab (say
 *   `BLOCKED_TAB_MESSAGE`); otherwise settles once the tab shows the file, or
 *   rejects with an Error whose message can be shown.
 */
export function openApplicationFile(storagePath) {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    tab.opener = null;
    return signedApplicationFileUrl(storagePath).then(
        (url) => { tab.location.href = url; },
        (error) => {
            tab.close();
            throw new Error(error?.code === 'functions/not-found'
                ? 'This file could not be found. It may have been deleted.'
                : 'Could not open this file. Please try again.');
        },
    );
}
