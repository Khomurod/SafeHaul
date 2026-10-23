import {
    collection,
    doc,
    getCountFromServer,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getStatusesForSegment } from '@shared/utils/applicationStatus';
import { newShortCode } from '@shared/utils/shortCode';

/**
 * A company's driver referral links (`companies/{id}/referral_links/{code}`).
 *
 * The access rules decide what may be written: a link is made by its creator,
 * with these fields only, and can only be switched off. The server does the
 * rest: it resolves the code a driver brings, assigns the lead or application
 * to the creator and tells them.
 */

const ATTEMPTS = 5;
export const REFERRER_NAME_MAX = 80;

const linksOf = (companyId) => collection(db, 'companies', companyId, 'referral_links');

/** The public page a referred driver opens. */
export function referralLinkUrl({ appBaseUrl, appSlug, code }) {
    return `${String(appBaseUrl).replace(/\/$/, '')}/apply/${appSlug}?ref=${code}`;
}

const millis = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : 0);

/**
 * Every link for a Company Admin, the caller's own for anyone else; newest
 * first, switched-off ones last.
 */
export async function listReferralLinks({ companyId, uid, isAdmin }) {
    const source = isAdmin ? linksOf(companyId) : query(linksOf(companyId), where('createdBy', '==', uid));
    const snap = await getDocs(source);
    return snap.docs
        .map((entry) => ({ ...entry.data(), code: entry.id }))
        .sort((a, b) => Number(b.active === true) - Number(a.active === true) || millis(b.createdAt) - millis(a.createdAt));
}

/** Thrown inside the transaction when the drawn code already names a link. */
class CodeTaken extends Error {}

/**
 * A new link under a free code; a code already taken is never overwritten.
 * @returns {Promise<string>} the code
 */
export async function createReferralLink({ companyId, uid, creatorName, referrerName, referrerPhone }) {
    const name = String(referrerName || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Enter the referring driver’s name.');
    const phone = String(referrerPhone || '').trim();
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const code = newShortCode();
        try {
            await runTransaction(db, async (transaction) => {
                const ref = doc(linksOf(companyId), code);
                if ((await transaction.get(ref)).exists()) throw new CodeTaken();
                transaction.set(ref, {
                    companyId,
                    code,
                    referrerName: name.slice(0, REFERRER_NAME_MAX),
                    ...(phone && { referrerPhone: phone.slice(0, 32) }),
                    createdBy: uid,
                    createdByName: creatorName || '',
                    active: true,
                    createdAt: serverTimestamp(),
                });
            });
            return code;
        } catch (error) {
            if (error instanceof CodeTaken) continue;
            throw error;
        }
    }
    throw new Error('Could not find a free link code. Try again.');
}

export function deactivateReferralLink({ companyId, code }) {
    return updateDoc(doc(linksOf(companyId), code), { active: false, deactivatedAt: serverTimestamp() });
}

/**
 * How many quick-form leads, applications and hired applications a link
 * brought. Equality filters only, so no composite index is needed: "hired" is
 * one count per hired status.
 */
export async function countReferrals({ companyId, code }) {
    const company = doc(db, 'companies', companyId);
    const byCode = (name, ...more) => getCountFromServer(query(
        collection(company, name),
        where('referral.code', '==', code),
        ...more,
    )).then((snap) => snap.data().count);
    const [leads, applications, ...hired] = await Promise.all([
        byCode('leads'),
        byCode('applications'),
        ...getStatusesForSegment('hired').map((status) => byCode('applications', where('status', '==', status))),
    ]);
    return { leads, applications, hired: hired.reduce((sum, count) => sum + count, 0) };
}
