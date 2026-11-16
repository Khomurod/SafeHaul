/**
 * sendPostApplicationDocument.js — Send to driver: a team member sends one of
 * the company's post-application forms to an application's driver, from the
 * dossier.
 *
 * The thank-you page makes the same request (`postApplicationEdocs.js`) without
 * sending it, so a driver who closed that page never got the form. This sends
 * it by the rules the automatic send shares (`shared/postApplicationSend.js`):
 * a new request is sent by the creation triggers, one never sent gets its flags
 * turned on and the correction trigger sends it, decided in one transaction, so
 * one press is one message. A signed form is reported as such and a voided or
 * half-submitted one refused; a link already sent everywhere the driver can be
 * reached is not sent again (`already-sent`): Remind sends it again, expired or
 * not (`remindSigner.js`).
 *
 * Channels: email to the application's address; a text only after the driver's
 * explicit "Yes" to texts (`sms-consent`), and never to a number on the opt-out
 * list. With neither, the press is refused with the reason
 * (`details.reason: 'no-channel'`).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { isPostApplicationForm } = require('./shared/postApplicationRequest');
const { sendPostApplicationForm } = require('./shared/postApplicationSend');

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

exports.sendPostApplicationDocument = onCall({ cors: true }, async (request) => {
  const { companyId, applicationId, templateId, appBaseUrl } = request.data || {};
  for (const [name, value] of Object.entries({ companyId, applicationId, templateId })) {
    if (!value || typeof value !== 'string') {
      throw new HttpsError('invalid-argument', `${name} is required.`);
    }
  }

  const checkedCompany = await assertCompanyAccessForRequest(request, companyId, 'sendPostApplicationDocument');

  const companyRef = db.collection('companies').doc(companyId);
  const [companySnap, appSnap] = await Promise.all([
    // The company the access check read; a super admin's check may hand back none.
    checkedCompany || companyRef.get(),
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

  const outcome = await sendPostApplicationForm(db, {
    companyId,
    applicationId,
    templateId,
    application,
    companyName: application.companyName || company.companyName || '',
    appBaseUrl,
    // The email's "Requested by" and the text's sender: the team member's name,
    // else the company's (a staff email address is not one to text a driver).
    sender: {
      senderId: request.auth.uid,
      senderName: text(request.auth.token?.name) || text(company.companyName) || 'Your Employer',
    },
    source: 'post_application_team',
  });

  // Ids only, never tokens or contact details.
  console.log(
    `[sendPostApplicationDocument] outcome=${outcome.kind} companyId=${companyId} templateId=${templateId} requestId=${outcome.requestId}`
  );

  if (outcome.kind === 'no-channel') {
    throw new HttpsError('failed-precondition', outcome.optedOut ? NO_CHANNEL_OPTED_OUT : NO_CHANNEL, { reason: 'no-channel' });
  }
  if (outcome.kind === 'retry') throw new HttpsError('aborted', REFUSALS.retry);
  if (REFUSALS[outcome.kind]) throw new HttpsError('failed-precondition', REFUSALS[outcome.kind]);

  return {
    success: true,
    requestId: outcome.requestId,
    outcome: outcome.kind,
    channels: { email: Boolean(outcome.email), sms: Boolean(outcome.sms) },
  };
});
