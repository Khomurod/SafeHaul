/**
 * A short-lived link to a file a driver uploaded with their application.
 *
 * Signed server-side by `getSignedApplicationFileUrl`, which accepts only a
 * driver-upload path of a company the caller may access. A signed URL is a
 * capability that lives minutes, so it is minted when somebody asks to look and
 * never stored — the same reasoning `useGuestFileUpload` gives for storing only
 * the `storagePath`.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * @param {string} storagePath e.g. `companies/{id}/applications/guest_uploads/…`
 * @returns {Promise<string>} a URL that opens the file
 */
export async function signedApplicationFileUrl(storagePath) {
    const resign = httpsCallable(functions, 'getSignedApplicationFileUrl');
    const { data } = await resign({ storagePath });
    if (!data?.url) throw new Error('No link was returned for this file.');
    return data.url;
}
