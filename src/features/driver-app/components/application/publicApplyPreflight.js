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
import { PHONE_RULE_MESSAGE } from '@shared/utils/fieldValidators';
import { evaluateApplicationRules, normalizeApplicationAnswers } from '@/config/applicationRules';
import { lockedEmployerIssues } from '@/config/applicationLockedFields';
import { resolveApplicationGate } from '@/config/applicationGates';
import { employerRowMissingAnswers } from '@shared/utils/employmentApplicationHelpers';
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
   * The 49 CFR 40.25(j) drug and alcohol question. A draft saved before it
   * replaced the broader question was never asked it, and one resumed past
   * Qualifications would never reach it. The server cannot require it while
   * the Production frontend still asks the broader question.
   */
  if (!String(formData?.['pre-employment-test-positive'] ?? '').trim()) {
    showError('Please answer the drug and alcohol testing question on Qualifications to submit.');
    goTo('qualifications');
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

  /**
   * Employers the carrier locked, when this application is one a carrier prepared.
   *
   * The wizard renders those rows as fixed, so reaching this is either developer
   * tools or a row deleted from a page that did not know it was locked. Checked
   * here so the applicant is walked to the employment page with the sentence the
   * server would have refused them with, rather than meeting it after a failed
   * submission. `formData.lockedEmployers` is the browser's decorative copy; the
   * server checks the carrier's own record, which the driver cannot reach.
   */
  const lockedIssues = lockedEmployerIssues(formData?.lockedEmployers, normalized);
  if (lockedIssues.length > 0) {
    const [first] = lockedIssues;
    showError(first.message);
    goTo(first.semanticStep);
    return { ok: false, formData };
  }

  /**
   * What the Employment page requires of each employer when the company
   * requires the history: the reason for leaving, and the 49 CFR
   * 391.21(b)(10)(iv) answers for a job of the past three years. A draft saved
   * before the page asked them, and resumed past it, never answered them.
   */
  const employmentGate = resolveApplicationGate(company?.applicationConfig, 'employmentHistory');
  if (!employmentGate.hidden && employmentGate.required) {
    const employers = Array.isArray(normalized.employers) ? normalized.employers : [];
    for (let i = 0; i < employers.length; i += 1) {
      const missing = employerRowMissingAnswers(employers[i]);
      if (missing.length === 0) continue;
      const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0];
      showError(`Employer ${i + 1}: please add ${list} to submit.`);
      goTo('employment');
      return { ok: false, formData };
    }
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

  // Validate email and phone — and go to the page that holds them. Both used to be
  // refused here with a toast and no routing, which left the applicant on the
  // signature page with no idea where the field was (found 2026-10-01).
  if (!isValidEmail(formData.email)) {
    showError("Invalid Email Address.");
    goTo('contact');
    return { ok: false, formData };
  }
  if (!isValidPhone(formData.phone)) {
    showError(PHONE_RULE_MESSAGE);
    goTo('contact');
    return { ok: false, formData };
  }

  return { ok: true, formData: normalized };
}

export default runSubmissionPreflight;
