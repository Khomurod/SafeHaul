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

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Ten national digits, a leading US 1 aside, as the server compares phones. */
function nationalDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * The facts another device is matched on, as one comparable value, or null when
 * they are not all there. Reads `lastName`, `dob`, `ssn`, `email` and `phone`,
 * which the answers and the save payload both carry under those names.
 *
 * @param {object} answers
 * @returns {string|null}
 */
export function resumeIdentityOf(answers) {
  const facts = answers || {};
  const lastName = text(facts.lastName).toLowerCase();
  const dob = text(facts.dob);
  const ssn = String(facts.ssn || '').replace(/\D/g, '');
  const email = text(facts.email).toLowerCase();
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
 * Remembers the identity of the last save the server confirmed, in memory only.
 *
 * @returns {{ record: (payload: object, result: object) => void, holds: (answers: object) => boolean }}
 */
export function heldIdentityTracker() {
  let held = null;
  return {
    /** After every server save: only a confirmed one (`saved`) moves it. */
    record(payload, result) {
      if (result?.saved) held = resumeIdentityOf(payload);
    },
    /** Whether the server confirmed a save carrying exactly these facts. */
    holds(answers) {
      const identity = resumeIdentityOf(answers);
      return identity !== null && identity === held;
    },
  };
}
