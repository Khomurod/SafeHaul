/**
 * Whether a failed submission was refused by the server or simply never got
 * there, and which page of the wizard a refusal points to.
 *
 * That difference decides what the applicant is told. An application that never
 * arrived is queued and replayed; a refused one would get the same refusal on
 * every replay, so it is said, with the page to fix, instead.
 */
import { resolveWizardStepIndex } from '@shared/components/layout/Stepper';
import { fetchPublicProfileBySlug } from '../../services/publicProfileService';

export { isPermanentRefusal } from './refusalCodes';

/**
 * The server's rate limit: too many submissions from this connection just now.
 * Not worth the queue, which would only spend the limit again, and not worth
 * hiding: the applicant is told in the server's words to wait a moment.
 */
export function isRateLimited(error) {
  return error?.code === 'functions/resource-exhausted';
}

/**
 * The server refused the submission because a Company Admin edited the
 * application after this copy was taken (`functions/shared/companyEdits.js`).
 */
export function isCarrierUpdate(error) {
  return error?.code === 'functions/failed-precondition'
    && (error?.details?.issues || []).some((issue) => issue?.code === 'carrier-updated');
}

/**
 * The wizard step a refusal names (the server's `details.issues[].semanticStep`),
 * or null when it names none and the applicant should stay where they are.
 */
export function refusalStepIndex(error, hasCustomQuestions) {
  const issue = (error?.details?.issues || []).find((entry) => entry?.semanticStep);
  return issue ? resolveWizardStepIndex(issue.semanticStep, hasCustomQuestions) : null;
}

/**
 * The same page, by the company's settings as they are now. The server judged
 * those, which can differ from the ones the page loaded; the page takes them too
 * (`setCompany`), so the field the refusal sends the applicant to is there.
 */
export async function refusalStepNow(error, { slug, sandbox, company, setCompany }) {
  const current = sandbox ? null : await fetchPublicProfileBySlug(slug).catch(() => null);
  const taken = Boolean(current) && current.id === company?.id;
  if (taken) setCompany(current);
  const asked = (taken ? current.customQuestions : company?.customQuestions) || [];
  return refusalStepIndex(error, asked.length > 0);
}
