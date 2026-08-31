/**
 * SafeHaul environment & integration registry — the single machine-readable
 * inventory of every configuration key, secret and integration credential the
 * product actually uses.
 *
 * This file is the source of truth. It is deliberately *declarative*: it names
 * where a value lives, who reads it, whether it can be read back, and which
 * operations the source genuinely supports. Nothing here holds a secret value —
 * retrieval happens in `values.js`, one requested entry at a time.
 *
 * Two guards keep it honest:
 *  - `test/unit/environmentRegistry.inventory.test.js` scans the whole
 *    repository for `process.env.X`, `import.meta.env.X`, `defineSecret("X")`,
 *    `secrets: ['X']` and `${{ secrets.X }}` and fails if any key is not
 *    registered here. A new configuration key cannot silently escape the vault.
 *  - the same suite fails if this file registers a key that nothing in the
 *    repository references, so the inventory cannot drift into fiction either
 *    (documented exceptions are listed in `UNREFERENCED_BY_DESIGN`).
 *
 * ## Why `source` and `category` are both present and both needed
 *
 * `source` is *where the value is stored* and therefore decides what can be done
 * to it. `category` is *what kind of configuration it is* and is what an
 * operator filters by. They overlap but are not the same axis: a public value
 * can be inlined into the browser while its deployment source remains Google.
 */

// The tables themselves live in `registry/`, one module per source, because the
// inventory outgrew a single readable file. This module is the assembly and the
// lookups: it decides the ORDER entries appear in and mints their ids, so a
// reader still has one place to see what the registry is made of.
const {
    AVAILABILITY, CATEGORIES, REASONS, SENSITIVITY, SOURCES,
} = require('./registry/vocabulary');
const { BROWSER_ENTRIES } = require('./registry/entries-browser');
const { FUNCTIONS_ENTRIES } = require('./registry/entries-functions');
const { SECRET_MANAGER_ENTRIES } = require('./registry/entries-secret-manager');
const {
    GITHUB_ENTRIES, FIREBASE_ENTRIES, OPS_ENTRIES, REPO_ENTRIES,
} = require('./registry/entries-platform');
const { COMPANY_TEMPLATES } = require('./registry/company-templates');
const { AI_CREDENTIAL_ENTRIES } = require('./registry/entries-ai');

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const GLOBAL_ENTRIES = Object.freeze(
    [
        ...BROWSER_ENTRIES,
        ...FUNCTIONS_ENTRIES,
        ...SECRET_MANAGER_ENTRIES,
        ...GITHUB_ENTRIES,
        ...FIREBASE_ENTRIES,
        ...OPS_ENTRIES,
        ...REPO_ENTRIES,
        ...AI_CREDENTIAL_ENTRIES,
    ].map((entry) => Object.freeze({ ...entry, id: `${entry.source}:${entry.key}` })),
);

const GLOBAL_BY_ID = new Map(GLOBAL_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * Keys registered here that no repository file references by name.
 *
 * Each needs a stated reason, because an unreferenced registry row is otherwise
 * indistinguishable from a fabricated one.
 */
const UNREFERENCED_BY_DESIGN = Object.freeze({
    'firebase.default_project': 'Synthetic row describing .firebaserc, which is not an environment variable.',
    'signing.envelope_token_store': 'Synthetic row describing the per-envelope signing token store.',
    // AI credential names are *derived* at runtime from the frozen AI provider
    // registry rather than written anywhere as literals — that derivation is
    // precisely what stops a browser naming an arbitrary Secret Manager
    // resource. So no repository file contains the string
    // `SAFEHAUL_AI_GROQ_APIKEY`, and the corpus scan cannot see them.
    ...Object.fromEntries(AI_CREDENTIAL_ENTRIES.map((entry) => [
        entry.key,
        'AI provider credential. The Secret Manager name is derived from functions/ai/registry/providers.js at runtime, so it appears in no file as a literal.',
    ])),
});

/**
 * Vite built-ins on `import.meta.env` that are not SafeHaul configuration and
 * are deliberately excluded from the inventory.
 */
const VITE_BUILTINS = Object.freeze(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR', 'VITEST']);

/** Prefixes and names an operator may never introduce through the vault. */
const RESERVED_KEY_PATTERNS = Object.freeze([
    /^FIREBASE_/i,
    /^FIREBASE$/i,
    /^GOOGLE_/i,
    /^GCLOUD_/i,
    /^GCP_/i,
    /^GITHUB_/i,
    /^NODE_/i,
    /^NPM_/i,
    /^npm_/,
    /^K_(SERVICE|REVISION|CONFIGURATION)$/,
    /^(PATH|HOME|USER|SHELL|PWD|LANG|LC_ALL|TMPDIR|TEMP|TMP|HOSTNAME|TERM)$/i,
    /^X_GOOGLE_/i,
    /^FUNCTION_/i,
    /^FUNCTIONS_/i,
]);

const KEY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;

/**
 * Validates a key name an operator wants to add.
 *
 * @param {string} key
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateNewKeyName(key) {
    if (typeof key !== 'string' || !KEY_NAME_PATTERN.test(key)) {
        return {
            ok: false,
            reason: 'Key names must be 2-64 characters, start with a letter, and contain only letters, digits and underscores.',
        };
    }
    for (const pattern of RESERVED_KEY_PATTERNS) {
        if (pattern.test(key)) {
            return { ok: false, reason: `"${key}" is reserved by the platform and cannot be defined here.` };
        }
    }
    return { ok: true };
}

/** @returns {object|undefined} the frozen global entry with this id. */
function getGlobalEntry(id) {
    return GLOBAL_BY_ID.get(id);
}

/** @returns {object|undefined} the company template with this id. */
function getCompanyTemplate(templateId) {
    return COMPANY_TEMPLATES[templateId];
}

/** @returns {object|undefined} the field definition inside a company template. */
function getCompanyField(templateId, field) {
    const template = getCompanyTemplate(templateId);
    if (!template) return undefined;
    return template.fields.find((candidate) => candidate.field === field);
}

module.exports = {
    AVAILABILITY,
    CATEGORIES,
    COMPANY_TEMPLATES,
    GLOBAL_ENTRIES,
    REASONS,
    RESERVED_KEY_PATTERNS,
    SENSITIVITY,
    SOURCES,
    UNREFERENCED_BY_DESIGN,
    VITE_BUILTINS,
    getCompanyField,
    getCompanyTemplate,
    getGlobalEntry,
    validateNewKeyName,
};
