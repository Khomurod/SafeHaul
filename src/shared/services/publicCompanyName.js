/**
 * A company's public name, for a public page that knows only the company's id.
 *
 * Read from `public_profiles/{companyId}`: the sanitized mirror the rules let
 * anyone read and the application page already shows, so this reads nothing a
 * visitor could not read already. Used to name the sender when a link does not
 * work, so it never stands in the way of that screen.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';

/** What `buildPublicProfileDto` writes when a company has no name. */
const NO_NAME = 'Untitled Company';

/**
 * @param {string} companyId
 * @param {{ timeoutMs?: number }} [options] how long the screen may wait for it
 * @returns {Promise<string|null>} null when there is no name, it could not be
 *   read, or it took longer than `timeoutMs`; never rejects
 */
export async function fetchPublicCompanyName(companyId, { timeoutMs = 3000 } = {}) {
    if (!companyId || typeof companyId !== 'string') return null;
    let timer;
    try {
        const read = getDoc(doc(db, 'public_profiles', companyId)).then((snap) => {
            const name = snap.exists() ? snap.data()?.companyName : null;
            const trimmed = typeof name === 'string' ? name.trim() : '';
            return trimmed && trimmed !== NO_NAME ? trimmed : null;
        });
        const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        return await Promise.race([read, late]);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
