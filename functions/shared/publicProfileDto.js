// functions/shared/publicProfileDto.js
//
// A4: the single, curated projection of a company document onto the
// world-readable `public_profiles/{companyId}` surface. Keeping it here as a
// pure, dependency-free function means:
//   1. The `syncPublicProfile` trigger and the `backfillPublicProfiles` callable
//      share one definition (no drift between the two writers).
//   2. The allowlist below is the *only* way a field reaches the public surface,
//      so PII added to the source `companies/{id}` doc later can never leak —
//      unknown fields are simply never copied.
//   3. It is unit-testable without booting firebase-admin, so the regression test
//      guards the real implementation rather than a hand-copied mirror.

/**
 * Whitelisted applicationConfig keys exposed on public apply pages.
 *
 * These are the CANONICAL gate ids the settings UI (StandardQuestionsConfig)
 * writes. `addressHistory`, `employmentHistory`, `mvrConsent`, `referralSource`
 * and `emergencyContacts` were previously absent, so a company could set them in
 * Settings and they would have no effect at all on a public apply page — the
 * projection simply never carried them across.
 *
 * The trailing entries are legacy spellings kept so configurations written
 * before the canonical keys were forwarded keep working. `applicationGates`
 * (browser) and `applicationDefinition` (server) both read the canonical key
 * first and fall back to the alias, so both spellings resolve identically.
 */
const PUBLIC_APPLICATION_CONFIG_KEYS = [
    // Canonical gate ids, in settings-UI order.
    'ssn', 'dob', 'addressHistory', 'employmentHistory',
    'cdlUpload', 'medCardUpload', 'mvrConsent', 'referralSource',
    'emergencyContacts',
    // Legacy spellings — read only when the canonical key is absent.
    'showEmergencyContacts', 'previousAddresses', 'employers',
    'violations', 'accidents',
];

/**
 * The shape version of this projection.
 *
 * Stamped onto every profile this module writes, and compared by the reconciler
 * in `publicProfileSync.js`. That comparison is the whole point: widening the
 * allowlist (as the `addressHistory` / `employmentHistory` / `mvrConsent` /
 * `referralSource` / `emergencyContacts` change did) does NOT retroactively
 * update profiles written earlier — `syncPublicProfile` only fires on a
 * subsequent company write. A company that configured those settings before the
 * change would keep an old profile, and its public apply page would keep
 * ignoring them, until somebody happened to edit the company again.
 *
 * BUMP THIS whenever `buildPublicProfileDto`'s output shape changes, so every
 * existing profile is rewritten by the reconciler on its next pass.
 */
const PUBLIC_PROFILE_DTO_VERSION = 2;

/**
 * Build the public-safe projection of a company document.
 *
 * @param {object} companyData Raw `companies/{id}` document data.
 * @param {*} updatedAt Server-timestamp sentinel to stamp (injected by the caller
 *   so this module stays free of a firebase-admin dependency).
 * @param {object} [options]
 * @param {*} [options.deleteSentinel] `FieldValue.delete()`, injected the same
 *   way. When supplied, an allowlisted `applicationConfig` key the company no
 *   longer sets is written as this sentinel instead of being omitted.
 *
 *   That matters because profiles are written with `{ merge: true }`, and a
 *   merge does not remove a nested map key that is simply absent from the new
 *   value. Without the sentinel, un-setting a gate in Settings would leave the
 *   stale gate in force on the public apply page forever. Emitting every
 *   allowlisted key on every write — a value or a delete — makes the merge exact
 *   without having to read the profile first.
 * @returns {object} Exactly the curated set of public fields — nothing else.
 */
function buildPublicProfileDto(companyData = {}, updatedAt = null, options = {}) {
    const { deleteSentinel } = options || {};
    const rawConfig = companyData.applicationConfig || {};
    const applicationConfig = {};
    for (const key of PUBLIC_APPLICATION_CONFIG_KEYS) {
        if (rawConfig[key] !== undefined) {
            applicationConfig[key] = rawConfig[key];
        } else if (deleteSentinel !== undefined) {
            applicationConfig[key] = deleteSentinel;
        }
    }
    return {
        dtoVersion: PUBLIC_PROFILE_DTO_VERSION,
        companyName: companyData.companyName || 'Untitled Company',
        appSlug: companyData.appSlug || null,
        logoUrl: companyData.companyLogoUrl || null,
        brandColor: companyData.brandColor || '#1e40af',
        applicationConfig,
        customQuestions: Array.isArray(companyData.customQuestions) ? companyData.customQuestions : [],
        // Post-application e-sign forms shown to the driver on the success
        // screen. Project ONLY the fields the public page needs
        // (templateId/title/enabled/required) — never the full template config.
        // `required` defaults to TRUE for backward compatibility: templates
        // configured before the flag existed are treated as required unless the
        // company explicitly marks them optional.
        postApplicationTemplates: Array.isArray(companyData.postApplicationTemplates)
            ? companyData.postApplicationTemplates
                .map((t) => {
                    if (typeof t === 'string') return { templateId: t, title: 'Complete Form', enabled: true, required: true };
                    if (!t || typeof t !== 'object') return null;
                    const templateId = String(t.templateId || t.id || '').trim();
                    if (!templateId) return null;
                    return {
                        templateId,
                        title: String(t.title || 'Complete Form'),
                        enabled: t.enabled !== false,
                        required: t.required !== false,
                    };
                })
                .filter(Boolean)
            : [],
        updatedAt,
    };
}

module.exports = {
    PUBLIC_APPLICATION_CONFIG_KEYS,
    PUBLIC_PROFILE_DTO_VERSION,
    buildPublicProfileDto,
};
