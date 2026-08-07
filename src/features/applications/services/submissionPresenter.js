// src/features/applications/services/submissionPresenter.js
//
// Turns a stored submission snapshot into something safe to put on a screen.
//
// One presenter serves the driver's review, the recruiter application views, the
// change-review workflow and the PDF, so those four cannot disagree about what a
// question was called or what the driver answered — which they previously did,
// because each derived its own labels from the raw form data.
//
// GUARANTEES ENFORCED HERE
//   * No internal identifier is ever user-visible. Field ids, question ids,
//     application ids, storage paths and signed URLs are all withheld; a question
//     whose wording was never recorded is described as such, never printed as a
//     UUID.
//   * Nothing is invented. An unanswered question reads "Not provided"; it is
//     never filled with a plausible value or silently dropped.
//   * A question the driver was never shown is not presented as unanswered.
//   * An agreement's signature is only ever described where the snapshot records
//     that this specific agreement was accepted.
//
// Pure and framework-free so it can be unit tested and reused by any renderer.

import STANDARD_SECTIONS from '../../../../functions/shared/applicationSections.json';
import { buildRepeatingRows } from '@/config/applicationDefinition';

/** Shown when a field was presented but left empty. */
export const NOT_PROVIDED = 'Not provided';

/** Every repeating field's current columns, by field id. */
const CURRENT_COLUMNS = new Map(
    STANDARD_SECTIONS
        .flatMap((section) => section.fields)
        .filter((field) => field.repeating && Array.isArray(field.columns))
        .map((field) => [field.id, field.columns]),
);

/**
 * The rows to render for one repeating answer.
 *
 * A snapshot written before columns were declared holds its records as raw
 * objects in `value` and has no `rows`. Showing only `rows` would say "None
 * recorded" for an applicant who listed three employers — silently dropping
 * submitted data, which is the one thing no renderer here may do.
 *
 * The fallback lays those records out under the field's CURRENT column names and
 * flags it, so a screen can say the labels are today's rather than the ones the
 * record froze. Showing the driver's employers under current field names,
 * labelled as such, is honest; dropping them is not.
 */
function resolveRows(answer) {
    if (Array.isArray(answer?.rows) && answer.rows.length > 0) {
        return { rows: answer.rows, usedCurrentColumns: false };
    }
    if (!Array.isArray(answer?.value) || answer.value.length === 0) {
        return { rows: [], usedCurrentColumns: false };
    }
    const columns = CURRENT_COLUMNS.get(answer.fieldId);
    if (!columns) return { rows: [], usedCurrentColumns: false };
    return { rows: buildRepeatingRows(answer.value, columns), usedCurrentColumns: true };
}

/** Shown when a custom question's wording was never recorded. */
export const WORDING_UNAVAILABLE = 'Question wording not recorded';

/**
 * Is this a usable submission snapshot?
 *
 * Anything else means there is no preserved record, and callers must say so
 * rather than rendering current live data as if it were the submitted original.
 */
export function isPreservedSnapshot(snapshot) {
    return Boolean(
        snapshot
        && typeof snapshot === 'object'
        && snapshot.frozen === true
        && Array.isArray(snapshot.sections),
    );
}

/** True when this record was rebuilt after the fact rather than captured live. */
export function isReconstructed(snapshot) {
    return snapshot?.provenance?.source === 'reconstructed';
}

/**
 * One display row for a standard answer.
 *
 * Returns null for a field the driver was never shown, so callers can simply
 * filter — an unseen question must not appear as an unanswered one.
 */
export function toDisplayAnswer(answer) {
    if (!answer || answer.presented === false) return null;
    return {
        // `key` is for React only. It is never rendered as text.
        key: answer.fieldId,
        label: answer.label,
        value: answer.displayValue || NOT_PROVIDED,
        isMissing: !answer.displayValue,
        sensitive: Boolean(answer.sensitive),
        // Repeating groups (employers, violations) are rendered by dedicated
        // components; flagged so a generic renderer does not print "[object Object]".
        repeating: Boolean(answer.repeating),
        /**
         * Rows of `{label, displayValue}` cells, resolved once when the snapshot
         * was frozen against the columns the definition declared. A renderer lays
         * them out without knowing anything about employers or violations, and an
         * internal key that found its way into a stored row has already been
         * dropped — it is not in the column list, so it never reaches a screen.
         *
         * Empty for a snapshot written before columns existed; such a record
         * legitimately shows the group as having nothing to display rather than
         * printing raw objects.
         */
        ...(answer.repeating ? resolveRows(answer) : { rows: [], usedCurrentColumns: false }),
        rawValue: answer.repeating ? answer.value : undefined,
    };
}

/**
 * Sections with their rows resolved, dropping sections that ended up empty so a
 * screen never shows a heading with nothing beneath it.
 */
export function toDisplaySections(snapshot) {
    if (!isPreservedSnapshot(snapshot)) return [];
    return snapshot.sections
        .map((section) => ({
            id: section.id,
            title: section.title,
            answers: (section.answers || []).map(toDisplayAnswer).filter(Boolean),
        }))
        .filter((section) => section.answers.length > 0);
}

/**
 * Custom questions as display rows.
 *
 * A question with no recorded wording is labelled explicitly. Printing its id
 * instead is the exact defect this replaces.
 */
export function toDisplayCustomAnswers(snapshot) {
    if (!isPreservedSnapshot(snapshot) || !Array.isArray(snapshot.customAnswers)) return [];
    return snapshot.customAnswers.map((answer, index) => ({
        key: answer.questionId || `unlabelled-${index}`,
        label: answer.labelMissing ? WORDING_UNAVAILABLE : answer.label,
        labelUnavailable: Boolean(answer.labelMissing),
        // An answer whose question no longer exists is still shown — losing the
        // driver's answer would be worse — but it is marked as unmatched.
        unmatched: Boolean(answer.unknownQuestion),
        value: answer.displayValue || NOT_PROVIDED,
        isMissing: !answer.displayValue,
    }));
}

/**
 * Plain-language acceptance evidence for one agreement.
 *
 * Deliberately distinguishes three states that the old PDF collapsed into one by
 * stamping a signature onto every agreement:
 *   accepted   — the driver accepted this specific wording, with a timestamp.
 *   declined   — a refusal was recorded. Legally meaningful, so it is stated.
 *   unrecorded — no evidence either way. Never described as signed.
 */
export function describeAgreementEvidence(agreement) {
    if (!agreement) return null;

    const status = agreement.accepted
        ? 'accepted'
        : (agreement.evidenceRecorded ? 'declined' : 'unrecorded');

    // A historical record can evidence that the applicant certified the whole set
    // with one action, but not that they accepted this agreement on its own.
    // Saying "accepted and signed" there would overclaim; saying "not accepted"
    // would be false. The distinction is stated instead.
    const combined = agreement.acceptanceScope === 'combined';

    const summary = {
        accepted: combined
            ? 'Certified as part of a single combined acknowledgement'
            : 'Accepted and signed by the applicant',
        declined: 'The applicant did not accept this agreement',
        unrecorded: 'No acceptance was recorded for this agreement',
    }[status];

    return {
        key: agreement.id,
        title: agreement.title,
        version: agreement.version,
        body: agreement.body,
        status,
        summary,
        acceptedAt: agreement.acceptedAt || null,
        acceptanceScope: agreement.acceptanceScope || null,
        acceptedIndividually: status === 'accepted' && !combined,
        // Only ever true where this agreement itself carries acceptance evidence.
        hasSignature: Boolean(agreement.signature && agreement.signature.present),
        signatureType: agreement.signature?.type || null,
        // Historical records reconstructed from the old hardcoded wording.
        legacyWording: Boolean(agreement.legacyWording),
    };
}

/** Every agreement, in the order presented. */
export function toDisplayAgreements(snapshot) {
    if (!isPreservedSnapshot(snapshot) || !Array.isArray(snapshot.agreements)) return [];
    return snapshot.agreements.map(describeAgreementEvidence).filter(Boolean);
}

/**
 * A short, honest sentence about three-year coverage, for the review screen and
 * the recruiter view.
 */
export function describeEmploymentCoverage(snapshot) {
    const coverage = snapshot?.employmentCoverage;
    if (!coverage) return null;

    const years = Math.round((coverage.requiredMonths / 12) * 10) / 10;
    return {
        isComplete: Boolean(coverage.isComplete),
        coveredMonths: coverage.coveredMonths,
        requiredMonths: coverage.requiredMonths,
        missingMonths: coverage.missingMonths,
        gaps: Array.isArray(coverage.gaps) ? coverage.gaps : [],
        summary: coverage.isComplete
            ? `Accounts for the required ${years} years of history.`
            : `Accounts for ${coverage.coveredMonths} of ${coverage.requiredMonths} months; ${coverage.missingMonths} unaccounted for.`,
    };
}

/**
 * Everything a screen needs, plus an explicit description of what KIND of record
 * this is.
 *
 * When there is no snapshot, `isPreserved` is false and `notice` explains that
 * the submitted record was not preserved. Callers must show that rather than
 * pass live data off as the submitted original.
 */
export function presentSubmission(snapshot) {
    if (!isPreservedSnapshot(snapshot)) {
        return {
            isPreserved: false,
            isReconstructed: false,
            notice: 'No preserved submission record exists for this application. '
                + 'It was submitted before submitted applications were archived, so the '
                + 'details below come from the current record and may not match exactly '
                + 'what the applicant saw.',
            sections: [],
            customAnswers: [],
            agreements: [],
            coverage: null,
            company: null,
            submittedAt: null,
        };
    }

    const reconstructed = isReconstructed(snapshot);
    return {
        isPreserved: true,
        isReconstructed: reconstructed,
        notice: reconstructed
            ? 'This record was reconstructed from the original submission. The agreement '
              + 'wording shown is what was displayed at the time, but individual acceptance '
              + 'of each agreement was not captured when this application was submitted.'
            : null,
        reconstructionNotes: reconstructed ? (snapshot.provenance?.notes || []) : [],
        sections: toDisplaySections(snapshot),
        customAnswers: toDisplayCustomAnswers(snapshot),
        agreements: toDisplayAgreements(snapshot),
        coverage: describeEmploymentCoverage(snapshot),
        company: snapshot.company || null,
        submittedAt: snapshot.submittedAt || null,
    };
}
