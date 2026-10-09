/**
 * What a guest submission sends: the answers, with the identity, source and
 * tracking fields every submission carries. Moved out of `publicApplySubmit.js`
 * for the source-size standard; the same object the queue keeps and replays.
 */
import { SANDBOX_APP_SLUG } from '@features/sandbox/sandboxConstants';
import { withoutCompanyKeys } from './companyEditsSync';

export function buildGuestApplicationData({
  formData, company, applicationId, confirmationNumber, submissionAttemptId, recruiterCode, sandbox, slug,
}) {
  const email = formData.email || '';
  const phone = formData.phone || '';
  return {
    applicantId: applicationId,
    applicationId: applicationId,
    submissionAttemptId,
    confirmationNumber: confirmationNumber,
    // The answers alone: what a Company Admin's edits left beside them is said
    // once, as `seenRevision` below, and never queued.
    ...withoutCompanyKeys(formData),
    // Ensure these top-level keys always exist (overrides from formData if present)
    firstName: formData.firstName || '',
    lastName: formData.lastName || '',
    email: email,
    phone: phone,
    signature: formData.signature,
    signatureType: formData.signatureType || 'drawn',
    companyId: company.id,
    companyName: company.companyName,
    recruiterCode: recruiterCode || null,
    sourceType: sandbox ? 'Sandbox Application' : 'Public Application',
    sourceSlug: sandbox ? SANDBOX_APP_SLUG : slug,
    status: 'New Application',
    // BUGFIX: Removed submittedAt/createdAt serverTimestamp() from here.
    // sanitizeData() destroys FieldValue sentinels by recursing into them.
    // The Cloud Function (submitGuestApplication) adds server timestamps after sanitization.
    employers: Array.isArray(formData.employers) ? formData.employers : [],
    violations: Array.isArray(formData.violations) ? formData.violations : [],
    accidents: Array.isArray(formData.accidents) ? formData.accidents : [],
    schools: Array.isArray(formData.schools) ? formData.schools : [],
    military: Array.isArray(formData.military) ? formData.military : [],
    // Bulletproof tracking
    lifecycle: {
      status: 'pending',
      submittedAt: new Date().toISOString(),
      clientVersion: sandbox ? 'sandbox' : '2.0-bulletproof',
      isGuest: true,
    },
  };
}
