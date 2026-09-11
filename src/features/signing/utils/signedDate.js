/**
 * "Date Signed" — the one prefill value that is not knowable when a document is
 * created or sent.
 *
 * Every other token a template carries is already true at send time: a date of
 * birth, a hire date, a licence expiry, a name, an address. `current_date` is
 * not. It means *the day the signer finished*, so resolving it while building
 * the envelope stamped the creation date into the field and the sealed PDF —
 * a document prepared on 7 May and signed in September printed 7 May.
 *
 * The fix is to leave the token unresolved through send (see `resolveFieldForSend`
 * in ./prefillEngine.js) and stamp it here, once, at signing time.
 *
 * This module is a LEAF on purpose: `prefillEngine` imports the key from here,
 * so nothing in here may import back. It is MIRRORED by `functions/shared/signedDate.js`,
 * which is the authoritative copy — `functions/` is CommonJS and deployed
 * separately, so the two cannot import each other and any change must be made
 * in both. The server, not this copy, decides the date: it stamps what the signer
 * is shown (`getPublicEnvelope`) and what is stored (`submitPublicEnvelope`), so
 * a mis-set device clock cannot put a date on screen that the sealed PDF then
 * contradicts. This copy serves the recruiter-side signer preview, and the
 * signing room's re-check for a session that spans UTC midnight — which reads the
 * server's own clock off `serverTime` rather than the device's.
 */

/** Same grammar as `prefillEngine`'s TOKEN_PATTERN — kept local to avoid a cycle. */
const TOKEN_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

/** The only binding/token whose meaning is "the date this was signed". */
export const SIGNING_DATE_KEY = 'current_date';

/** The deferred marker a sent document carries until the signer submits. */
export const SIGNING_DATE_PLACEHOLDER = `{{${SIGNING_DATE_KEY}}}`;

const normalizeString = (value) => (value === null || value === undefined ? '' : String(value));
const normalizeTokenKey = (value) => normalizeString(value).trim().toLowerCase();

/**
 * A signed date is rendered in UTC on BOTH sides of the wire so the value the
 * signer reads on screen is character-for-character the value the server stores
 * and the sealer draws. Formatting the screen in the browser's zone and the
 * stored value in the server's is what makes the two disagree for a signer west
 * of UTC — and a silent disagreement between screen and PDF is the whole bug
 * this change exists to remove. Same long US format as every other placeholder.
 */
export function formatSignedDate(date = new Date()) {
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
 *    leaves in place. This covers a hand-typed token inside longer text
 *    ("Signed on {{current_date}}"), which the field properties panel tells
 *    authors they may write.
 *  - `bindingKey === 'current_date'` — the palette's Date Signed field and every
 *    AI-placed date. Documents SENT BEFORE this change already had the creation
 *    date baked into `defaultValue` with no token left to find, so this arm is
 *    also what repairs those in flight.
 *
 * A date of birth, a hire date or a licence expiry reaches neither arm: they
 * resolve from their own context keys and carry their own bindings.
 */
export function resolveSignedDateValue(field = {}, now = new Date()) {
    const text = normalizeString(field?.defaultValue);
    const stamped = formatSignedDate(now);

    TOKEN_PATTERN.lastIndex = 0;
    if (TOKEN_PATTERN.test(text)) {
        TOKEN_PATTERN.lastIndex = 0;
        const replaced = text.replace(TOKEN_PATTERN, (match, tokenKey) =>
            (normalizeTokenKey(tokenKey) === SIGNING_DATE_KEY ? stamped : match));
        if (replaced !== text) return replaced;
    }

    if (normalizeTokenKey(field?.bindingKey) === SIGNING_DATE_KEY) return stamped;

    return null;
}

/** Stamp every signing-date field in a list; every other field is returned untouched. */
export function stampSignedDateFields(fields = [], now = new Date()) {
    return fields.map((field) => {
        if (!field || typeof field !== 'object') return field;
        const value = resolveSignedDateValue(field, now);
        return value === null ? field : { ...field, defaultValue: value };
    });
}

/**
 * Re-stamp an envelope that is already open, for the case a signing session
 * spans UTC midnight: the room showed the day the document was opened while the
 * server will seal the day it was submitted. Returns `null` when nothing moved,
 * so a caller can skip the state update entirely — which is every submission but
 * the rare one that crosses the boundary.
 *
 * A value the signer has TYPED is left alone: it is theirs, and the server
 * decides the stored value for a Date Signed field regardless. Only a value that
 * still matches the stamp it was seeded with follows the new one.
 */
export function rollSignedDateFields(fields = [], fieldValues = {}, at = new Date()) {
    const next = stampSignedDateFields(fields, at);
    if (!next.some((field, i) => field?.defaultValue !== fields[i]?.defaultValue)) return null;

    const nextValues = { ...fieldValues };
    next.forEach((field, i) => {
        const before = fields[i];
        if (!field || !before || field.defaultValue === before.defaultValue) return;
        if (nextValues[field.id] === before.defaultValue) nextValues[field.id] = field.defaultValue;
    });

    return { fields: next, fieldValues: nextValues };
}
