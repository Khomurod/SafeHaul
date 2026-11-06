import { doc, getDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { newShortCode } from '@shared/utils/shortCode';

/**
 * A recruiter's personal application link code (`recruiter_links/{code}`).
 *
 * The code is a short code (`shortCode.js`), and a new one is written only
 * where no link exists yet: a code already taken, by anyone, is
 * never overwritten, and another is drawn. The server assigns an application to
 * a link's owner only when the link was made for that company
 * (`functions/shared/recruiterAssignment.js`).
 */

const ATTEMPTS = 5;

/** Thrown inside the transaction when the drawn code is already a link. */
class CodeTaken extends Error {}

/**
 * The code to show for this company: the user's saved code when its link is
 * theirs and was made for this company; `null` when it is theirs but for another
 * company (the page then offers the `?recruiter=` link, which the server checks
 * against this company's team); a newly created code when there is none, or the
 * saved code's link names someone else.
 *
 * @param {string} uid
 * @param {string} companyId
 * @param {string|null|undefined} savedCode the user's `recruitingCode`
 * @returns {Promise<string|null>}
 */
export async function recruiterCodeFor(uid, companyId, savedCode) {
    if (savedCode) {
        const link = await getDoc(doc(db, 'recruiter_links', savedCode));
        const saved = link.exists() ? link.data() || {} : null;
        if (saved?.userId === uid) return saved.companyId === companyId ? savedCode : null;
    }
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const code = newShortCode();
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
