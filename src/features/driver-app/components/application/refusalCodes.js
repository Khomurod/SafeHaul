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
 * A refusal is neither retried nor left in the queue: the replay would send the
 * identical payload into the identical refusal, while a queue entry tells the
 * applicant their application will be sent — and the carrier never receives it.
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
