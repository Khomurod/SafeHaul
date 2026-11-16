/**
 * What another device finds a saved application by, and whether the server has
 * confirmed holding it.
 *
 * The server matches a last name, date of birth and nine-digit SSN (the keyed
 * identity it builds from them) plus an email or a ten-digit phone already on the
 * draft (`contactMatches` in functions/shared/applicationDraft.js). "Finish
 * later" names another device only when those facts are on the page AND the
 * server confirmed a save carrying exactly them: the local copy strips the SSN,
 * so its sync state alone cannot tell a confirmed identity from a failed save of
 * a new one.
 */

import { nationalDigits, normalizeDob, normalizeName, normalizeSsn } from '@shared/utils/applicantIdentity';

/**
 * The facts another device is matched on, as one comparable value, or null when
 * they are not all there. Reads `lastName`, `dob`, `ssn`, `email` and `phone`,
 * which the answers and the save payload both carry under those names. The name
 * and the date are normalized as the server's `buildIdentityKey` does, by the
 * same functions (`applicantIdentity.js`, mirrored from functions/shared): a
 * last name with no letter a-z, such as one written only in another script,
 * gives the server no identity key, so it gives none here either.
 *
 * @param {object} answers
 * @returns {string|null}
 */
export function resumeIdentityOf(answers) {
  const facts = answers || {};
  const lastName = normalizeName(facts.lastName);
  const dob = normalizeDob(facts.dob);
  const ssn = normalizeSsn(facts.ssn);
  const email = String(facts.email || '').trim().toLowerCase();
  const phone = nationalDigits(facts.phone);
  const matchablePhone = phone.length >= 10 ? phone : '';
  if (!lastName || !dob || ssn.length !== 9 || (!email && !matchablePhone)) return null;
  return JSON.stringify([lastName, dob, ssn, email, matchablePhone]);
}

/**
 * Whether these answers carry everything another device is matched on. The SSN
 * lives only in page state, so after a reload this is false even when an earlier
 * save left the key behind: it may say too little, never too much.
 */
export const canBeFoundElsewhere = (answers) => resumeIdentityOf(answers) !== null;

/**
 * Remembers the identity of the last save the server confirmed, in memory only,
 * with the application it was saved for (`epoch`, the tab's discard mark, which a
 * Start Over or a discard elsewhere changes). A confirmation for an application
 * that has since ended counts for nothing, even one that arrives after the end.
 *
 * @returns {{
 *   record: (payload: object, result: object, epoch: unknown) => void,
 *   holds: (answers: object, epoch: unknown) => boolean,
 * }}
 */
export function heldIdentityTracker() {
  let held = null;
  return {
    /** After every server save, with the epoch it was sent in: only a confirmed one (`saved`) moves it. */
    record(payload, result, epoch) {
      if (result?.saved) held = { identity: resumeIdentityOf(payload), epoch };
    },
    /** Whether the server confirmed a save carrying exactly these facts, for this application. */
    holds(answers, epoch) {
      const identity = resumeIdentityOf(answers);
      return identity !== null && held !== null && identity === held.identity && epoch === held.epoch;
    },
  };
}
