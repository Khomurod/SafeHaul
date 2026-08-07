// functions/shared/submissionRecordStatus.js
//
// Records, ON THE APPLICATION DOCUMENT, whether that application has a preserved
// submission snapshot.
//
// WHY
// ---
// Writing the snapshot is deliberately best-effort: an applicant who has just
// pressed Submit must not lose their application because a subcollection write
// failed. But "best effort" that only writes to the log is not a recovery
// strategy — nothing can find the affected applications afterwards, and a log
// line is not something a repair job can query.
//
// So every submission stamps its outcome. `recorded` names the snapshot;
// `failed` names the error and the attempt, so the repair job can enumerate
// exactly the applications that need rebuilding instead of scanning every
// subcollection in the tenant.
//
// This is metadata about the record, never presentation data, and it is
// deliberately small: no answers, no PII, nothing a driver or recruiter reads.

const RECORD_STATUS = Object.freeze({
    RECORDED: 'recorded',
    FAILED: 'failed',
});

/**
 * Build the `submissionRecord` field for a successful snapshot write.
 *
 * @param {object} opts
 * @param {object} opts.result   Output of `writeSubmissionSnapshot`.
 * @param {object} opts.snapshot The snapshot that was written.
 * @param {string} [opts.submissionAttemptId]
 * @param {string} [opts.at] ISO timestamp; injected for determinism in tests.
 */
function buildRecordedStatus({ result, snapshot, submissionAttemptId = null, at = null }) {
    return {
        status: RECORD_STATUS.RECORDED,
        snapshotId: result.snapshotId,
        sequence: result.sequence,
        isOriginal: Boolean(result.isOriginal),
        // True when this call recognised a redelivery and reused the existing
        // record. Useful when reading logs after a flaky network.
        deduplicated: Boolean(result.deduplicated),
        definitionVersion: snapshot?.definitionVersion || null,
        agreementVersion: snapshot?.agreementVersion || null,
        schemaVersion: snapshot?.schemaVersion || null,
        submissionAttemptId: submissionAttemptId || null,
        recordedAt: at || new Date().toISOString(),
    };
}

/**
 * Build the `submissionRecord` field for a failed snapshot write.
 *
 * The message is truncated and no stack is kept: this field is stored beside
 * applicant data, and an error string is not the place to accumulate internals.
 */
function buildFailedStatus({ error, submissionAttemptId = null, at = null }) {
    const message = String(error?.message || error || 'Unknown error').slice(0, 300);
    return {
        status: RECORD_STATUS.FAILED,
        error: message,
        submissionAttemptId: submissionAttemptId || null,
        failedAt: at || new Date().toISOString(),
    };
}

/**
 * Stamp the outcome onto `companies/{companyId}/applications/{applicationId}`.
 *
 * Never throws. A failure to record the status must not turn into a failure of
 * the submission it is describing — that would be the recovery mechanism
 * destroying the thing it exists to protect.
 */
async function stampSubmissionRecordStatus({
    db,
    companyId,
    applicationId,
    submissionRecord,
    logLabel = 'stampSubmissionRecordStatus',
}) {
    try {
        await db
            .collection('companies').doc(companyId)
            .collection('applications').doc(applicationId)
            .set({ submissionRecord }, { merge: true });
        return true;
    } catch (error) {
        console.error(
            `[${logLabel}] Could not stamp submissionRecord on application ${applicationId} `
            + `(company ${companyId}):`,
            error
        );
        return false;
    }
}

module.exports = {
    RECORD_STATUS,
    buildFailedStatus,
    buildRecordedStatus,
    stampSubmissionRecordStatus,
};
