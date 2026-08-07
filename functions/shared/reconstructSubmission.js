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
//      Acceptance comes from the per-agreement checkbox the applicant actually
//      ticked (`agree-electronic`, `agree-background-check`, `agree-psp`), which
//      does survive on the application document. Only where those are absent
//      entirely does it fall back to the final certification, recorded with
//      scope `combined`: one signature over a combined acknowledgement is what
//      that older flow captured. Calling that an individual acceptance would
//      overclaim; calling it a refusal would be false.
//
//      The FMCSA Clearinghouse consent has no `legacy-1` wording at all,
//      because the old consent screen never asked for it. It therefore cannot
//      appear in a reconstructed set, and no historical record can claim it.
//
// It never invents an answer, a date, a question or an acceptance.

const { buildApplicationDefinition } = require('./applicationDefinition');
const { buildSubmissionSnapshot } = require('./submissionSnapshot');

/** The frozen copy of the wording pre-rebuild applications actually displayed. */
const LEGACY_AGREEMENT_VERSION = 'legacy-1';

/**
 * The per-agreement checkbox each acknowledgement was stored under before
 * `agreementAcceptances` existed. Mirrors `LEGACY_ACCEPTANCE_KEYS` in
 * `Step9_Consent.jsx`, which still writes these keys today.
 *
 * There is deliberately no entry for `clearinghouseConsent`: that agreement was
 * not on the old consent screen, so no historical application can carry an
 * acknowledgement of it.
 */
const LEGACY_ACCEPTANCE_KEYS = Object.freeze({
    electronicSignature: 'agree-electronic',
    fcraDisclosure: 'agree-background-check',
    pspDisclosure: 'agree-psp',
});

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

    // The per-agreement checkbox the applicant ticked. This is the best evidence
    // that survives, and it is genuinely per-agreement — an applicant who ticked
    // two of three left exactly that record.
    const ticked = Object.fromEntries(
        Object.entries(LEGACY_ACCEPTANCE_KEYS)
            .map(([agreementId, key]) => [agreementId, application?.[key] === 'agreed'])
            .filter(([, accepted]) => accepted),
    );
    const anyTicked = Object.keys(ticked).length > 0;

    if (certified && anyTicked) {
        notes.push(
            'Acceptance of each agreement was recovered from the individual acknowledgement '
            + 'the applicant recorded at the time. An agreement not listed as accepted was '
            + 'not acknowledged, and no acceptance of it is claimed.',
        );
    } else if (certified) {
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
        // Only agreements the applicant actually acknowledged. Where individual
        // acknowledgements survive they are authoritative — an agreement absent
        // from them was not accepted, and inventing an acceptance for it is the
        // precise failure this rebuild exists to avoid. Only when NO individual
        // record survives does the blanket certification stand in, and it is
        // labelled `combined` so it can never be read as an individual one.
        acceptances = Object.fromEntries(
            definition.agreements
                .filter((agreement) => (anyTicked ? ticked[agreement.id] === true : true))
                .map((agreement) => [agreement.id, {
                    accepted: true,
                    acceptedAt: certified,
                    scope: anyTicked ? 'individual' : 'combined',
                }]),
        );

        const unaccepted = definition.agreements.filter((a) => !acceptances[a.id]);
        if (unaccepted.length > 0) {
            notes.push(
                `${unaccepted.length} agreement${unaccepted.length === 1 ? ' was' : 's were'} `
                + 'presented but not acknowledged by the applicant.',
            );
        }
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
    LEGACY_ACCEPTANCE_KEYS,
    LEGACY_AGREEMENT_VERSION,
    NON_ANSWER_KEYS,
    answersFrom,
    certifiedAt,
    reconstructSubmissionSnapshot,
    toIso,
};
