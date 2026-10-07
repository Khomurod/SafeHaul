/**
 * An unfinished application, laid out the way a submitted one reads.
 *
 * A Company Admin may open any unfinished application (`drafts/admin.js`). What
 * they see is built by the builders a submission uses — the definition from
 * `applicationDefinition.js`, the sections and custom answers from
 * `submissionSnapshot.js` — against the company's current questions and rules.
 * So a field the company hides stays hidden, a conditional one appears only
 * when its condition holds, and a custom question reads by its wording, never
 * by its id. The record is rebuilt on every view and never stored: a draft is
 * not something anybody has signed.
 *
 * What it leaves out, on purpose:
 *
 * - **The agreements and the signature.** A draft has accepted and signed
 *   nothing, so the record carries neither, rather than a list of agreements
 *   "not accepted" that reads like a refusal.
 * - **The fields a draft never stores** (`NEVER_STORED`, the SSN). The question
 *   would otherwise read "Not provided" when the driver may well have answered
 *   it; the screen says why it is absent instead.
 * - **A submission time.** The snapshot builder measures employment coverage
 *   against `submittedAt`, so it is given today; nothing was submitted, and the
 *   record says so by carrying none.
 */

const { buildApplicationDefinition } = require('./applicationDefinition');
const { normalizeApplicationAnswers } = require('./applicationRules');
const { buildSubmissionSnapshot } = require('./submissionSnapshot');
const { NEVER_STORED } = require('./neverStoredDraftFields');

/** What `provenance.source` says about a record built from a draft. */
const DRAFT_SOURCE = 'draft';

/**
 * @param {object} opts
 * @param {object} opts.company The company as the wizard saw it: its document,
 *   with the public projection's questions, settings and rules laid over it.
 * @param {object} [opts.formData] The draft's stored answers.
 * @param {Date} [opts.now] Today, for the employment-coverage window.
 * @returns {object} A snapshot-shaped record, for `presentSubmission`.
 */
function buildDraftRecord({ company, formData, now = new Date() } = {}) {
    const definition = buildApplicationDefinition({ company });
    const snapshot = buildSubmissionSnapshot({
        definition,
        // The same normalisation a submission and the driver's review apply, so an
        // explicit "No" hides the rows it dropped here too.
        formData: normalizeApplicationAnswers(formData),
        submittedAt: now.toISOString(),
        provenance: { source: DRAFT_SOURCE },
    });

    return {
        ...snapshot,
        submittedAt: null,
        sections: snapshot.sections.map((section) => ({
            ...section,
            answers: section.answers.filter((answer) => !NEVER_STORED.includes(answer.fieldId)),
        })),
        agreements: [],
        signature: null,
    };
}

module.exports = { DRAFT_SOURCE, buildDraftRecord };
