import { db } from '@lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

/**
 * Write a verification mirror onto one employer row, without clobbering the rest.
 *
 * `[...employers]` from `appData` is a snapshot of whenever the dossier last
 * read the application, and writing the WHOLE array back would lose anything
 * that changed on another row in between — including the stable `employerId`
 * that `sendVerificationRequest` stamps on the rows it resolves, after which
 * the employer's own answer would have no row it could safely be filed
 * against.
 *
 * So the document is re-read here and the change applied to what is actually
 * stored — and the row is found by `employerId` when the callable returned one,
 * because an index is exactly the thing that moves.
 *
 * Moved verbatim out of `PEVTab.jsx` (its `writeVerification`), which keeps
 * the frozen `updateDoc(companies/{companyId}/{collectionName}/{applicationId}, { employers })`
 * contract.
 *
 * @param {{companyId: string, collectionName: string, applicationId: string}} record
 * @param {{employerId?: string, index: number, apply: (verification: object) => void}} target
 * @returns {Promise<object|null>} the verification as written, for the
 *   optimistic override, or null when the row could not be found.
 */
export async function writeVerificationMirror({ companyId, collectionName, applicationId }, { employerId, index, apply }) {
    const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
    const snap = await getDoc(appRef);
    const rows = snap.exists() && Array.isArray(snap.data()?.employers)
        ? [...snap.data().employers]
        : [];
    const found = employerId
        ? rows.findIndex((row) => row?.employerId === employerId)
        : index;
    if (found < 0 || !rows[found]) return null;

    const verification = { history: [], ...(rows[found].verification || {}) };
    apply(verification);
    rows[found] = { ...rows[found], verification };
    await updateDoc(appRef, { employers: rows });
    return verification;
}
