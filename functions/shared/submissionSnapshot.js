// functions/shared/submissionSnapshot.js
//
// The immutable record of exactly what one driver saw, answered, accepted and
// signed.
//
// WHY THIS EXISTS
// ---------------
// A submitted application used to be a flat spread of the raw form data
// (buildApplicationDoc). Nothing recorded which questions were asked, what they
// were called, which legal wording was displayed, or which agreements the driver
// individually accepted. Consequences:
//
//   * Editing a question, a company detail or a legal clause retroactively
//     changed how a historical application read.
//   * The PDF rendered custom questions from the ANSWER map, using each key as
//     the label — and those keys are ids, which is how UUIDs reached users.
//   * The PDF stamped a signature block onto all four agreements regardless of
//     what was actually presented or accepted.
//
// A snapshot resolves the answers against the definition ONCE, at submission,
// and stores the resolved result. Later edits to settings or wording cannot
// reach it.
//
// DESIGN RULES
//   1. A field the company hid was never asked — it is not an unanswered
//      question, so it does not appear as one.
//   2. A conditional field whose condition was not met was never shown; it is
//      recorded as not presented rather than as a blank answer.
//   3. An answer to a question absent from the definition keeps `label: null`
//      and `unknownQuestion: true`. Never the id.
//   4. A signature is attached to an agreement only when that agreement carries
//      its own acceptance evidence. No evidence means no signature — never a
//      signature against wording we cannot prove was accepted.
//   5. Values are stored as truth; masking is a presentation decision made by
//      the renderer, driven by the `sensitive` flag.

const { resolveAgreement } = require('./legalAgreements');
const { STANDARD_SECTIONS, visibleFields } = require('./applicationDefinition');
const { computeEmploymentCoverage } = require('./employmentCoverage');

const SNAPSHOT_SCHEMA_VERSION = 1;

/** Trim to a non-empty string, else null. */
function clean(value) {
    if (typeof value === 'string') return value.trim() || null;
    return null;
}

/** True when the driver supplied nothing for this field. */
function isBlank(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/** `YYYY-MM-DD` / `YYYY-MM` -> US display. Anything else is returned as-is. */
function formatDateForDisplay(value) {
    const raw = clean(value);
    if (!raw) return null;
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;
    const ym = /^(\d{4})-(\d{2})$/.exec(raw);
    if (ym) return `${ym[2]}/${ym[1]}`;
    return raw;
}

/**
 * A file answer's human label is its filename — never the storage path or a
 * signed URL, which are raw infrastructure values and often carry credentials.
 */
function formatFileForDisplay(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        // Storage paths and URLs both reduce to their last meaningful segment.
        const withoutQuery = trimmed.split('?')[0];
        const segment = withoutQuery.split('/').pop();
        return segment ? decodeURIComponent(segment) : 'Uploaded file';
    }
    if (value && typeof value === 'object') {
        return clean(value.name) || clean(value.fileName) || 'Uploaded file';
    }
    return null;
}

/**
 * Turn a stored answer into the string a human should read.
 * Returns null when there is nothing to show, so renderers decide how to say
 * "not provided" instead of each one inventing its own placeholder.
 */
function formatAnswerForDisplay(value, field = {}) {
    if (isBlank(value)) return null;
    if (field.type === 'file') return formatFileForDisplay(value);
    if (field.type === 'date') return formatDateForDisplay(value);

    if (Array.isArray(value)) {
        const parts = value.map((v) => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean);
        return parts.length ? parts.join(', ') : null;
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);

    const raw = String(value).trim();
    if (raw.toLowerCase() === 'yes') return 'Yes';
    if (raw.toLowerCase() === 'no') return 'No';
    return raw || null;
}

/**
 * Resolve a repeating field's rows into labelled cells.
 *
 * Only columns the definition declares are read, so an internal key that finds
 * its way into a stored row (an id, a storage path, a `_dirty` flag) can never
 * reach a screen or a PDF. A cell with no value is dropped rather than rendered
 * as a blank or a placeholder: a renderer showing "Supervisor Email: —" for
 * every employer is noise, and a driver who left it out did not answer nothing —
 * they were not required to answer.
 *
 * Returns an empty array for a non-list value, which is what a renderer needs in
 * order to say "none recorded" instead of printing `[object Object]`.
 */
function buildRepeatingRows(value, columns) {
    if (!Array.isArray(value) || !Array.isArray(columns) || columns.length === 0) return [];

    return value
        .map((row) => {
            const record = row && typeof row === 'object' ? row : {};
            return columns
                .map((column) => ({
                    label: column.label,
                    displayValue: formatAnswerForDisplay(record[column.id], column),
                }))
                .filter((cell) => cell.displayValue !== null);
        })
        .filter((cells) => cells.length > 0);
}

/**
 * The rows to render for one repeating answer.
 *
 * A snapshot written before columns were declared holds its records as raw
 * objects in `value` and has no `rows`. Rendering only `rows` would show
 * "None recorded" for an applicant who listed three employers — silently
 * dropping submitted data, which is the one thing no renderer here may do.
 *
 * So the fallback lays those records out using the field's CURRENT column list,
 * and says so with `usedCurrentColumns`. Consumers state that, because the
 * labels are today's wording rather than wording the record froze. Showing the
 * driver's employers under current field names, labelled as such, is honest;
 * dropping them is not.
 */
function resolveRepeatingRows(answer, currentColumnsById = null) {
    if (Array.isArray(answer?.rows) && answer.rows.length > 0) {
        return { rows: answer.rows, usedCurrentColumns: false };
    }
    if (!Array.isArray(answer?.value) || answer.value.length === 0) {
        return { rows: [], usedCurrentColumns: false };
    }
    const columns = currentColumnsById && currentColumnsById.get
        ? currentColumnsById.get(answer.fieldId)
        : null;
    if (!columns) return { rows: [], usedCurrentColumns: false };
    return { rows: buildRepeatingRows(answer.value, columns), usedCurrentColumns: true };
}

/** Every repeating field's current columns, by field id. */
function currentRepeatingColumns() {
    const map = new Map();
    for (const section of STANDARD_SECTIONS) {
        for (const field of section.fields) {
            if (field.repeating && Array.isArray(field.columns)) map.set(field.id, field.columns);
        }
    }
    return map;
}

/** Was a conditional field actually shown to the driver? */
function wasPresented(field, formData) {
    // Collected only by some intake paths (manual entry, ATS, owner-operator
    // business details). No value means it was not asked — recording it as an
    // unanswered question would claim it was.
    if (field.presentWhenAnswered) {
        return !isBlank(formData ? formData[field.id] : undefined);
    }
    if (!field.dependsOn) return true;
    const { field: dependency, equals } = field.dependsOn;
    const actual = formData ? formData[dependency] : undefined;
    if (typeof actual === 'string' && typeof equals === 'string') {
        return actual.trim().toLowerCase() === equals.trim().toLowerCase();
    }
    return actual === equals;
}

/**
 * Resolve every visible standard field into a labelled answer, grouped by the
 * definition's sections.
 */
function buildSections(definition, formData) {
    const visible = visibleFields(definition);
    const bySection = new Map();

    for (const field of visible) {
        if (!bySection.has(field.sectionId)) {
            bySection.set(field.sectionId, {
                id: field.sectionId,
                title: field.sectionTitle,
                answers: [],
            });
        }

        const presented = wasPresented(field, formData);
        const rawValue = formData ? formData[field.id] : undefined;
        const value = presented && !isBlank(rawValue) ? rawValue : null;

        bySection.get(field.sectionId).answers.push({
            fieldId: field.id,
            label: field.label,
            type: field.type,
            repeating: field.repeating,
            sensitive: field.sensitive,
            required: field.required,
            presented,
            // A field that was never shown holds no value, so none is recorded.
            value,
            displayValue: presented && !field.repeating
                ? formatAnswerForDisplay(rawValue, field)
                : null,
            // Repeating answers resolve to labelled cells here, once, so every
            // renderer lays out the same rows instead of each one re-deriving
            // them from raw objects — which is how `[object Object]` reached
            // users, and how a stored internal key could have.
            rows: field.repeating ? buildRepeatingRows(value, field.columns) : null,
        });
    }

    return [...bySection.values()];
}

/**
 * Resolve custom-question answers against the definition.
 *
 * Every question in the definition is represented, answered or not, so the
 * record shows what was asked rather than only what was filled in. Answers whose
 * question is absent from the definition are kept and flagged — losing a
 * driver's answer would be worse than admitting we cannot label it.
 */
function buildCustomAnswers(definition, customAnswers) {
    const answers = customAnswers && typeof customAnswers === 'object' ? customAnswers : {};
    const questions = Array.isArray(definition?.customQuestions) ? definition.customQuestions : [];
    const seen = new Set();
    const out = [];

    for (const question of questions) {
        if (question.id) seen.add(question.id);
        const rawValue = question.id ? answers[question.id] : undefined;
        out.push({
            questionId: question.id,
            order: question.order,
            label: question.label,
            labelMissing: question.labelMissing,
            type: question.type,
            required: question.required,
            options: question.options,
            unknownQuestion: false,
            value: isBlank(rawValue) ? null : rawValue,
            displayValue: formatAnswerForDisplay(rawValue, { type: question.type }),
        });
    }

    // Answers with no matching question — historical records, or a question
    // deleted after submission.
    for (const [questionId, rawValue] of Object.entries(answers)) {
        if (seen.has(questionId)) continue;
        out.push({
            questionId,
            order: null,
            label: null,
            labelMissing: true,
            type: 'unknown',
            required: false,
            options: [],
            unknownQuestion: true,
            value: isBlank(rawValue) ? null : rawValue,
            displayValue: formatAnswerForDisplay(rawValue, {}),
        });
    }

    return out;
}

/**
 * Capture each agreement's exact presented text alongside its own acceptance
 * evidence.
 *
 * @param {object} opts
 * @param {object} opts.definition
 * @param {object} opts.acceptances `{ [agreementId]: { accepted, acceptedAt, ip, userAgent } }`
 * @param {object|null} opts.signature `{ image, type, capturedAt }`
 */
function buildAgreementRecords({ definition, acceptances = {}, signature = null }) {
    const companyName = definition?.company?.companyName || null;
    const declared = Array.isArray(definition?.agreements) ? definition.agreements : [];
    const given = acceptances && typeof acceptances === 'object' ? acceptances : {};

    return declared.map((declaredAgreement) => {
        // Resolve the exact text at the recorded version. Throws on an unknown
        // id/version rather than substituting wording we cannot vouch for.
        const resolved = resolveAgreement(declaredAgreement.id, declaredAgreement.version, { companyName });
        const evidence = given[declaredAgreement.id];
        const accepted = Boolean(evidence && evidence.accepted === true);
        const acceptedAt = accepted ? (clean(evidence.acceptedAt) || null) : null;
        /**
         * HOW acceptance was given, not merely whether.
         *
         * `individual` — this agreement was accepted on its own, which is what a
         * live submission records.
         * `combined` — the applicant certified the set with one action, which is
         * all a historical application can evidence. Recording it as `individual`
         * would overclaim; recording it as "not accepted" would be false, because
         * they did certify. Consumers state the distinction in words.
         */
        const acceptanceScope = accepted
            ? (clean(evidence.scope) === 'combined' ? 'combined' : 'individual')
            : null;

        return {
            id: resolved.id,
            version: resolved.version,
            title: resolved.title,
            // The verbatim text as displayed. This is what the signature binds to.
            body: resolved.body,
            legacyWording: resolved.legacy,
            requiresSignature: resolved.requiresSignature,
            accepted,
            acceptedAt,
            acceptanceScope,
            evidenceRecorded: Boolean(evidence),
            acceptanceContext: accepted
                ? {
                    ip: clean(evidence.ip),
                    userAgent: clean(evidence.userAgent),
                }
                : null,
            // RULE 4: no acceptance evidence, no signature. A signature must never
            // appear against wording we cannot prove the driver accepted.
            signature: accepted && signature
                ? {
                    type: clean(signature.type) || 'drawn',
                    capturedAt: clean(signature.capturedAt),
                    present: Boolean(signature.image),
                }
                : null,
        };
    });
}

/**
 * Build the immutable submission snapshot.
 *
 * @param {object} opts
 * @param {object} opts.definition   Output of buildApplicationDefinition.
 * @param {object} opts.formData     Raw driver answers.
 * @param {object} [opts.acceptances] Per-agreement acceptance evidence.
 * @param {object} [opts.signature]  `{ image, type, capturedAt }`.
 * @param {string} [opts.submittedAt] ISO timestamp; also the coverage reference.
 * @param {object} [opts.provenance] `{ source, notes }` — see reconstructed records.
 */
function buildSubmissionSnapshot({
    definition,
    formData,
    acceptances = {},
    signature = null,
    submittedAt = null,
    provenance = {},
} = {}) {
    if (!definition || typeof definition !== 'object') {
        throw new Error('buildSubmissionSnapshot requires an application definition');
    }

    const data = formData && typeof formData === 'object' ? formData : {};
    const submitted = clean(submittedAt) || new Date().toISOString();

    const coverage = computeEmploymentCoverage(
        {
            employers: data.employers,
            unemploymentPeriods: data.unemploymentPeriods,
            // The wizard stores explained gaps under `unemployment`. Both keys
            // are forwarded so a gap the driver actually explained counts.
            unemployment: data.unemployment,
            schools: data.schools,
            military: data.military,
        },
        { referenceDate: submitted },
    );

    const source = clean(provenance.source) || 'submission';

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        frozen: true,
        definitionVersion: clean(definition.version),
        agreementVersion: clean(definition.agreementVersion),
        submittedAt: submitted,
        // Frozen copy: later company-profile edits cannot rewrite this document.
        company: definition.company,
        sections: buildSections(definition, data),
        customAnswers: buildCustomAnswers(definition, data.customAnswers),
        agreements: buildAgreementRecords({ definition, acceptances, signature }),
        employmentCoverage: coverage,
        signature: signature
            ? {
                type: clean(signature.type) || 'drawn',
                capturedAt: clean(signature.capturedAt),
                present: Boolean(signature.image),
            }
            : null,
        /**
         * `submission` — captured live from the driver.
         * `reconstructed` — rebuilt for a historical application. Such a record
         * may legitimately lack per-agreement acceptance evidence, and consumers
         * must say so rather than implying the same proof as a live submission.
         */
        provenance: {
            source,
            notes: Array.isArray(provenance.notes) ? provenance.notes.filter(Boolean) : [],
        },
    };
}

module.exports = {
    SNAPSHOT_SCHEMA_VERSION,
    buildAgreementRecords,
    buildCustomAnswers,
    buildRepeatingRows,
    buildSections,
    currentRepeatingColumns,
    resolveRepeatingRows,
    buildSubmissionSnapshot,
    formatAnswerForDisplay,
    formatDateForDisplay,
    formatFileForDisplay,
    isBlank,
    wasPresented,
};
