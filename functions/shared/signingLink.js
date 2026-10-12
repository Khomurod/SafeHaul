/**
 * signingLink.js — where a signing request's link went, and when it needs a new one.
 *
 * `linkSentTo` on a request holds the email and phone its current link was sent
 * to. A sender records it before it sends, so it never leaves out a contact that
 * may hold the link. Once the request's email or phone differs from one the link
 * went to, the link went to the wrong place: the token is replaced, the old link
 * stops working, and the new link has reached no one yet. A request saved before
 * this record was sent the way the creation triggers send: by email unless that
 * is switched off, by text only when asked for. `correctionDelivery` in
 * `envelopePersistence.js` follows the same rule to word a correction's
 * confirmation: change both.
 */
const { randomUUID } = require('crypto');
const { admin } = require('../firebaseAdmin');
const { normalizePhone } = require('./normalizePhone');

// A replaced or newly sent link has the seven days a new request gets.
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const emailOf = (data) => (typeof data?.recipientEmail === 'string' ? data.recipientEmail.trim().toLowerCase() : '');
const phoneOf = (data) => normalizePhone(data?.recipientPhone)
    || (typeof data?.recipientPhone === 'string' ? data.recipientPhone.replace(/\D/g, '') : '');
const emailsLink = (data) => data.sendEmail !== false && Boolean(emailOf(data));
const textsLink = (data) => Boolean(data.sendSms) && Boolean(phoneOf(data));

/** Where request `data`'s link went: its record, or for a request saved before it, how `sentAs` was sent. */
function linkSentTo(data, sentAs = data) {
    if (data.linkSentTo) return data.linkSentTo;
    return {
        ...(emailsLink(sentAs) && { email: emailOf(sentAs) }),
        ...(textsLink(sentAs) && { phone: phoneOf(sentAs) }),
    };
}

/**
 * What request `data` needs, given where its link went (`sentTo`): `replace`
 * when that was an email or phone the request no longer has, and the channels
 * whose contact the link has not reached.
 */
function linkWork(data, sentTo) {
    const replace = Boolean((sentTo.email && sentTo.email !== emailOf(data))
        || (sentTo.phone && sentTo.phone !== phoneOf(data)));
    const reached = replace ? {} : sentTo;
    return {
        replace,
        email: emailsLink(data) && reached.email !== emailOf(data),
        sms: textsLink(data) && reached.phone !== phoneOf(data),
    };
}

/**
 * In transaction `tx`, after it read request `ref` as `data`: the token to hand
 * out, replaced first when the link went to the wrong place, and with `send`
 * the channels this run claims, recorded before anything is sent. `sentAs` is
 * the request before the change at hand, for a request saved before
 * `linkSentTo`. Only a request waiting for a signature (`sent`) changes, and a
 * link replaced or claimed for sending gets seven days again.
 */
async function settleSigningLink(tx, ref, data, { send = false, sentAs = data } = {}) {
    const tokenRef = ref.collection('secrets').doc('token');
    const secret = await tx.get(tokenRef);
    // ADV-4: a request made before the token moved to `secrets` keeps it on itself.
    let accessToken = secret.exists ? secret.data().accessToken : (data.accessToken || null);
    const settled = { accessToken, email: false, sms: false, emailHeldOldLink: false };
    if (data.status !== 'sent') return settled;

    const sentTo = linkSentTo(data, sentAs);
    const work = linkWork(data, sentTo);
    const email = send && work.email;
    const sms = send && work.sms;
    if (!work.replace && !email && !sms) return settled;

    if (work.replace) {
        accessToken = randomUUID();
        tx.set(tokenRef, { accessToken });
    }
    const reached = work.replace ? {} : sentTo;
    tx.update(ref, {
        linkSentTo: { ...reached, ...(email && { email: emailOf(data) }), ...(sms && { phone: phoneOf(data) }) },
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_MS),
    });
    return { accessToken, email, sms, emailHeldOldLink: work.replace && sentTo.email === emailOf(data) };
}

module.exports = { emailOf, phoneOf, linkSentTo, linkWork, settleSigningLink };
