// functions/shared/companyAgreementWording.js
//
// Company-specific wording for the legal agreements, VERSIONED.
//
// WHY THIS EXISTS
// ---------------
// The platform registry (`legalAgreements.js`) is one wording for every
// carrier, with the carrier's name filled in. Some carriers need their own text
// — their counsel's FCRA disclosure, their own MVR authorization. Letting them
// edit a free-text field would be the defect the registry was built to end: a
// later edit would change what an earlier applicant is recorded as having
// agreed to.
//
// So a company's wording is a list of immutable versions, and every version's
// id is a hash of its own text. Publishing new wording adds a version and moves
// the pointer; nothing is ever overwritten. A submission records the version id
// the applicant actually saw, and the snapshot freezes that version's text — so
// changing the wording later can never change what an older applicant signed.
//
// Stored at `companies/{companyId}/legal_agreements/{agreementId}`:
//   { currentVersion, versions: { [versionId]: { body, createdAt, createdBy, note } } }
// No client may read or write it (no Firestore rule = default deny); the two
// callables in `functions/companyAgreements.js` are the only way in, and only a
// super admin may publish. Legal wording is a super-admin responsibility.
//
// Pure module: no I/O, no firebase-admin, so both the callable tests and the
// snapshot tests can drive it directly.

const crypto = require('crypto');
const { AGREEMENTS, renderAgreementBody } = require('./legalAgreements');

/** Company version ids start with this, so they can never collide with `v1` / `legacy-1`. */
const COMPANY_VERSION_PREFIX = 'c-';
const MAX_BODY_CHARS = 20000;
const MIN_BODY_CHARS = 40;

function isCompanyVersion(version) {
    return typeof version === 'string' && version.startsWith(COMPANY_VERSION_PREFIX);
}

/** Wording is normalised before it is hashed, so the id is a property of the text alone. */
function normalizeWordingBody(body) {
    if (typeof body !== 'string') throw new Error('Agreement wording must be text.');
    const normalized = body.replace(/\r\n?/g, '\n').trim();
    if (normalized.length < MIN_BODY_CHARS) throw new Error(`Agreement wording must be at least ${MIN_BODY_CHARS} characters.`);
    if (normalized.length > MAX_BODY_CHARS) throw new Error(`Agreement wording must be at most ${MAX_BODY_CHARS} characters.`);
    return normalized;
}

/** Content-addressed: the same text for the same agreement is always the same version. */
function companyVersionId(agreementId, body) {
    const digest = crypto.createHash('sha256').update(`${agreementId}\n${body}`).digest('hex');
    return `${COMPANY_VERSION_PREFIX}${digest.slice(0, 12)}`;
}

/**
 * A stored wording document, validated. A version whose id does not match its
 * own text is dropped — it cannot be the version anybody was shown — and a
 * `currentVersion` pointing nowhere is cleared. Returns null when nothing usable
 * remains, which callers treat as "this company uses the platform wording".
 */
function normalizeWordingDoc(agreementId, raw) {
    if (!AGREEMENTS[agreementId] || !raw || typeof raw !== 'object') return null;
    const versions = {};
    const rawVersions = raw.versions && typeof raw.versions === 'object' ? raw.versions : {};
    for (const [id, entry] of Object.entries(rawVersions)) {
        if (!entry || typeof entry !== 'object' || typeof entry.body !== 'string') continue;
        if (companyVersionId(agreementId, entry.body) !== id) continue;
        versions[id] = {
            body: entry.body,
            createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
            createdBy: typeof entry.createdBy === 'string' ? entry.createdBy : null,
            note: typeof entry.note === 'string' ? entry.note : null,
        };
    }
    if (Object.keys(versions).length === 0) return null;
    const currentVersion = versions[raw.currentVersion] ? raw.currentVersion : null;
    return { agreementId, currentVersion, versions };
}

/** Every wording document of a company, keyed by agreement id, validated. */
function normalizeWordingDocs(rawDocs) {
    const docs = {};
    for (const [agreementId, raw] of Object.entries(rawDocs && typeof rawDocs === 'object' ? rawDocs : {})) {
        const normalized = normalizeWordingDoc(agreementId, raw);
        if (normalized) docs[agreementId] = normalized;
    }
    return docs;
}

/**
 * The document after publishing `body` as the current wording. Existing
 * versions are never touched; publishing text that already exists as a version
 * simply points `currentVersion` back at it.
 */
function publishWordingVersion(existingRaw, agreementId, body, { createdBy = null, now = new Date().toISOString(), note = null } = {}) {
    if (!AGREEMENTS[agreementId]) throw new Error(`Unknown legal agreement: ${agreementId}`);
    const normalizedBody = normalizeWordingBody(body);
    const existing = normalizeWordingDoc(agreementId, existingRaw) || { versions: {} };
    const version = companyVersionId(agreementId, normalizedBody);
    const versions = { ...existing.versions };
    if (!versions[version]) {
        versions[version] = { body: normalizedBody, createdAt: now, createdBy, note };
    }
    return { agreementId, currentVersion: version, versions, updatedAt: now };
}

/** Back to the platform wording: the versions stay (history), the pointer clears. */
function revertToPlatformWording(existingRaw, agreementId, { now = new Date().toISOString() } = {}) {
    const existing = normalizeWordingDoc(agreementId, existingRaw);
    if (!existing) return null;
    return { agreementId, currentVersion: null, versions: existing.versions, updatedAt: now };
}

/**
 * Resolve one agreement's presented text at a version that may be the
 * company's. Returns null when the version is not one of the company's, so the
 * caller falls back to the platform registry.
 */
function resolveCompanyAgreement(agreementId, version, wordingDocs, { companyName } = {}) {
    if (!isCompanyVersion(version)) return null;
    const agreement = AGREEMENTS[agreementId];
    const doc = wordingDocs && wordingDocs[agreementId];
    const entry = doc && doc.versions && doc.versions[version];
    if (!agreement || !entry) return null;
    return {
        id: agreementId,
        version,
        title: agreement.title,
        body: renderAgreementBody(entry.body, { companyName }),
        requiresSignature: agreement.requiresSignature,
        presentedOn: agreement.presentedOn || 'consent',
        legacy: false,
        companyWording: true,
    };
}

/**
 * The agreement set as THIS company presents it: platform wording, except
 * where the company has published its own current version.
 */
function applyCompanyWording(platformSet, wordingDocs, { companyName } = {}) {
    return platformSet.map((agreement) => {
        const doc = wordingDocs && wordingDocs[agreement.id];
        if (!doc || !doc.currentVersion) return agreement;
        return resolveCompanyAgreement(agreement.id, doc.currentVersion, wordingDocs, { companyName }) || agreement;
    });
}

/**
 * Which version of each agreement a submission is bound to.
 *
 * The acceptance evidence names the version the applicant was shown. A company
 * version is honoured only if it exists in the company's own record — so a
 * client cannot invent one — and a platform version only if it is a current
 * (non-legacy) entry of that agreement. When the evidence names none, the
 * company's current version is used, or the platform version where the company
 * has no wording of its own.
 */
function resolveAgreementVersions({ platformVersion, acceptances, wordingDocs }) {
    const given = acceptances && typeof acceptances === 'object' ? acceptances : {};
    const versions = {};
    for (const agreementId of Object.keys(AGREEMENTS)) {
        const doc = wordingDocs && wordingDocs[agreementId];
        const claimed = given[agreementId] && typeof given[agreementId] === 'object' ? given[agreementId].version : null;
        const platformEntry = claimed && !isCompanyVersion(claimed) ? AGREEMENTS[agreementId].versions[claimed] : null;
        if (isCompanyVersion(claimed) && doc && doc.versions[claimed]) {
            versions[agreementId] = claimed;
        } else if (platformEntry && !platformEntry.legacy) {
            // A current platform version the applicant was actually shown — the
            // company may have published its own wording between the page loading
            // and the submission landing. The signature binds to what they read,
            // never to text that arrived afterwards. (A `legacy-*` claim is not
            // honoured: those bodies exist for reconstruction, not for presenting.)
            versions[agreementId] = claimed;
        } else if (doc && doc.currentVersion) {
            versions[agreementId] = doc.currentVersion;
        } else {
            versions[agreementId] = platformVersion;
        }
    }
    return versions;
}

module.exports = {
    COMPANY_VERSION_PREFIX,
    MAX_BODY_CHARS,
    MIN_BODY_CHARS,
    applyCompanyWording,
    companyVersionId,
    isCompanyVersion,
    normalizeWordingBody,
    normalizeWordingDoc,
    normalizeWordingDocs,
    publishWordingVersion,
    resolveAgreementVersions,
    resolveCompanyAgreement,
    revertToPlatformWording,
};
