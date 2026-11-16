/**
 * One send per event for the signing-link triggers. Firestore delivers an event
 * at least once, so a creation trigger can run twice for one new request; the
 * email (`notifySigner`) and the text (`notifySignerSMS`) each claim the event
 * on the request before they send.
 */
const { admin } = require('../firebaseAdmin');

/**
 * Claims a signing request's delivery for one event, in a transaction: true for
 * the first run that claims it under `field`, false for any other. `record` is
 * written with the claim.
 */
function claimDelivery(ref, field, eventId, record = {}) {
    return admin.firestore().runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (current.get(field) === eventId) return false;
        tx.update(ref, { [field]: eventId, ...record });
        return true;
    });
}

module.exports = { claimDelivery };
