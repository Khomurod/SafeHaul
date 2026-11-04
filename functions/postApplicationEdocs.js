/**
 * postApplicationEdocs.js — the driver's thank-you page opens one of the
 * company's post-application forms to sign now.
 *
 * The applicant proves who they are with the application's confirmation number
 * and is rate-limited by IP. The request is built in
 * `shared/postApplicationRequest.js`, at the same document a team member's Send
 * to driver uses (`sendPostApplicationDocument.js`); this one is not sent by
 * email or text, it hands the page its link.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const {
  COMPLETED_REQUEST_STATUSES,
  buildPostApplicationRequestId,
  buildPrefillContextFromApplication,
  isPostApplicationForm,
  linkExpiry,
  mintAccessToken,
  normalizePostSubmitTemplateConfig,
  normalizeString,
  postApplicationRequestRefs,
  preparePostApplicationRequest,
  resolveFieldForPostSubmit,
} = require('./shared/postApplicationRequest');

exports.createPostApplicationSigningRequest = onCall({ cors: true }, async (request) => {
  const {
    companyId,
    applicationId,
    confirmationNumber,
    templateId,
    appBaseUrl,
  } = request.data || {};

  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required.');
  }
  if (!applicationId || typeof applicationId !== 'string') {
    throw new HttpsError('invalid-argument', 'applicationId is required.');
  }
  if (!confirmationNumber || typeof confirmationNumber !== 'string') {
    throw new HttpsError('invalid-argument', 'confirmationNumber is required.');
  }
  if (!templateId || typeof templateId !== 'string') {
    throw new HttpsError('invalid-argument', 'templateId is required.');
  }

  const clientIp = request.rawRequest?.ip || 'unknown_guest';
  const allowed = await checkRateLimit(`post_submit_doc_${clientIp}`, 10, 60, 'closed');
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please wait a minute and try again.');
  }

  await assertCompanyAcceptingIntake(db, companyId);

  const publicProfileSnap = await db.collection('public_profiles').doc(companyId).get();
  const isEnabled = isPostApplicationForm(
    publicProfileSnap.exists ? publicProfileSnap.data()?.postApplicationTemplates : [],
    templateId
  );
  if (!isEnabled) {
    throw new HttpsError('permission-denied', 'This follow-up document is not enabled.');
  }

  const appRef = db
    .collection('companies')
    .doc(companyId)
    .collection('applications')
    .doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) {
    throw new HttpsError('not-found', 'Application not found.');
  }
  const application = appSnap.data() || {};
  if (normalizeString(application.confirmationNumber).trim() !== confirmationNumber.trim()) {
    throw new HttpsError('permission-denied', 'Application verification failed.');
  }

  const prepared = await preparePostApplicationRequest(db, {
    companyId,
    applicationId,
    templateId,
    application,
    companyName: application.companyName || publicProfileSnap.data()?.companyName || '',
    appBaseUrl,
  });

  // Idempotency: one deterministic request per (application, template) pair.
  // Repeat clicks reuse the pending request (and its token) instead of piling
  // up duplicates, and a completed request short-circuits to alreadyCompleted.
  const { requestRef, tokenRef } = postApplicationRequestRefs(db, companyId, applicationId, templateId);

  const outcome = await db.runTransaction(async (txn) => {
    const existingSnap = await txn.get(requestRef);

    if (existingSnap.exists) {
      const existing = existingSnap.data() || {};
      const status = normalizeString(existing.status).trim();

      if (COMPLETED_REQUEST_STATUSES.has(status)) {
        return { kind: 'completed', title: existing.title || prepared.title };
      }
      if (status === 'voided') {
        return { kind: 'voided' };
      }

      // Pending ('sent' / self-healing 'processing'): reuse. Re-mint the token
      // when it is missing or the link has expired; the confirmation-number
      // check above is the applicant's proof of identity for re-issue.
      const tokenSnap = await txn.get(tokenRef);
      const storedToken = tokenSnap.exists ? tokenSnap.data().accessToken : null;
      const isExpired = existing.expiresAt && existing.expiresAt.toMillis() < Date.now();

      if (storedToken && !isExpired) {
        return { kind: 'reused', accessToken: storedToken, title: existing.title || prepared.title };
      }

      const accessToken = mintAccessToken();
      txn.update(requestRef, {
        status: 'sent',
        expiresAt: linkExpiry(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      txn.set(tokenRef, { accessToken });
      return { kind: 'reissued', accessToken, title: existing.title || prepared.title };
    }

    const accessToken = mintAccessToken();
    txn.set(requestRef, prepared.build({
      source: 'post_application_success',
      sourceConfirmationNumber: confirmationNumber,
      sendEmail: false,
      sendSms: false,
      deliveryMethod: 'in_app_post_submit',
      senderName: 'SafeHaul Auto-Followup',
      senderId: null,
    }));
    txn.set(tokenRef, { accessToken });
    return { kind: 'created', accessToken, title: prepared.title };
  });

  // Structured diagnostics for support — ids only, never tokens or PII.
  console.log(
    `[createPostApplicationSigningRequest] outcome=${outcome.kind} companyId=${companyId} templateId=${templateId} requestId=${requestRef.id}`
  );

  if (outcome.kind === 'voided') {
    throw new HttpsError(
      'failed-precondition',
      'This document is no longer available. Please contact the company for a new copy.'
    );
  }

  if (outcome.kind === 'completed') {
    return {
      success: true,
      requestId: requestRef.id,
      alreadyCompleted: true,
      title: outcome.title,
    };
  }

  return {
    success: true,
    requestId: requestRef.id,
    accessToken: outcome.accessToken,
    title: outcome.title,
  };
});

exports.__private = {
  buildPrefillContextFromApplication,
  resolveFieldForPostSubmit,
  normalizePostSubmitTemplateConfig,
  buildPostApplicationRequestId,
};
