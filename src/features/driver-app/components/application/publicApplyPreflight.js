// The guest application's final pre-flight: everything the browser checks
// before it spends a submission attempt, and where it sends the applicant when
// something is missing.
//
// Split out of `publicApplySubmit.js` on 2026-09-02 when the company's
// Application Rules joined the checks. The server refuses every one of these
// independently (`assertRequiredUnpersistedFields`, `assertRequiredUploads`,
// `assertApplicationRules`); this half exists to tell the applicant which
// answer and take them to it, not to be the enforcement.
//
// ORDER MATTERS. Each check routes to a page, and the checks run earliest page
// first: a resumed applicant missing a Social Security Number and a licence
// upload is sent to page one, not to page three and then page one.
import { resolveWizardStepIndex } from '@shared/components/layout/Stepper';
import { isValidEmail, isValidPhone } from '@shared/utils/validation';
import { evaluateApplicationRules, normalizeApplicationAnswers } from '@/config/applicationRules';
import { hasUploadedFile } from './publicApplyHelpers';
import { getMissingRequiredUnpersistedFields } from './requiredUnpersistedFields';

/**
 * @returns {{ ok: boolean, formData: object }} `formData` is the normalised
 *   payload to submit when `ok` — an explicit "no violations" has dropped its
 *   leftover rows, exactly as the server will.
 */
export function runSubmissionPreflight({
  formData,
  company,
  customQuestions,
  consentStepIndex,
  cdlUploadConfig,
  medCardConfig,
  mvrConsentConfig,
  setCurrentStep,
  showError,
}) {
  const hasCustomQuestions = customQuestions.length > 0;
  const goTo = (semanticStep) => setCurrentStep(resolveWizardStepIndex(semanticStep, hasCustomQuestions));

  /**
   * Required answers a resumed application could not have brought back.
   *
   * Checked before the uploads, because it routes to an earlier page: a draft
   * never stores `ssn`, so an applicant who resumed part-way through has never
   * been asked for it and the step that collects it never ran its validation.
   */
  const missingUnpersisted = getMissingRequiredUnpersistedFields(company?.applicationConfig, formData);
  if (missingUnpersisted.length > 0) {
    const labels = missingUnpersisted.map((field) => field.label).join(', ');
    const subject = missingUnpersisted.length > 1 ? 'They are' : 'It is';
    showError(`Please re-enter your ${labels} to submit. ${subject} not saved with your progress for security.`);
    goTo(missingUnpersisted[0].semanticStep);
    return { ok: false, formData };
  }

  /**
   * The company's Application Rules, and any impossible date, over the whole
   * application. A resumed draft may never have revisited the page whose rule
   * now fails — the licence expired last week, the company turned a rule on
   * yesterday — so the verdict is taken here, on the final answers, and the
   * applicant is walked to the first page that needs attention with the same
   * sentence the page shows.
   */
  const normalized = normalizeApplicationAnswers(formData);
  const verdict = evaluateApplicationRules({
    rules: company?.applicationRules,
    applicationConfig: company?.applicationConfig,
    formData: normalized,
  });
  if (verdict.blocking.length > 0) {
    const [first] = verdict.blocking;
    showError(first.message);
    goTo(first.semanticStep);
    return { ok: false, formData };
  }

  const requiredUploadErrors = [];
  if (!cdlUploadConfig.hidden && cdlUploadConfig.required) {
    if (!hasUploadedFile(formData['cdl-front'])) requiredUploadErrors.push('CDL Front');
    if (!hasUploadedFile(formData['cdl-back'])) requiredUploadErrors.push('CDL Back');
  }
  if (!medCardConfig.hidden && medCardConfig.required && !hasUploadedFile(formData['medical-card-upload'])) {
    requiredUploadErrors.push('Medical Card');
  }
  if (!mvrConsentConfig.hidden && mvrConsentConfig.required && !hasUploadedFile(formData['mvr-consent-upload'])) {
    requiredUploadErrors.push('Signed MVR authorization form');
  }
  if (requiredUploadErrors.length > 0) {
    showError(`Please upload required documents before submitting: ${requiredUploadErrors.join(', ')}.`);
    goTo('license');
    return { ok: false, formData };
  }

  // Validate signature and certification
  if (!formData.signature || !formData['final-certification']) {
    showError("Please complete the electronic signature.");
    setCurrentStep(consentStepIndex);
    return { ok: false, formData };
  }

  // Validate email and phone
  if (!isValidEmail(formData.email)) {
    showError("Invalid Email Address.");
    return { ok: false, formData };
  }
  if (!isValidPhone(formData.phone)) {
    showError("Invalid Phone Number.");
    return { ok: false, formData };
  }

  return { ok: true, formData: normalized };
}

export default runSubmissionPreflight;
