// functions/shared/reconstructSubmission.js
//
// Rebuilds a preserved record for an application submitted before records were
// preserved — from the evidence that survives, and only from that.
//
// WHAT SURVIVES, AND WHAT DOES NOT
// --------------------------------
// The application document holds the answers, the signature and the submission
// date. It does not hold: which questions the company was asking that day, the
// wording those questions had, the company details as they then stood, or —
// crucially — which agreements the applicant accepted individually.
//
// So a reconstruction is honest about three things and silent about nothing:
//
//   1. It is marked `reconstructed`, and every consumer says so.
//   2. Its notes list, in plain language, exactly what could not be recovered.
//      No note is written unless it is true of THIS application.
//   3. Agreements are attributed to `legacy-1` — the frozen forensic copy of the
//      wording the old generator actually displayed — never to current wording.
//      Where the applicant certified, acceptance is recorded with scope
//      `combined`, because one signature over a combined acknowledgement is what
//      the old flow captured. Calling that an individual acceptance would
//      overclaim; calling it a refusal would be false.
//
// It never invents an answer, a date, a question or an acceptance.

const { buildApplicationDefinition } = require('./applicationDefinition');
const { buildSubmissionSnapshot } = require('./submissionSnapshot');

/** The frozen copy of the wording pre-rebuild applications actually displayed. */
const LEGACY_AGREEMENT_VERSION = 'legacy-1';

/** Fields on the application document that are metadata, not answers. */
const NON_ANSWER_KEYS = new Set([
    'id', 'applicantId', 'applicationId', 'driverId', 'userId', 'companyId', 'companyName',
    'applicantKey', 'applicantKeyFull', 'confirmationNumber', 'status', 'atsStatus',
    'createdAt', 'updatedAt', 'submittedAt', 'lastActivityAt', 'assignedTo',
    'signature', 'signatureDate', 'signatureType', 'submissionRecord',
    'hasPendingCompanyChanges', 'searchFields', 'source', 'sourceMeta',
    'agreementAcceptances', 'submissionAttemptId',
]);

/** Strip metadata so only the driver's answers reach the record. */
function answersFrom(application) {
    const data = application && typeof application === 'object' ? application : {};
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (NON_ANSWER_KEYS.has(key)) continue;
        out[key] = value;
    }
    return out;
}

/** Firestore Timestamp | ISO string | Date → ISO string, or null. */
function toIso(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value.toDate === 'function') {
        try {
            return value.toDate().toISOString();
        } catch {
            return null;
        }
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    return null;
}

/**
 * Did the applicant certify at all?
 *
 * The old consent step recorded `final-certification` and a signature. Either is
 * evidence of certification; neither is evidence of accepting one particular
 * agreement.
 */
function certifiedAt(application) {
    const certified = application?.['final-certification'];
    const hasCertification = certified === true || certified === 'yes' || certified === 'agreed';
    const hasSignature = Boolean(application?.signature);
    if (!hasCertification && !hasSignature) return null;
    return toIso(application?.signatureDate)
        || toIso(application?.submittedAt)
        || toIso(application?.createdAt);
}

/**
 * Build a reconstructed submission snapshot for one historical application.
 *
 * @param {object} opts
 * @param {object} opts.application The `companies/{id}/applications/{id}` data.
 * @param {object} opts.company     The company document, as it is NOW.
 * @returns {{snapshot: object, notes: string[], unrecoverable: string[]}}
 *   `unrecoverable` is the machine-readable version of the notes, for the
 *   migration report.
 */
function reconstructSubmissionSnapshot({ application, company } = {}) {
    const answers = answersFrom(application);
    const submittedAt = toIso(application?.submittedAt) || toIso(application?.createdAt);

    const notes = [];
    const unrecoverable = [];

    notes.push(
        'This application was submitted before submitted applications were preserved. '
        + 'The record below was rebuilt from the application as it stands today.',
    );

    // The questions and company details are today's, not the day's. Say so
    // rather than presenting them as the ones that were in force.
    notes.push(
        'The questions, their wording and the company details shown are the company\'s '
        + 'current settings. They may differ from those in force when this application '
        + 'was submitted, and the difference cannot be recovered.',
    );
    unrecoverable.push('definition_at_submission');

    if (!submittedAt) {
        notes.push('No submission date was recorded for this application.');
        unrecoverable.push('submitted_at');
    }

    // Custom answers whose question the company no longer has. The snapshot
    // keeps the answer and flags it; the note tells a reader how many.
    const currentQuestionIds = new Set(
        (Array.isArray(company?.customQuestions) ? company.customQuestions : [])
            .map((question) => question?.id)
            .filter(Boolean),
    );
    const orphanedAnswers = Object.keys(
        answers.customAnswers && typeof answers.customAnswers === 'object' ? answers.customAnswers : {},
    ).filter((id) => !currentQuestionIds.has(id));

    if (orphanedAnswers.length > 0) {
        notes.push(
            `${orphanedAnswers.length} answer${orphanedAnswers.length === 1 ? '' : 's'} `
            + 'came from a question the company no longer asks. The answer is kept; its '
            + 'wording was never recorded and cannot be recovered.',
        );
        unrecoverable.push('custom_question_wording');
    }

    const certified = certifiedAt(application);
    let acceptances = {};

    if (certified) {
        notes.push(
            'The applicant certified the agreements as a set with one signature, which is '
            + 'what the application captured at the time. Individual acceptance of each '
            + 'agreement was not recorded and cannot be recovered.',
        );
        unrecoverable.push('individual_agreement_acceptance');
    } else {
        notes.push(
            'No certification or signature was recorded for this application, so no '
            + 'acceptance of any agreement is claimed.',
        );
        unrecoverable.push('agreement_acceptance');
        unrecoverable.push('signature');
    }

    // The wording ACTUALLY displayed at the time, from the frozen forensic copy.
    // Never the current wording — an applicant cannot have accepted text that
    // did not exist when they applied.
    const definition = buildApplicationDefinition({
        company: company || {},
        agreementVersion: LEGACY_AGREEMENT_VERSION,
    });

    if (certified) {
        acceptances = Object.fromEntries(definition.agreements.map((agreement) => [agreement.id, {
            accepted: true,
            acceptedAt: certified,
            // The whole point: certified as a set, not individually.
            scope: 'combined',
        }]));
    }

    const snapshot = buildSubmissionSnapshot({
        definition,
        formData: answers,
        acceptances,
        signature: application?.signature
            ? {
                image: application.signature,
                type: application.signatureType || 'drawn',
                capturedAt: certified,
            }
            : null,
        submittedAt,
        provenance: { source: 'reconstructed', notes },
    });

    return { snapshot, notes, unrecoverable };
}

module.exports = {
    LEGACY_AGREEMENT_VERSION,
    NON_ANSWER_KEYS,
    answersFrom,
    certifiedAt,
    reconstructSubmissionSnapshot,
    toIso,
};
