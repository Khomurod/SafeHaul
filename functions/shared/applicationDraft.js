/**
 * Server-side draft of an in-progress driver application.
 *
 * ## What this is for
 *
 * Nothing was written server-side until an applicant pressed Submit on the last
 * of nine pages. The only intermediate save was a `localStorage` key, whose
 * per-step write was gated behind the E2E test flag, so in production an
 * applicant who closed the tab, lost a connection or hit a failing CDL scan lost
 * everything they had typed. Their uploaded documents, meanwhile, were already
 * sitting in Cloud Storage with no record connecting them to anybody.
 *
 * ## Why drafts do not live in `applications`
 *
 * Because creating a document under `companies/{id}/applications/{appId}` fires
 * four triggers: a recruiter notification, an "application received" email to the
 * applicant, a master `drivers/{id}` shadow profile, and the dashboard counters.
 * Writing a draft there on the first Next would email every half-finished
 * applicant to say their application had been received and file a driver profile
 * for anyone who typed a name and left. That is not a side effect to be worked
 * around; it is the reason this collection is separate and promoted at submit.
 *
 * ## Identity
 *
 * The document id is the **existing** deterministic applicant key —
 * `sha256(companyId:email:phone)` truncated to 20 hex characters, from
 * `./buildApplicationDoc.js`. Reusing it rather than inventing a second scheme
 * means a draft and the application it becomes share one identity, repeated saves
 * merge idempotently, and nothing has to be migrated at submission.
 *
 * A separate `identityKey` is an HMAC over the applicant's last name, date of
 * birth and Social Security Number. It exists so a returning applicant who types
 * a *different* email or phone can still be recognised. It is a keyed hash and
 * never the values themselves.
 *
 * ## What is never stored
 *
 * The SSN and the signature, matching what the local draft has always stripped.
 * The draft therefore holds no Social Security Number at all — not encrypted, not
 * hashed beyond the identity HMAC, not last-four. On resume the applicant
 * re-enters it, which the form already requires, so a successful resume never
 * emits an SSN to a browser.
 */

const crypto = require('crypto');
const { admin, db } = require('../firebaseAdmin');

/** Server-only subcollection, denied to every client in `firestore.rules`. */
const COLLECTION = 'application_drafts';

/**
 * How long an unfinished application is kept.
 *
 * Long enough that a driver who starts on a phone at a truck stop and finishes
 * days later still finds their work; short enough that abandoned partial records
 * carrying names, dates of birth and licence numbers do not accumulate
 * indefinitely. Enforced by a Firestore TTL policy on `expiresAt`.
 */
const RETENTION_DAYS = 30;

/** Ceilings on what one draft may hold. A draft is a form, not a file store. */
const MAX_FIELDS = 400;
const MAX_STRING_CHARS = 20000;
const MAX_ARRAY_ITEMS = 60;
const MAX_DEPTH = 6;
const MAX_PAYLOAD_CHARS = 512 * 1024;

/**
 * Fields never written to a draft.
 *
 * `applicationDraftStorage.js` has always stripped exactly these two from the
 * local copy. The server does the same, because the reasons are the same and
 * because a client-side guarantee is not one.
 *
 * Declared in `neverStoredDraftFields.js` and re-exported here, so this module's
 * public surface is unchanged. The list moved because the submission validator and
 * the browser's own check both need it, and reading it from here dragged
 * `firebaseAdmin` into a frontend test — which has no `firebase-admin` in CI.
 */
const { NEVER_STORED } = require('./neverStoredDraftFields');

/**
 * Keys that must never be written as fields.
 *
 * `JSON.parse` produces `__proto__` as an *own* property, and `clean.__proto__ = x`
 * then reassigns the prototype instead of adding a field — so the value silently
 * vanishes, or worse, changes the object's shape. Firestore also rejects a field
 * name that both starts and ends with a double underscore, so `__proto__` would
 * fail the whole write if it ever did get through. Skipped explicitly rather than
 * relying on either of those accidents.
 */
const UNSAFE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/**
 * Domain-separated key for the identity HMAC.
 *
 * Derived from `SMS_ENCRYPTION_KEY` rather than adding a tenth manually-managed
 * secret — but derived, not used directly: an HMAC key for applicant identity
 * must not be the same bytes that encrypt SMS credentials, so the purpose string
 * separates them. Rotating the base key rotates this with it, which would orphan
 * existing identity matches; drafts expire in 30 days, so that self-heals rather
 * than needing a migration.
 */
const IDENTITY_KEY_PURPOSE = 'safehaul:application-draft-identity:v1';

function identityHmacKey() {
    const base = process.env.SMS_ENCRYPTION_KEY;
    if (!base || base.length !== 32) {
        throw new Error('Draft identity matching requires SMS_ENCRYPTION_KEY to be set to 32 characters.');
    }
    return crypto.createHmac('sha256', base).update(IDENTITY_KEY_PURPOSE).digest();
}

/** Digits only, so `123-45-6789` and `123456789` are one person. */
function normalizeSsn(value) {
    return String(value || '').replace(/\D/g, '');
}

/** Case, accents and punctuation removed, so `O'Brien` and `obrien` match. */
function normalizeName(value) {
    return String(value || '')
        // NFKD splits an accented letter into a plain letter plus a combining
        // mark, and the a-z filter below then drops the mark — so `Muñoz` and
        // `Munoz` are one name without needing a diacritics range of its own.
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
}

/** `YYYY-MM-DD`, or empty when the value is not a date at all. */
function normalizeDob(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/**
 * The keyed identity of an applicant within one company.
 *
 * Returns null when any component is missing or an SSN is not nine digits —
 * a partial identity must never match anything, because a hash of mostly-empty
 * strings would match every other mostly-empty applicant.
 *
 * @returns {string|null} 64 hex characters, or null when not identifiable
 */
function buildIdentityKey({ companyId, lastName, dob, ssn }) {
    const digits = normalizeSsn(ssn);
    const name = normalizeName(lastName);
    const birth = normalizeDob(dob);
    if (!companyId || !name || !birth || digits.length !== 9) return null;

    return crypto.createHmac('sha256', identityHmacKey())
        .update(`${companyId}:${name}:${birth}:${digits}`)
        .digest('hex');
}

/**
 * Whether a contact detail the applicant just supplied matches the stored draft.
 *
 * This is the possession-ish half of the resume check. Knowing a name, a date of
 * birth and an SSN is not enough on its own: an applicant must also present an
 * email or phone that the stored draft already holds. It raises the bar from
 * "knows three facts about a person" to "knows three facts *and* one of their
 * contact details", and it is the difference between a resume feature and a
 * lookup service for anyone holding a stolen identity.
 */
function contactMatches(draft, { email, phone }) {
    const storedEmail = String(draft?.contactEmail || '').toLowerCase().trim();
    const storedPhone = String(draft?.contactPhone || '').replace(/\D/g, '');
    const givenEmail = String(email || '').toLowerCase().trim();
    const givenPhone = String(phone || '').replace(/\D/g, '');

    if (storedEmail && givenEmail && storedEmail === givenEmail) return true;
    // Ten digits minimum, so a stored blank or a two-digit typo cannot match.
    if (storedPhone.length >= 10 && storedPhone === givenPhone) return true;
    return false;
}

/**
 * Strips, bounds and shape-checks what the browser sent.
 *
 * Deliberately not an exact key allowlist. A company's custom questions produce
 * keys this module cannot know, and dropping them would quietly make those
 * answers the one thing a resume loses. So the rule is about shape and size:
 * the two sensitive fields are removed, scalars are bounded, arrays and objects
 * are bounded and depth-limited, and functions and other exotica cannot survive
 * a Firestore write anyway. The submission validator remains the authority on
 * whether the *content* is acceptable — a draft is only what someone typed.
 */
function sanitizeDraftData(value, depth = 0) {
    if (depth > MAX_DEPTH) return null;

    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, MAX_STRING_CHARS);
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeDraftData(item, depth + 1));
    }
    if (typeof value === 'object') {
        const clean = {};
        let kept = 0;
        for (const [key, item] of Object.entries(value)) {
            if (kept >= MAX_FIELDS) break;
            // At every depth, not only the top level. Nothing in the application
            // definition nests a field called `ssn` or `signature`, so there is
            // nothing legitimate to lose — and a guarantee that only holds for
            // flat data is one a future nested section would silently break.
            if (NEVER_STORED.includes(key)) continue;
            if (UNSAFE_KEYS.includes(key)) continue;
            if (typeof key !== 'string' || key.length > 120) continue;
            // Firestore reserves field names wrapped in double underscores.
            if (/^__.*__$/.test(key)) continue;
            clean[key] = sanitizeDraftData(item, depth + 1);
            kept += 1;
        }
        return clean;
    }
    // Functions, symbols, class instances: not draft data.
    return null;
}

/** True when the payload is small enough to be a form rather than an upload. */
function withinPayloadBudget(formData) {
    try {
        return JSON.stringify(formData || {}).length <= MAX_PAYLOAD_CHARS;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Resume tokens
// ---------------------------------------------------------------------------

/**
 * A resume token, hashed at rest.
 *
 * Follows the pattern already used for landing-page lead tokens: the value is
 * returned to the caller once and only its SHA-256 is stored, so a leaked
 * database row cannot be replayed. Compared in constant time, because a token
 * comparison that leaks its prefix through timing is a token comparison an
 * attacker can walk.
 */
function mintResumeToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return { token, hash: hashResumeToken(token) };
}

function hashResumeToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function resumeTokenMatches(storedHash, token) {
    const expected = Buffer.from(String(storedHash || ''), 'utf8');
    const actual = Buffer.from(hashResumeToken(token), 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function draftsCollection(companyId) {
    return db.collection('companies').doc(String(companyId)).collection(COLLECTION);
}

function expiresAt(now = Date.now()) {
    return new Date(now + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The shape returned to a browser.
 *
 * An allowlist, not the stored document: the document holds an identity HMAC and
 * a token hash, and neither has any business crossing to a client.
 */
function toClientDraft(doc) {
    const data = doc.data() || {};
    return {
        applicantKey: doc.id,
        formData: data.formData || {},
        lastStep: Number.isInteger(data.lastStep) ? data.lastStep : 0,
        lastSemanticStep: typeof data.lastSemanticStep === 'string' ? data.lastSemanticStep : null,
        // The browser's own write counter for the copy it last synced here. The
        // client compares it with the sequence *it* believes is synced to tell
        // "this is my copy" from "another device advanced it", without either side
        // comparing a device clock to a server one. Null for a draft written
        // before the field existed; the client falls back to progress then.
        clientSeq: Number.isInteger(data.clientSeq) ? data.clientSeq : null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
    };
}

module.exports = {
    COLLECTION,
    RETENTION_DAYS,
    MAX_FIELDS,
    MAX_STRING_CHARS,
    MAX_PAYLOAD_CHARS,
    NEVER_STORED,
    UNSAFE_KEYS,
    IDENTITY_KEY_PURPOSE,
    normalizeSsn,
    normalizeName,
    normalizeDob,
    buildIdentityKey,
    contactMatches,
    sanitizeDraftData,
    withinPayloadBudget,
    mintResumeToken,
    hashResumeToken,
    resumeTokenMatches,
    draftsCollection,
    expiresAt,
    toClientDraft,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
};
