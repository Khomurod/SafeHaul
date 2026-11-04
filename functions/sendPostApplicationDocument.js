/**
 * sendPostApplicationDocument.js — Send to driver: a team member sends one of
 * the company's post-application forms to an application's driver, from the
 * dossier.
 *
 * The thank-you page makes the same request (`postApplicationEdocs.js`) without
 * sending it, so a driver who closed that page never got the form. This sends
 * it through what every signing request uses, at the same document
 * (`shared/postApplicationRequest.js`):
 *  - no request yet: it is made with `sendEmail` / `sendSms` set, and the
 *    creation triggers send it (`notifySigner`, `notifySignerSMS`);
 *  - an unsigned request whose link has not reached the driver's contact: those
 *    flags go on, and the correction trigger settles the link and sends it, with
 *    seven days again (`resendSignerOnCorrection`, `shared/signingLink.js`).
 * Which of the two, or neither, is decided in one transaction, so one press is
 * one message. A signed form is reported as such and a voided or half-submitted
 * one refused; a link already sent everywhere the driver can be reached is not
 * sent again (`already-sent`): Remind sends it again, expired or not
 * (`remindSigner.js`).
 *
 * Channels: email to the application's address; a text only after the driver's
 * explicit "Yes" to texts (`sms-consent`), and never to a number on the opt-out
 * list (`notifySignerSMS` records that as a failed text). With neither, the
 * press is refused with the reason (`details.reason: 'no-channel'`).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { isValidEmail } = require('./shared/isValidEmail');
const { isPlaceholderEmail } = require('./shared/placeholderDomains');
const { trustedAppBaseUrl } = require('./shared/appOrigin');
const { agreedToSms, onOptOutList } = require('./shared/smsPermission');
const { linkSentTo, linkWork, phoneOf, routeChanged } = require('./shared/signingLink');
const {
  COMPLETED_REQUEST_STATUSES,
  isPostApplicationForm,
  mintAccessToken,
  postApplicationRequestRefs,
  preparePostApplicationRequest,
} = require('./shared/postApplicationRequest');

const NO_CHANNEL = 'Not sent: this application has no email address we can use, '
  + 'and the driver did not answer Yes to text messages.';
const NO_CHANNEL_OPTED_OUT = 'Not sent: this application has no email address we can use, '
  + 'and the driver\'s number opted out of text messages.';
const REFUSALS = {
  voided: 'This form was voided, so it is not sent again.',
  submitting: 'The driver is submitting this form right now.',
  retry: 'This form changed while it was being sent. Please try again.',
};

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
 * In transaction `txn`: what this press does to the form's request and its
 * token, and the channels it sends on. `prepared` builds the request when none
 * existed before the transaction.
 */
async function decide(txn, { requestRef, tokenRef, prepared, reach, sender, application }) {
  const snap = await txn.get(requestRef);
  const tokenSnap = await txn.get(tokenRef);

  if (!snap.exists) {
    // Gone since it was read: the form is built again on the next press.
    if (!prepared) return { kind: 'retry' };
    const flags = { sendEmail: Boolean(reach.email), sendSms: Boolean(reach.phone) };
    txn.set(requestRef, prepared.build({
      source: 'post_application_team',
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

exports.sendPostApplicationDocument = onCall({ cors: true }, async (request) => {
  const { companyId, applicationId, templateId, appBaseUrl } = request.data || {};
  for (const [name, value] of Object.entries({ companyId, applicationId, templateId })) {
    if (!value || typeof value !== 'string') {
      throw new HttpsError('invalid-argument', `${name} is required.`);
    }
  }

  await assertCompanyAccessForRequest(request, companyId, 'sendPostApplicationDocument');

  const companyRef = db.collection('companies').doc(companyId);
  const [companySnap, appSnap] = await Promise.all([
    companyRef.get(),
    companyRef.collection('applications').doc(applicationId).get(),
  ]);
  const company = companySnap.exists ? companySnap.data() || {} : {};
  if (!isPostApplicationForm(company.postApplicationTemplates, templateId)) {
    throw new HttpsError('failed-precondition', 'This form is not one of the company\'s post-application forms.');
  }
  if (!appSnap.exists) {
    throw new HttpsError('not-found', 'Application not found.');
  }
  const application = appSnap.data() || {};
  const reach = reachableAt(application);
  // A number on the opt-out list is not texted (`notifySignerSMS` would skip
  // it), so it is not reported as texted either.
  const optedOut = Boolean(reach.phone) && await onOptOutList(companyId, reach.phone);
  if (optedOut) reach.phone = '';
  const noChannel = optedOut ? NO_CHANNEL_OPTED_OUT : NO_CHANNEL;

  const { requestRef, tokenRef } = postApplicationRequestRefs(db, companyId, applicationId, templateId);
  // The template is filled only for a request that does not exist yet: one that
  // does keeps what it holds.
  const exists = (await requestRef.get()).exists;
  if (!exists && !reach.email && !reach.phone) {
    throw new HttpsError('failed-precondition', noChannel, { reason: 'no-channel' });
  }
  const prepared = exists ? null : await preparePostApplicationRequest(db, {
    companyId,
    applicationId,
    templateId,
    application,
    companyName: application.companyName || company.companyName || '',
    appBaseUrl,
  });
  // The email's "Requested by" and the text's sender: the team member's name,
  // else the company's (a staff email address is not one to text a driver).
  const sender = {
    senderId: request.auth.uid,
    senderName: text(request.auth.token?.name) || text(company.companyName) || 'Your Employer',
  };

  const outcome = await db.runTransaction((txn) => decide(txn, {
    requestRef, tokenRef, prepared, reach, sender, application,
  }));

  // Ids only, never tokens or contact details.
  console.log(
    `[sendPostApplicationDocument] outcome=${outcome.kind} companyId=${companyId} templateId=${templateId} requestId=${requestRef.id}`
  );

  if (outcome.kind === 'no-channel') {
    throw new HttpsError('failed-precondition', noChannel, { reason: 'no-channel' });
  }
  if (outcome.kind === 'retry') throw new HttpsError('aborted', REFUSALS.retry);
  if (REFUSALS[outcome.kind]) throw new HttpsError('failed-precondition', REFUSALS[outcome.kind]);

  return {
    success: true,
    requestId: requestRef.id,
    outcome: outcome.kind,
    channels: { email: Boolean(outcome.email), sms: Boolean(outcome.sms) },
  };
});
