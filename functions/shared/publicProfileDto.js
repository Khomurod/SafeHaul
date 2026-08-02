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

/** Whitelisted applicationConfig keys exposed on public apply pages. */
const PUBLIC_APPLICATION_CONFIG_KEYS = [
    'cdlUpload', 'medCardUpload', 'showEmergencyContacts',
    'ssn', 'dob', 'previousAddresses', 'employers', 'violations', 'accidents',
];

/**
 * Build the public-safe projection of a company document.
 *
 * @param {object} companyData Raw `companies/{id}` document data.
 * @param {*} updatedAt Server-timestamp sentinel to stamp (injected by the caller
 *   so this module stays free of a firebase-admin dependency).
 * @returns {object} Exactly the curated set of public fields — nothing else.
 */
function buildPublicProfileDto(companyData = {}, updatedAt = null) {
    const rawConfig = companyData.applicationConfig || {};
    const applicationConfig = {};
    for (const key of PUBLIC_APPLICATION_CONFIG_KEYS) {
        if (rawConfig[key] !== undefined) {
            applicationConfig[key] = rawConfig[key];
        }
    }
    return {
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

module.exports = { PUBLIC_APPLICATION_CONFIG_KEYS, buildPublicProfileDto };
