/**
 * "Date Signed" — the one prefill value that is not knowable when a document is
 * created or sent, resolved server-side at the moment the signer submits.
 *
 * Every other token a template carries is already true at send time: a date of
 * birth, a hire date, a licence expiry, a name, an address. `current_date` is
 * not. It means *the day the signer finished*, so resolving it while building
 * the envelope stamped the creation date into the stored value and therefore
 * into the sealed PDF — a document prepared on 7 May and signed in September
 * printed 7 May.
 *
 * This file MIRRORS `src/features/signing/utils/signedDate.js`. The two cannot
 * import each other — `functions/` is CommonJS and deployed separately — so any
 * change here must be made in both places. THIS copy is the authoritative one,
 * and it runs on both sides of the signer's visit: `getPublicEnvelope` stamps
 * what is shown and `submitPublicEnvelope` stamps what is stored and sealed.
 * Keeping both on the server clock is the point — a device with a wrong date
 * cannot display one day and have the PDF print another. `getPublicEnvelope`
 * also reports the instant it stamped, so a room left open across UTC midnight
 * can re-check against this clock before it submits instead of the device's.
 */

/** Same grammar as the placeholder tokens the prefill engine resolves. */
const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The only binding/token whose meaning is "the date this was signed". */
const SIGNING_DATE_KEY = 'current_date';

/** The deferred marker a sent document carries until the signer submits. */
const SIGNING_DATE_PLACEHOLDER = `{{${SIGNING_DATE_KEY}}}`;

function normalizeString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeTokenKey(value) {
  return normalizeString(value).trim().toLowerCase();
}

/**
 * Rendered in UTC on both sides of the wire so the value the signer read on
 * screen is character-for-character the value stored here and drawn into the
 * PDF. It also agrees with `signedAt`, which is a server timestamp, so the
 * audit trail and the printed date can never tell different stories.
 */
function formatSignedDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The value a field must carry at the moment of signing, or `null` when the
 * field means nothing of the sort and must be left exactly as it is.
 *
 * Two shapes count, and only these two:
 *
 *  - a surviving `{{current_date}}` token, which the send path now deliberately
 *    leaves in place — including inside longer text ("Signed on {{current_date}}"),
 *    which the field properties panel tells authors they may write.
 *  - `bindingKey === 'current_date'` — the palette's Date Signed field and every
 *    AI-placed date. Documents SENT BEFORE this change already had the creation
 *    date baked into `defaultValue` with no token left to find, so this arm is
 *    also what repairs those in flight.
 *
 * A date of birth, a hire date or a licence expiry reaches neither arm: they
 * resolve from their own context keys and carry their own bindings.
 */
function resolveSignedDateValue(field = {}, now = new Date()) {
  const text = normalizeString(field && field.defaultValue);
  const stamped = formatSignedDate(now);

  TOKEN_PATTERN.lastIndex = 0;
  if (TOKEN_PATTERN.test(text)) {
    TOKEN_PATTERN.lastIndex = 0;
    const replaced = text.replace(TOKEN_PATTERN, (match, tokenKey) =>
      (normalizeTokenKey(tokenKey) === SIGNING_DATE_KEY ? stamped : match));
    if (replaced !== text) return replaced;
  }

  if (normalizeTokenKey(field && field.bindingKey) === SIGNING_DATE_KEY) return stamped;

  return null;
}

/** Stamp every signing-date field in a list; every other field is returned untouched. */
function stampSignedDateFields(fields = [], now = new Date()) {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => {
    if (!field || typeof field !== 'object') return field;
    const value = resolveSignedDateValue(field, now);
    return value === null ? field : { ...field, defaultValue: value };
  });
}

module.exports = {
  SIGNING_DATE_KEY,
  SIGNING_DATE_PLACEHOLDER,
  formatSignedDate,
  resolveSignedDateValue,
  stampSignedDateFields,
};
