import { getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * FUNC-005: fields that are set ONCE, at application creation.
 *
 * On a merge UPDATE of an existing application, an authenticated driver may only
 * change a narrow allow-list of fields (see `applicationDriverSelfUpdateAllowedKeys`
 * in firestore.rules). Re-sending these create-only fields on a retry, edit, or
 * offline-queue replay would either:
 *   - be REJECTED by the rules (`createdAt` is not in the driver allow-list), or
 *   - clobber recruiter-owned pipeline data (`status`), or
 *   - mint a brand-new `confirmationNumber` each time.
 *
 * So we write them only on first create and drop them on every update.
 */
export const APPLICATION_CREATE_ONLY_FIELDS = [
    'createdAt',
    'confirmationNumber',
    // Derived from confirmationNumber, so it shares its create-only lifecycle.
    'confirmationNumberNormalized',
    'status',
];

/**
 * Create-safe merge write for a driver application.
 *
 * - CREATE (doc does not exist): full payload, including createdAt / status /
 *   confirmationNumber, with createdAt stamped as a server timestamp.
 * - UPDATE (doc exists): create-only fields are stripped so the write stays
 *   within the driver self-update allow-list and never overwrites recruiter
 *   status/notes. `merge: true` preserves everything the company team added.
 *
 * `submittedAt` and `updatedAt` are always stamped (both are allow-listed).
 *
 * @param {import('firebase/firestore').DocumentReference} docRef
 * @param {object} data - the full application payload
 * @returns {Promise<{ isNew: boolean }>}
 */
export async function mergeApplicationDoc(docRef, data) {
    const snap = await getDoc(docRef);
    const isNew = !snap.exists();

    const payload = { ...data, submittedAt: serverTimestamp(), updatedAt: serverTimestamp() };

    if (isNew) {
        payload.createdAt = serverTimestamp();
    } else {
        for (const field of APPLICATION_CREATE_ONLY_FIELDS) {
            delete payload[field];
        }
    }

    await setDoc(docRef, payload, { merge: true });
    return { isNew };
}
