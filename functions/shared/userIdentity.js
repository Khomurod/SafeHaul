// functions/shared/userIdentity.js
//
// Single source of truth for turning a stored user profile (+ its Firebase Auth
// record) into a display name and email.
//
// WHY THIS EXISTS: team rosters used to read `users/{uid}.name` and nothing else.
// Profiles in this project are written by several different paths that disagree on
// the field name — `createPortalUser`/`registerCompany` write `name`, driver and
// onboarding flows write `firstName`/`lastName`, and some records only ever had
// the Firebase Auth `displayName`. Any profile that did not happen to use `name`
// rendered as the literal string "Unknown" with a blank email, which is
// indistinguishable from a genuinely missing account.
//
// Firebase Auth is the authoritative fallback: a user cannot be a member of a
// company without an Auth record, and that record always carries the email the
// admin invited. So when the Firestore profile is missing or incomplete, identity
// is recovered from Auth rather than being reported as unknown.

/** Trim a value and return null unless it is a non-empty string. */
function cleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Best display name held in a Firestore user profile, across every field name
 * this project has historically written. Returns null when the profile carries
 * no usable name (so callers can fall back to Auth).
 */
function nameFromProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;

    const direct = cleanString(profile.name)
        || cleanString(profile.fullName)
        || cleanString(profile.displayName);
    if (direct) return direct;

    // Composite names: tolerate either half being absent rather than requiring both.
    const parts = [cleanString(profile.firstName), cleanString(profile.lastName)].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
}

/** Best email held in a Firestore user profile. */
function emailFromProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    return cleanString(profile.email);
}

/**
 * Resolve a member's identity from the Firestore profile first, then the Auth
 * record. Each field reports where it came from so callers can repair the
 * profile (see `profileRepairPayload`) and so the UI can explain a record whose
 * identity had to be recovered instead of silently presenting it as normal.
 *
 * @param {object|null} profile  `users/{uid}` data, or null when the doc is absent.
 * @param {object|null} authUser Firebase Auth UserRecord, or null when absent.
 * @returns {{name: string|null, email: string|null,
 *            nameSource: 'profile'|'auth'|null, emailSource: 'profile'|'auth'|null}}
 */
function resolveUserIdentity(profile, authUser) {
    const profileName = nameFromProfile(profile);
    const profileEmail = emailFromProfile(profile);
    const authName = authUser ? cleanString(authUser.displayName) : null;
    const authEmail = authUser ? cleanString(authUser.email) : null;

    const name = profileName || authName;
    const email = profileEmail || authEmail;

    return {
        name,
        email,
        nameSource: profileName ? 'profile' : (authName ? 'auth' : null),
        emailSource: profileEmail ? 'profile' : (authEmail ? 'auth' : null),
    };
}

/**
 * Fields that should be merged back into `users/{uid}` so the profile stops
 * depending on an Auth lookup. Only ever returns values recovered from Auth, so
 * a profile that already stores a name/email is never overwritten.
 *
 * @returns {object} merge payload; empty when there is nothing to repair.
 */
function profileRepairPayload(identity) {
    const payload = {};
    if (identity.nameSource === 'auth' && identity.name) payload.name = identity.name;
    if (identity.emailSource === 'auth' && identity.email) payload.email = identity.email;
    return payload;
}

module.exports = {
    cleanString,
    nameFromProfile,
    emailFromProfile,
    resolveUserIdentity,
    profileRepairPayload,
};
