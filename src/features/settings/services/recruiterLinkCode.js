import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * A recruiter's personal application link code (`recruiter_links/{code}`).
 *
 * The code is 8 characters from an alphabet without look-alikes, and a new one
 * is written only where no link exists yet: a code already taken, by anyone, is
 * never overwritten, and another is drawn. The server assigns an application to
 * a link's owner only when the link was made for that company
 * (`functions/shared/recruiterAssignment.js`).
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const ATTEMPTS = 5;

export function newRecruiterCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
    return Array.from(random(CODE_LENGTH), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** Thrown inside the transaction when the drawn code is already a link. */
class CodeTaken extends Error {}

/**
 * The code to show for this company: the user's saved code when its link was
 * made for this company; `null` when it belongs to another company (the page
 * then offers the `?recruiter=` link, which the server checks against this
 * company's team); a newly created code when there is none.
 *
 * @param {string} uid
 * @param {string} companyId
 * @param {string|null|undefined} savedCode the user's `recruitingCode`
 * @returns {Promise<string|null>}
 */
export async function recruiterCodeFor(uid, companyId, savedCode) {
    if (savedCode) {
        const link = await getDoc(doc(db, 'recruiter_links', savedCode));
        if (link.exists()) return link.data()?.companyId === companyId ? savedCode : null;
    }
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const code = newRecruiterCode();
        try {
            await runTransaction(db, async (transaction) => {
                const ref = doc(db, 'recruiter_links', code);
                if ((await transaction.get(ref)).exists()) throw new CodeTaken();
                transaction.set(ref, { userId: uid, companyId, createdAt: new Date() });
            });
        } catch (error) {
            if (error instanceof CodeTaken) continue;
            throw error;
        }
        await updateDoc(doc(db, 'users', uid), { recruitingCode: code });
        return code;
    }
    throw new Error('Could not find a free link code.');
}
