// The guest application's final pre-flight: everything the browser checks
// before it spends a submission attempt, and where it sends the applicant when
// something is missing.
//
// The server refuses every one of these independently
// (`assertRequiredUnpersistedFields`, `assertRequiredUploads`,
// `assertApplicationRules`); this half exists to tell the applicant which
// answer and take them to it, not to be the enforcement.
//
// THE EARLIEST PAGE WINS. Every check runs, and the applicant is sent to the
// earliest page with something missing, with that page's sentence: a resumed
// applicant missing a licence upload and an employer's reason for leaving goes
// to page three, not to page six and then back to page three. On one page, the
// order of the checks below decides.
import { buildSemanticStepOrder, resolveWizardStepIndex } from '@shared/components/layout/wizardSteps';
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
  cdlUploadConfig,
  medCardConfig,
  mvrConsentConfig,
  setCurrentStep,
  showError,
}) {
  const hasCustomQuestions = customQuestions.length > 0;
  /** What is missing, as `{ semanticStep, message }`, in the order checked. */
  const problems = [];
  const refuse = (semanticStep, message) => problems.push({ semanticStep, message });

  /**
   * Required answers a resumed application could not have brought back.
   *
   * A draft never stores `ssn`, so an applicant who resumed part-way through has
   * never been asked for it and the step that collects it never ran its validation.
   */
  const missingUnpersisted = getMissingRequiredUnpersistedFields(company?.applicationConfig, formData);
  if (missingUnpersisted.length > 0) {
    const labels = missingUnpersisted.map((field) => field.label).join(', ');
    const subject = missingUnpersisted.length > 1 ? 'They are' : 'It is';
    refuse(missingUnpersisted[0].semanticStep, `Please re-enter your ${labels} to submit. ${subject} not saved with your progress for security.`);
  }

  /**
   * The 49 CFR 40.25(j) drug and alcohol question. A draft saved before it
   * replaced the broader question was never asked it, and one resumed past
   * Qualifications would never reach it. The server cannot require it while
   * the Production frontend still asks the broader question.
   */
  if (!String(formData?.['pre-employment-test-positive'] ?? '').trim()) {
    refuse('qualifications', 'Please answer the drug and alcohol testing question on Qualifications to submit.');
  }

  /**
   * The company's Application Rules, and any impossible date, over the whole
   * application. A resumed draft may never have revisited the page whose rule
   * now fails — the licence expired last week, the company turned a rule on
   * yesterday — so the verdict is taken here, on the final answers, with the
   * same sentence the page shows. Every blocking issue counts: the first in the
   * verdict is not the earliest page's.
   */
  const normalized = normalizeApplicationAnswers(formData);
  const verdict = evaluateApplicationRules({
    rules: company?.applicationRules,
    applicationConfig: company?.applicationConfig,
    formData: normalized,
  });
  verdict.blocking.forEach((issue) => refuse(issue.semanticStep, issue.message));

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
  const [lockedIssue] = lockedEmployerIssues(formData?.lockedEmployers, normalized);
  if (lockedIssue) refuse(lockedIssue.semanticStep, lockedIssue.message);

  /**
   * What the Employment page requires of each employer when the company
   * requires the history: the reason for leaving, and the 49 CFR
   * 391.21(b)(10)(iv) answers for a job of the past three years. A draft saved
   * before the page asked them, and resumed past it, never answered them.
   */
  const employmentGate = resolveApplicationGate(company?.applicationConfig, 'employmentHistory');
  if (!employmentGate.hidden && employmentGate.required) {
    const employers = Array.isArray(normalized.employers) ? normalized.employers : [];
    const index = employers.findIndex((row) => employerRowMissingAnswers(row).length > 0);
    if (index >= 0) {
      const missing = employerRowMissingAnswers(employers[index]);
      const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0];
      refuse('employment', `Employer ${index + 1}: please add ${list} to submit.`);
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
    refuse('license', `Please upload required documents before submitting: ${requiredUploadErrors.join(', ')}.`);
  }

  // Validate signature and certification
  if (!formData.signature || !formData['final-certification']) {
    refuse('consent', "Please complete the electronic signature.");
  }

  // Validate email and phone — and go to the page that holds them, so the
  // applicant is never left on the signature page with no idea where the field is.
  if (!isValidEmail(formData.email)) refuse('contact', "Invalid Email Address.");
  if (!isValidPhone(formData.phone)) refuse('contact', PHONE_RULE_MESSAGE);

  // The earliest page; on one page, the first check. A step the order does not
  // know ranks as the first page, where `resolveWizardStepIndex` sends it.
  const order = buildSemanticStepOrder(hasCustomQuestions);
  const pageOf = ({ semanticStep }) => Math.max(0, order.indexOf(semanticStep));
  const first = problems.reduce((best, problem) => (pageOf(problem) < pageOf(best) ? problem : best), problems[0]);
  if (!first) return { ok: true, formData: normalized };

  showError(first.message);
  setCurrentStep(resolveWizardStepIndex(first.semanticStep, hasCustomQuestions));
  return { ok: false, formData };
}

export default runSubmissionPreflight;
