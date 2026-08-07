// src/config/applicationGates.js
//
// The browser-side resolver for company application settings ("gates").
//
// WHY THIS EXISTS
// ---------------
// A company configures each standard DOT question as Required / Optional /
// Hidden in Settings → Questions. Three separate surfaces then had to agree
// about what that configuration meant, and they did not:
//
//   * The settings UI wrote `addressHistory`, `employmentHistory`, `mvrConsent`
//     and `referralSource`.
//   * `publicProfileDto`'s allowlist forwarded neither of the first two under
//     those names, and never forwarded the last two at all — so on a public
//     apply page those four settings had NO effect whatsoever.
//   * Each wizard step re-implemented its own `getConfig` helper with its own
//     defaults, so "unset" meant different things in different steps.
//
// One resolver, one default table, one alias table. This module mirrors
// `functions/shared/applicationDefinition.js` exactly; `applicationGates.test.js`
// asserts the two tables stay identical, so the driver's screen, the server-side
// submission validator and the immutable snapshot cannot disagree about what was
// asked or required.
//
// A gate value is `{ required?: boolean, hidden?: boolean }`. Absent means
// "company never configured this", which resolves to the default below.

/** Defaults mirroring StandardQuestionsConfig's `defaultReq`. */
export const GATE_DEFAULT_REQUIRED = Object.freeze({
    ssn: true,
    dob: true,
    addressHistory: true,
    employmentHistory: true,
    cdlUpload: true,
    // Required by default: that is what the wizard and the submission validator
    // have always enforced. The settings screen used to show it as optional,
    // which was the half that was wrong.
    medCardUpload: true,
    // MVR consent has never been collected by the wizard, so no existing
    // applicant has one on file. Defaulting it to required would retroactively
    // block every applicant at every company that never touched the setting.
    // It becomes required only when a company explicitly asks for it.
    mvrConsent: false,
    referralSource: false,
    emergencyContacts: false,
});

/**
 * Gates that are hidden until a company opts in.
 *
 * Emergency contacts were historically gated by a bare boolean
 * (`showEmergencyContacts`) that defaulted to falsy, i.e. hidden. Keeping that
 * default preserves what every existing company's application looks like today.
 */
export const GATE_DEFAULT_HIDDEN = Object.freeze({
    emergencyContacts: true,
    // Never rendered by any step until now, so no applicant has ever been asked
    // for it. Showing it to everyone by default would add a document request to
    // every application in the product; it stays opt-in.
    mvrConsent: true,
});

/**
 * Alternative spellings for the same gate that exist in stored data.
 *
 * `previousAddresses` / `employers` are the names the public projection used
 * before the canonical keys were forwarded; `showEmergencyContacts` is the older
 * boolean form. Reading all of them means a company's saved configuration keeps
 * working regardless of which surface wrote it.
 */
export const GATE_ALIASES = Object.freeze({
    addressHistory: ['previousAddresses'],
    employmentHistory: ['employers'],
    emergencyContacts: ['showEmergencyContacts'],
});

/**
 * Normalize one stored gate value.
 *
 * Legacy boolean form: `true` means visible, `false` means hidden. It carries no
 * requiredness, so the gate's default is used for that half.
 */
function normalizeGateValue(raw, gate) {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'boolean') {
        return { hidden: !raw, required: Boolean(GATE_DEFAULT_REQUIRED[gate]) };
    }
    if (typeof raw !== 'object') return undefined;
    return {
        hidden: Boolean(raw.hidden),
        required: Boolean(raw.required),
    };
}

/**
 * Resolve one gate against a company's `applicationConfig`.
 *
 * @param {object} applicationConfig The company's saved gate map.
 * @param {string} gate             Canonical gate id (see GATE_DEFAULT_REQUIRED).
 * @returns {{hidden: boolean, required: boolean, configured: boolean}}
 */
export function resolveApplicationGate(applicationConfig, gate) {
    if (!gate) return { hidden: false, required: false, configured: false };

    const config = applicationConfig && typeof applicationConfig === 'object' ? applicationConfig : {};

    // The canonical key wins; aliases are consulted only when it is absent.
    let resolved = normalizeGateValue(config[gate], gate);
    if (resolved === undefined) {
        for (const alias of GATE_ALIASES[gate] || []) {
            resolved = normalizeGateValue(config[alias], gate);
            if (resolved !== undefined) break;
        }
    }

    if (resolved === undefined) {
        return {
            hidden: Boolean(GATE_DEFAULT_HIDDEN[gate]),
            required: Boolean(GATE_DEFAULT_REQUIRED[gate]),
            configured: false,
        };
    }

    // Required and hidden are mutually exclusive: a question nobody is shown
    // cannot be one they must answer. The settings UI enforces this on write;
    // enforcing it on read too means stale or hand-edited data cannot produce an
    // unanswerable required field.
    return {
        hidden: resolved.hidden,
        required: resolved.hidden ? false : resolved.required,
        configured: true,
    };
}

export default resolveApplicationGate;
