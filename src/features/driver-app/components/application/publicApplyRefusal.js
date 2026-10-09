/**
 * Whether a failed submission was refused by the server or simply never got
 * there, and which page of the wizard a refusal points to.
 *
 * That difference decides what the applicant is told. An application that never
 * arrived is queued and replayed, so "Application Saved … will be automatically
 * submitted" is true. A refused one would get the same refusal on every replay.
 */
import { resolveWizardStepIndex } from '@shared/components/layout/Stepper';

/**
 * Errors where the server read the application and refused it, so the same
 * payload would get the same answer again. Everything else (a dropped connection
 * reported as `internal`, a timeout, a cold start, the rate limiter) is worth
 * retrying and worth the offline queue.
 *
 * Until 2026-10-01 every error was retried three times. Because a queue entry
 * existed, the applicant was then shown "Application Saved … will be automatically
 * submitted. No data will be lost." For a refusal that was false twice over. The
 * replay sends the identical payload into the identical refusal, and after ten
 * attempts it marks the entry failed without telling anyone. The driver believed
 * they had applied, and the carrier never received the application.
 */
const PERMANENT_REFUSALS = new Set([
  'functions/invalid-argument',
  'functions/failed-precondition',
  'functions/permission-denied',
  'functions/not-found',
  'functions/already-exists',
  'functions/out-of-range',
  'functions/unauthenticated',
  'functions/unimplemented',
]);

export function isPermanentRefusal(error) {
  return PERMANENT_REFUSALS.has(error?.code);
}

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
