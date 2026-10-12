/**
 * resendSignerOnCorrection.js — a corrected signing request goes out again.
 *
 * A request is sent once, when it is created (`notifySigner`, `notifySignerSMS`).
 * When Correct Document changes its email, phone or channels, the link is settled
 * again (`shared/signingLink.js`): a link that went to an email or phone the
 * request no longer has is replaced, so the old link stops working, and the link
 * goes out on every channel whose contact it has not reached. Only an unsigned
 * request (`sent`) is sent again.
 */
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { admin } = require('./firebaseAdmin');
const { emailSigningLink } = require('./notifySigner');
const { textSigningLink } = require('./notifySignerSMS');
const { emailOf, phoneOf, settleSigningLink } = require('./shared/signingLink');
const db = admin.firestore();

/** Whether a change touched where a request's link goes. */
function routeChanged(before, after) {
    return emailOf(before) !== emailOf(after)
        || phoneOf(before) !== phoneOf(after)
        || (before.sendEmail !== false) !== (after.sendEmail !== false)
        || Boolean(before.sendSms) !== Boolean(after.sendSms);
}

exports.resendSignerOnCorrection = onDocumentUpdated(
    {
        document: 'companies/{companyId}/signing_requests/{requestId}',
        region: 'us-central1',
        secrets: ['SMS_ENCRYPTION_KEY']
    },
    async (event) => {
        const before = event.data.before.data();
        if (!routeChanged(before, event.data.after.data())) return null;

        const { companyId, requestId } = event.params;
        const ref = event.data.after.ref;
        // Firestore delivers an event at least once and in no set order, so the
        // work is decided on the request as it is now, in a transaction: a
        // repeated or overtaken event finds the link already where it belongs.
        const work = await db.runTransaction(async (tx) => {
            const data = (await tx.get(ref)).data() || {};
            return { data, ...(await settleSigningLink(tx, ref, data, { send: true, sentAs: before })) };
        });

        const { data, accessToken } = work;
        if (work.email) {
            await emailSigningLink({ companyId, requestId, ref, data, accessToken, replacesEarlierLink: work.emailHeldOldLink });
        }
        if (work.sms) {
            await textSigningLink({ companyId, requestId, ref, data, accessToken });
        }
        return null;
    }
);
