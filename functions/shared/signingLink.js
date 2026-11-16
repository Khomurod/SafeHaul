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
 * confirmation: change both. A reminder (`signerReminder.js`: Remind and the
 * automatic one) sends the link again where it already went, in resend mode.
 */
const { randomUUID } = require('crypto');
const { admin } = require('../firebaseAdmin');
const { toE164Us } = require('./toE164Us');

// A replaced or newly sent link has the seven days a new request gets.
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const emailOf = (data) => (typeof data?.recipientEmail === 'string' ? data.recipientEmail.trim().toLowerCase() : '');
const phoneOf = (data) => toE164Us(data?.recipientPhone)
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
 * Whether a change from `before` to `after` touched where a request's link goes:
 * its email, its phone or its channels. Only such a change makes
 * `resendSignerOnCorrection` settle the link again.
 */
function routeChanged(before, after) {
    return emailOf(before) !== emailOf(after)
        || phoneOf(before) !== phoneOf(after)
        || (before.sendEmail !== false) !== (after.sendEmail !== false)
        || Boolean(before.sendSms) !== Boolean(after.sendSms);
}

/** The channels request `data` sends its link by: email unless switched off, a text when asked for. */
function deliveryChannels(data) {
    return { email: emailsLink(data), sms: textsLink(data) };
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
 *
 * `resend` (`{ email, sms }`, a reminder) claims those of the request's
 * channels again even where the link already went; `send` claims only those it
 * has not reached. `record` is written with the claim.
 */
async function settleSigningLink(tx, ref, data, { send = false, resend = null, sentAs = data, record = {} } = {}) {
    const tokenRef = ref.collection('secrets').doc('token');
    const secret = await tx.get(tokenRef);
    // ADV-4: a request made before the token moved to `secrets` keeps it on itself.
    let accessToken = secret.exists ? secret.data().accessToken : (data.accessToken || null);
    const settled = { accessToken, email: false, sms: false, emailHeldOldLink: false };
    if (data.status !== 'sent') return settled;

    const sentTo = linkSentTo(data, sentAs);
    const work = linkWork(data, sentTo);
    const email = (send && work.email) || Boolean(resend?.email && emailsLink(data));
    const sms = (send && work.sms) || Boolean(resend?.sms && textsLink(data));
    if (!work.replace && !email && !sms) return settled;

    if (work.replace) {
        accessToken = randomUUID();
        tx.set(tokenRef, { accessToken });
    }
    const reached = work.replace ? {} : sentTo;
    tx.update(ref, {
        linkSentTo: { ...reached, ...(email && { email: emailOf(data) }), ...(sms && { phone: phoneOf(data) }) },
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_MS),
        ...record,
    });
    return { accessToken, email, sms, emailHeldOldLink: work.replace && sentTo.email === emailOf(data) };
}

module.exports = { emailOf, phoneOf, deliveryChannels, linkSentTo, linkWork, routeChanged, settleSigningLink };
