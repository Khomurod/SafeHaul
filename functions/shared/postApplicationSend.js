/**
 * postApplicationSend.js — sending one of the company's post-application forms
 * to an application's driver: the rules a team member's Send to driver
 * (`sendPostApplicationDocument.js`) and the automatic send after submission
 * (`autoSendPostApplicationForms.js`) share.
 *
 * The thank-you page makes the same request (`postApplicationEdocs.js`) without
 * sending it. This sends it through what every signing request uses, at the
 * same document (`postApplicationRequest.js`):
 *  - no request yet: it is made with `sendEmail` / `sendSms` set, and the
 *    creation triggers send it (`notifySigner`, `notifySignerSMS`);
 *  - an unsigned request whose link has not reached the driver's contact: those
 *    flags go on, and the correction trigger settles the link and sends it, with
 *    seven days again (`resendSignerOnCorrection`, `signingLink.js`).
 * Which of the two, or neither, is decided in one transaction, so two sends at
 * once are one message. A signed form is reported as such, a voided or
 * half-submitted one is not sent, and a link already sent everywhere the driver
 * can be reached is not sent again (`already-sent`): Remind sends it again
 * (`remindSigner.js`).
 *
 * Channels: email to the application's address; a text only after the driver's
 * explicit "Yes" to texts (`sms-consent`), and never to a number on the opt-out
 * list (`notifySignerSMS` records that as a failed text). With neither, nothing
 * is written (`no-channel`).
 */
const { admin } = require('../firebaseAdmin');
const { isValidEmail } = require('./isValidEmail');
const { isPlaceholderEmail } = require('./placeholderDomains');
const { trustedAppBaseUrl } = require('./appOrigin');
const { agreedToSms, onOptOutList } = require('./smsPermission');
const { linkSentTo, linkWork, phoneOf, routeChanged } = require('./signingLink');
const {
  COMPLETED_REQUEST_STATUSES,
  mintAccessToken,
  postApplicationRequestRefs,
  preparePostApplicationRequest,
} = require('./postApplicationRequest');

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Where the driver can be sent the link: an email address, and a phone only after "Yes" to texts. */
function reachableAt(application) {
  const email = text(application.email);
  const phone = text(application.phone) || text(application.phoneNumber);
  return {
    email: isValidEmail(email) && !isPlaceholderEmail(email) ? email : '',
    phone: agreedToSms(application) && phoneOf({ recipientPhone: phone }) ? phone : '',
  };
}

/** The `deliveryMethod` a request's flags amount to, as the Documents workspace names them. */
function deliveryMethodOf(request) {
  const email = request.sendEmail !== false;
  const sms = Boolean(request.sendSms);
  if (email && sms) return 'both';
  return sms ? 'sms' : 'email';
}

/**
 * In transaction `txn`: what this send does to the form's request and its
 * token, and the channels it sends on. `prepared` builds the request when none
 * existed before the transaction; `source` names who made it.
 */
async function decide(txn, { requestRef, tokenRef, prepared, reach, sender, application, source }) {
  const snap = await txn.get(requestRef);
  const tokenSnap = await txn.get(tokenRef);

  if (!snap.exists) {
    // Gone since it was read: the form is built again on the next send.
    if (!prepared) return { kind: 'retry' };
    const flags = { sendEmail: Boolean(reach.email), sendSms: Boolean(reach.phone) };
    txn.set(requestRef, prepared.build({
      source,
      sourceConfirmationNumber: text(application.confirmationNumber) || null,
      ...flags,
      deliveryMethod: deliveryMethodOf(flags),
      ...sender,
    }));
    txn.set(tokenRef, { accessToken: mintAccessToken() });
    return { kind: 'sent', email: flags.sendEmail, sms: flags.sendSms };
  }

  const data = snap.data() || {};
  const status = text(data.status);
  if (COMPLETED_REQUEST_STATUSES.has(status)) return { kind: 'signed' };
  if (status === 'voided') return { kind: 'voided' };
  if (status !== 'sent') return { kind: 'submitting' };
  if (!reach.email && !reach.phone) return { kind: 'no-channel' };

  const route = {
    ...(reach.email && { sendEmail: true, recipientEmail: reach.email }),
    ...(reach.phone && { sendSms: true, recipientPhone: reach.phone }),
  };
  const after = { ...data, ...route };
  // What the correction trigger will do with this change: the same rules, on
  // the same before and after (`settleSigningLink`).
  const work = linkWork(after, linkSentTo(data));
  if (!routeChanged(data, after) || (!work.email && !work.sms)) return { kind: 'already-sent' };

  // A request made before its token moved to `secrets` keeps it on itself.
  if (!tokenSnap.exists && !data.accessToken) txn.set(tokenRef, { accessToken: mintAccessToken() });
  txn.update(requestRef, {
    ...route,
    // A form the thank-you page made stored the browser's base URL: the link
    // goes out on one of the app's own sites only.
    appBaseUrl: trustedAppBaseUrl(data.appBaseUrl),
    deliveryMethod: deliveryMethodOf(after),
    ...sender,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { kind: 'sent', email: work.email, sms: work.sms };
}

/**
 * Sends form `templateId` of application `applicationId` (its data,
 * `application`) to the driver, as `sender` (`{ senderId, senderName }`), a
 * new request made with `source`. Answers `{ kind, email, sms, requestId,
 * optedOut }`: `kind` is `sent`, `already-sent`, `signed`, `voided`,
 * `submitting`, `retry` or `no-channel`; `optedOut` says the driver's number is
 * on the opt-out list, so it is not texted. Throws what
 * `preparePostApplicationRequest` refuses (no template, no file, a locked
 * field the application cannot fill), writing nothing.
 */
async function sendPostApplicationForm(db, {
  companyId, applicationId, templateId, application, companyName, appBaseUrl, sender, source,
}) {
  const reach = reachableAt(application);
  // A number on the opt-out list is not texted (`notifySignerSMS` would skip
  // it), so it is not reported as texted either.
  const optedOut = Boolean(reach.phone) && await onOptOutList(companyId, reach.phone);
  if (optedOut) reach.phone = '';

  const { requestRef, tokenRef } = postApplicationRequestRefs(db, companyId, applicationId, templateId);
  const answer = { requestId: requestRef.id, optedOut };
  // The template is filled only for a request that does not exist yet: one that
  // does keeps what it holds.
  const exists = (await requestRef.get()).exists;
  if (!exists && !reach.email && !reach.phone) return { ...answer, kind: 'no-channel' };
  const prepared = exists ? null : await preparePostApplicationRequest(db, {
    companyId, applicationId, templateId, application, companyName, appBaseUrl,
  });

  const outcome = await db.runTransaction((txn) => decide(txn, {
    requestRef, tokenRef, prepared, reach, sender, application, source,
  }));
  return { ...answer, ...outcome };
}

module.exports = { sendPostApplicationForm };
