/**
 * Required answers a draft cannot have brought back with it.
 *
 * A draft never carries `ssn` or `signature` (see `neverStoredDraftFields`), and
 * the wizard validates a step only when the applicant presses Next on it. So an
 * applicant who resumed at the licence page never returned to page one, nothing
 * re-asked for their Social Security Number, and a company that requires one could
 * receive an application without it.
 *
 * Pure and shared on purpose: `buildApplicationDoc` wraps this in the callable's
 * `invalid-argument` refusal, and the browser's `requiredUnpersistedFields.js` is
 * checked against it directly by a parity test — which means **this module must
 * stay dependency-free** (`applicationDefinition` and `neverStoredDraftFields`
 * only, both of which are). A `firebase-admin` import anywhere in this chain breaks
 * the frontend CI job, which installs no functions dependencies.
 *
 * Driven off things that already exist rather than a hand-written rule: the shared
 * field table, so nothing is listed twice; the strip list, so a field that stops
 * being persisted later is covered without touching this file; and `resolveGate`,
 * so a company that hides the field or marks it optional is respected exactly as
 * the wizard respects it.
 */

const { STANDARD_SECTIONS, resolveGate } = require('./applicationDefinition');
const { NEVER_STORED } = require('./neverStoredDraftFields');

/**
 * @returns {string[]} human labels of the required fields that are missing
 */
function getMissingRequiredUnpersistedFields(applicationConfig, formData) {
    const answers = formData && typeof formData === 'object' ? formData : {};
    const missing = [];

    for (const section of STANDARD_SECTIONS) {
        for (const field of section.fields || []) {
            if (!field.gate) continue;
            if (!NEVER_STORED.includes(field.id)) continue;

            const gate = resolveGate(applicationConfig, field.gate);
            // Hidden is never required, and optional is never blocking — the same
            // resolution the wizard uses, so the two cannot disagree about what a
            // company actually asked for.
            if (gate.hidden || !gate.required) continue;

            const value = answers[field.id];
            const blank = value === undefined || value === null
                || (typeof value === 'string' && value.trim() === '');
            if (blank) missing.push(field.label || field.id);
        }
    }
    return missing;
}

module.exports = { getMissingRequiredUnpersistedFields };
