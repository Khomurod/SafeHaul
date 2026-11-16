/**
 * Opening a signed document's sealed PDF from a press, in a new tab.
 *
 * `getSignedDocumentUrl` checks the caller's company and signs a read link to
 * `secure_documents/{companyId}/…` that lives an hour; it is minted on the press
 * and never stored. As in `openApplicationFile`, the tab is opened inside the
 * press and pointed at the file once the link arrives, so a browser that allows
 * a new tab only during the click does not block it, and `opener` is cleared.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * @param {string} storagePath e.g. `secure_documents/{companyId}/completed/{id}_signed.pdf`
 * @returns {Promise<void> | null} `null` when the browser blocked the tab;
 *   otherwise settles once the tab shows the file, or rejects with an Error
 *   whose message can be shown.
 */
export function openSignedDocument(storagePath) {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    tab.opener = null;
    return httpsCallable(functions, 'getSignedDocumentUrl')({ storagePath }).then(
        ({ data }) => {
            if (!data?.url) throw new Error('No link was returned for this document.');
            tab.location.href = data.url;
        },
    ).catch((error) => {
        tab.close();
        throw new Error(error?.code === 'functions/not-found'
            ? 'This document could not be found. It may have been deleted.'
            : 'Could not open this document. Please try again.');
    });
}
