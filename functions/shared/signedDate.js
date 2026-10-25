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
 * also reports the instant it stamped, and the signer's zone it read it in, so a
 * room left open across midnight can re-check against this clock before it
 * submits instead of the device's.
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
 * The time zone a Date Signed is read in: the one the signer's browser names, when
 * it is a real IANA zone this runtime knows, else UTC (a caller that names none,
 * such as a page from before zones were sent). The server's clock still decides
 * the instant; the zone only says which calendar day that instant was where the
 * signer sat, so a signer in Los Angeles at 9 pm reads today, not tomorrow. No
 * zone is more than a day from UTC, so a forged one can move the date by a day
 * at most, which an honest signer east or west of UTC would see anyway.
 */
function signerTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * The same zone and format on both sides of the wire, so the value the signer
 * read on screen is character-for-character the value stored here and drawn
 * into the PDF. The instant is the server's, as `signedAt` is, so the audit
 * trail and the printed date can never tell different stories.
 */
function formatSignedDate(date = new Date(), timeZone = 'UTC') {
  return date.toLocaleDateString('en-US', {
    timeZone: signerTimeZone(timeZone),
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
function resolveSignedDateValue(field = {}, now = new Date(), timeZone = 'UTC') {
  const text = normalizeString(field && field.defaultValue);
  const stamped = formatSignedDate(now, timeZone);

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
function stampSignedDateFields(fields = [], now = new Date(), timeZone = 'UTC') {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => {
    if (!field || typeof field !== 'object') return field;
    const value = resolveSignedDateValue(field, now, timeZone);
    return value === null ? field : { ...field, defaultValue: value };
  });
}

module.exports = {
  SIGNING_DATE_KEY,
  SIGNING_DATE_PLACEHOLDER,
  formatSignedDate,
  resolveSignedDateValue,
  signerTimeZone,
  stampSignedDateFields,
};
