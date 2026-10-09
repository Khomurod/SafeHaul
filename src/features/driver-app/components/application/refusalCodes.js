/**
 * Which failed submissions the server read and refused, so the same payload
 * would get the same answer again. Everything else (a dropped connection
 * reported as `internal`, a timeout, a cold start) is worth retrying and worth
 * the offline queue.
 *
 * Apart from `publicApplyRefusal.js` because the offline queue reads it on every
 * page, and that file, which names the wizard page a refusal points to, brings
 * every page of the wizard with it.
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
