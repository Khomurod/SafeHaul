/**
 * The same driver's other unfinished applications at this company.
 *
 * A driver who typed a different email or phone on a second visit has a second
 * draft, at a second key. The owner decided that deleting one deletes the other
 * as well (2026-10-07), with the Company Admin shown each one first and free to
 * keep any that is somebody else's, since a shared phone looks the same.
 *
 * "The same driver" is one of three facts two drafts share: the identity HMAC
 * (last name, date of birth and SSN, which a driver-started draft has once the
 * SSN was typed), the email, or the phone. A carrier-prepared draft has no
 * identity HMAC, because the carrier does not know the SSN, so it is matched by
 * email or phone alone.
 */

const draft = require('../shared/applicationDraft');

/** More than any one driver has; a list that long is a shared phone, shown as it is. */
const RELATED_LIMIT = 10;
/** Ten digits, as `contactMatches` requires, so a blank or a short typo matches nothing. */
const MIN_PHONE_DIGITS = 10;

const emailOf = (data) => String(data?.contactEmail || '').toLowerCase().trim();
const phoneOf = (data) => String(data?.contactPhone || '').replace(/\D/g, '');
const identityOf = (data) => (typeof data?.identityKey === 'string' ? data.identityKey : '');

/**
 * What two drafts share, strongest first; empty when they share nothing.
 *
 * @returns {Array<'identity'|'email'|'phone'>}
 */
function sharedFacts(a, b) {
    const facts = [];
    if (identityOf(a) && identityOf(a) === identityOf(b)) facts.push('identity');
    if (emailOf(a) && emailOf(a) === emailOf(b)) facts.push('email');
    if (phoneOf(a).length >= MIN_PHONE_DIGITS && phoneOf(a) === phoneOf(b)) facts.push('phone');
    return facts;
}

/**
 * The drafts that share one of the three facts with this one, most recently
 * active first, each with what it shares. The draft itself is not among them.
 *
 * Three equality queries, without an order, so each is served by the field's
 * automatic index and none needs a composite one.
 */
async function relatedDrafts(companyId, target) {
    const data = target.data() || {};
    const collection = draft.draftsCollection(companyId);
    const probes = [];
    if (identityOf(data)) probes.push(collection.where('identityKey', '==', identityOf(data)).limit(RELATED_LIMIT));
    if (emailOf(data)) probes.push(collection.where('contactEmail', '==', emailOf(data)).limit(RELATED_LIMIT));
    if (phoneOf(data).length >= MIN_PHONE_DIGITS) {
        probes.push(collection.where('contactPhone', '==', phoneOf(data)).limit(RELATED_LIMIT));
    }
    const snapshots = await Promise.all(probes.map((probe) => probe.get()));

    const byKey = new Map();
    for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
        if (doc.id === target.id || byKey.has(doc.id)) continue;
        const shares = sharedFacts(data, doc.data() || {});
        if (shares.length > 0) byKey.set(doc.id, { doc, shares });
    }
    const millis = (entry) => entry.doc.data()?.updatedAt?.toMillis?.() ?? 0;
    return [...byKey.values()].sort((a, b) => millis(b) - millis(a)).slice(0, RELATED_LIMIT);
}

module.exports = { MIN_PHONE_DIGITS, RELATED_LIMIT, relatedDrafts, sharedFacts };
