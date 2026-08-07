// functions/shared/applicationDefinition.js
//
// THE authoritative, versioned definition of "what an application asks".
//
// WHY THIS EXISTS
// ---------------
// There was no application definition. `customQuestions` and `applicationConfig`
// live directly on the mutable `companies/{companyId}` document, and the PDF
// generator carried its own private copy of the field labels and legal text. So:
//
//   * Editing a question, a company detail or a legal clause retroactively
//     changed how every historical application rendered.
//   * The PDF printed custom questions by iterating the ANSWER map and using the
//     key as the label — and those keys are ids, which is how UUIDs ended up in
//     front of users.
//   * Nothing recorded which questions a given driver was actually shown.
//
// This module resolves the company's current settings into one normalized,
// ordered, content-addressed definition. `version` is a hash of the definition's
// own content, so identical settings always produce the same version and any
// edit produces a new one — no counter to increment and no race between two
// admins saving at once.
//
// This module is pure: it performs no I/O and never reads global state, so the
// same inputs always yield the same version.

const crypto = require('crypto');
const { CURRENT_AGREEMENT_VERSION, resolveAgreementSet } = require('./legalAgreements');

/** Trim to a non-empty string, else null. Keeps blanks out of the record. */
function clean(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * The standard DOT application fields, in presentation order, with the wording
 * shown to users. Labels are deliberately held HERE rather than in the PDF
 * generator or the wizard, so the driver's screen, the recruiter's view and the
 * PDF cannot disagree about what a field is called.
 *
 * `gate` names the `applicationConfig` key a company can use to require or hide
 * the field (see StandardQuestionsConfig). Fields with no gate are structural
 * and always collected.
 *
 * `repeating` marks a field whose value is a list of records rather than a
 * scalar. Its `columns` name and label each cell of a row, so a renderer can lay
 * out a real table without knowing anything about the domain — and, critically,
 * without printing `[object Object]` or a raw key. Only listed columns are ever
 * shown, so an internal field that finds its way into a row cannot leak.
 *
 * `presentWhenAnswered` marks a field that only some intake paths collect — a
 * manual entry, an ATS record, an owner-operator's business details. The wizard
 * never shows it, so recording it as an unanswered question would claim it was
 * asked. It is treated as presented only when there is actually a value.
 *
 * This list is the authoritative inventory of what the application asks. A
 * question the wizard collects but that is absent here is invisible to the
 * preserved record, to the recruiter views and to the PDF — which is how the
 * driving disclosures, the additional licences, the employment gaps and the
 * vehicle-experience answers all went unrecorded.
 */
/**
 * Loaded from JSON rather than written here, because the driver's browser needs
 * the same table. `src/config/applicationDefinition.js` imports the very same
 * file, so the wizard, the preserved record and the PDF cannot drift apart in
 * what a field is called, which column a row has, or what it depends on — the
 * way they did when each surface carried its own copy of the labels.
 *
 * Data only, deliberately: the resolution logic lives in code on both sides and
 * is held together by `src/config/applicationGates.test.js`.
 */
const STANDARD_SECTIONS = Object.freeze(require('./applicationSections.json'));

/**
 * Defaults mirroring StandardQuestionsConfig's `defaultReq`.
 *
 * MUST stay identical to `src/config/applicationGates.js`; the parity test in
 * `src/config/applicationGates.test.js` loads this file and asserts it.
 */
const GATE_DEFAULT_REQUIRED = Object.freeze({
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
const GATE_DEFAULT_HIDDEN = Object.freeze({
    emergencyContacts: true,
    // Never rendered by any step until now, so no applicant has ever been asked
    // for it. Showing it to everyone by default would add a document request to
    // every application in the product; it stays opt-in.
    mvrConsent: true,
});

/**
 * Alternative spellings for the same gate that exist in stored data.
 *
 * `previousAddresses` / `employers` are the names publicProfileDto's allowlist
 * exposed before the canonical keys were forwarded, and `showEmergencyContacts`
 * is the older boolean form. All of them occur in real `applicationConfig` maps
 * depending on which surface the config came from, and a gate that only knew one
 * name silently fell back to its default.
 */
const GATE_ALIASES = Object.freeze({
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
    return { hidden: Boolean(raw.hidden), required: Boolean(raw.required) };
}

/**
 * Resolve one gate against the company's `applicationConfig`.
 * Mirrors `src/config/applicationGates.resolveApplicationGate` so the driver's
 * screen, the submission validator and the definition can never disagree about
 * what was asked or required.
 */
function resolveGate(applicationConfig, gate) {
    if (!gate) return { hidden: false, required: false, gated: false };

    const config = applicationConfig && typeof applicationConfig === 'object' ? applicationConfig : {};

    // The canonical key wins; an alias is consulted only when it is absent.
    let resolved = normalizeGateValue(config[gate], gate);
    if (resolved === undefined) {
        for (const alias of GATE_ALIASES[gate] || []) {
            resolved = normalizeGateValue(config[alias], gate);
            if (resolved !== undefined) break;
        }
    }

    if (resolved === undefined) {
        return {
            gated: true,
            hidden: Boolean(GATE_DEFAULT_HIDDEN[gate]),
            required: Boolean(GATE_DEFAULT_REQUIRED[gate]),
        };
    }

    // Required and hidden are mutually exclusive: a question nobody is shown
    // cannot be one they must answer.
    return {
        gated: true,
        hidden: resolved.hidden,
        required: resolved.hidden ? false : resolved.required,
    };
}

/**
 * Normalize one company-authored custom question.
 *
 * Critically, a question with no recorded wording gets `label: null` and
 * `labelMissing: true` — never its id. Printing the id is exactly the bug that
 * put UUIDs in front of drivers and recruiters; consumers are expected to render
 * an explicit "wording not recorded" treatment instead.
 */
function normalizeCustomQuestion(question, index) {
    const raw = question && typeof question === 'object' ? question : {};
    const id = clean(raw.id);
    const label = clean(raw.label);
    const options = Array.isArray(raw.options)
        ? raw.options.map((o) => clean(o)).filter(Boolean)
        : [];

    return {
        id,
        order: index + 1,
        label,
        labelMissing: !label,
        type: clean(raw.type) || 'shortAnswer',
        required: Boolean(raw.required),
        helpText: clean(raw.helpText),
        options,
        dotRequired: Boolean(raw.dotRequired),
        fmcsaReference: clean(raw.fmcsaReference),
    };
}

/**
 * The company details that appear on the application and its PDF.
 *
 * A curated allowlist, not a dump of the company document: raw database values
 * must never reach users, and a snapshot should not silently grow new fields.
 */
function snapshotCompanyDetails(company) {
    const raw = company && typeof company === 'object' ? company : {};
    const address = raw.address && typeof raw.address === 'object' ? raw.address : {};
    const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};

    return {
        companyName: clean(raw.companyName),
        dba: clean(raw.dba),
        dotNumber: clean(raw.dotNumber),
        mcNumber: clean(raw.mcNumber),
        address: {
            street: clean(address.street),
            city: clean(address.city),
            state: clean(address.state),
            zip: clean(address.zip),
        },
        contact: {
            email: clean(contact.email),
            phone: clean(contact.phone),
        },
    };
}

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally equal
 * definitions hash identically regardless of key insertion order.
 */
function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = canonicalize(value[key]);
            return acc;
        }, {});
    }
    return value;
}

/**
 * Content hash used as the definition version.
 *
 * `version` is excluded from its own input, so re-hashing an already-versioned
 * definition reproduces the same value instead of drifting.
 */
function hashDefinition(definition) {
    const content = { ...(definition || {}) };
    delete content.version;
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(content))).digest('hex').substring(0, 16);
}

/**
 * Build the authoritative definition for a company's application.
 *
 * @param {object} opts
 * @param {object} opts.company           `companies/{companyId}` data.
 * @param {string} [opts.agreementVersion] Defaults to the current version.
 * @returns {object} definition, including a content-addressed `version`.
 */
function buildApplicationDefinition({ company, agreementVersion = CURRENT_AGREEMENT_VERSION } = {}) {
    const raw = company && typeof company === 'object' ? company : {};
    const applicationConfig = raw.applicationConfig && typeof raw.applicationConfig === 'object'
        ? raw.applicationConfig
        : {};
    const companyDetails = snapshotCompanyDetails(raw);

    const sections = STANDARD_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        fields: section.fields.map((field) => {
            const gate = resolveGate(applicationConfig, field.gate);
            return {
                id: field.id,
                label: field.label,
                type: field.type || 'text',
                repeating: Boolean(field.repeating),
                // Frozen with the definition so a preserved record can lay out a
                // row's cells with the labels that were in force at the time.
                columns: Array.isArray(field.columns)
                    ? field.columns.map((column) => ({
                        id: column.id,
                        label: column.label,
                        type: column.type || 'text',
                    }))
                    : null,
                sensitive: Boolean(field.sensitive),
                presentWhenAnswered: Boolean(field.presentWhenAnswered),
                dependsOn: field.dependsOn || null,
                gate: field.gate || null,
                required: gate.required,
                hidden: gate.hidden,
            };
        }),
    }));

    const customQuestions = (Array.isArray(raw.customQuestions) ? raw.customQuestions : [])
        .map(normalizeCustomQuestion);

    // Agreements are recorded by id+version here; the exact rendered text is
    // captured in the submission snapshot, which is what a signature binds to.
    const agreements = resolveAgreementSet({
        companyName: companyDetails.companyName,
        version: agreementVersion,
    }).map((a) => ({
        id: a.id,
        version: a.version,
        title: a.title,
        requiresSignature: a.requiresSignature,
    }));

    const definition = {
        schemaVersion: 1,
        company: companyDetails,
        sections,
        customQuestions,
        agreements,
        agreementVersion,
    };

    return { ...definition, version: hashDefinition(definition) };
}

/** Flat list of every visible field, for validators and renderers. */
function visibleFields(definition) {
    return (definition?.sections || [])
        .flatMap((s) => s.fields.map((f) => ({ ...f, sectionId: s.id, sectionTitle: s.title })))
        .filter((f) => !f.hidden);
}

/** Look up a field's presentation label by id, across all sections. */
function findFieldLabel(definition, fieldId) {
    for (const section of definition?.sections || []) {
        const match = section.fields.find((f) => f.id === fieldId);
        if (match) return match.label;
    }
    return null;
}

module.exports = {
    GATE_ALIASES,
    GATE_DEFAULT_HIDDEN,
    GATE_DEFAULT_REQUIRED,
    STANDARD_SECTIONS,
    buildApplicationDefinition,
    canonicalize,
    findFieldLabel,
    hashDefinition,
    normalizeCustomQuestion,
    resolveGate,
    snapshotCompanyDetails,
    visibleFields,
};
