const {
    normalizeSearchApplicationId,
    normalizeSearchConfirmation,
} = require('./searchNormalization');

/** Ids tried after the applicant's own is held by someone else: `{id}_2` to `{id}_100`. */
const LAST_SUFFIX = 100;

/**
 * The id this applicant's record goes under, and its snapshot. A hash
 * collision (the id held by another applicant) moves it to the first suffixed
 * id that is free or already this applicant's.
 */
async function chooseRecord(transaction, applications, applicationId, applicantKeyFull) {
    const heldByAnother = (snap) => {
        const holder = snap.exists ? (snap.data() || {}).applicantKeyFull : null;
        return Boolean(holder) && holder !== applicantKeyFull;
    };
    let id = applicationId;
    let snap = await transaction.get(applications.doc(id));
    if (!heldByAnother(snap)) return { id, snap, collided: false };
    for (let suffix = 2; suffix <= LAST_SUFFIX; suffix += 1) {
        id = `${applicationId}_${suffix}`;
        snap = await transaction.get(applications.doc(id));
        if (!heldByAnother(snap)) break;
    }
    return { id, snap, collided: true };
}

/**
 * Writes a submitted application, or merges a re-submission into the record
 * already there: its confirmation number, first submission time and a status
 * a recruiter has moved on are kept.
 *
 * Read once and written once, in one transaction. Two submissions of the same
 * application at once (a retry, an offline replay) would otherwise both find
 * no record, each tell the driver its own confirmation number while only one
 * is stored, and a status change landing between the read and the write would
 * be put back to New Application. The caller's document is not changed: the
 * transaction may run its callback again.
 */
async function upsertApplicationDoc({
    db,
    companyId,
    applicationId,
    applicantKeyFull,
    applicationDoc,
    now,
    logLabel = 'submitGuestApplication',
}) {
    const applications = db.collection('companies').doc(companyId).collection('applications');

    const outcome = await db.runTransaction(async (transaction) => {
        const { id, snap, collided } = await chooseRecord(transaction, applications, applicationId, applicantKeyFull);
        const doc = {
            ...applicationDoc,
            ...(applicationDoc.lifecycle ? { lifecycle: { ...applicationDoc.lifecycle } } : {}),
        };
        if (collided) {
            console.error(`[${logLabel}] Hash collision for ${applicationId}, using ${id}`);
            doc.applicationId = id;
            doc.applicantId = id;
            doc.driverId = id;
            doc.userId = id;
        }

        if (!snap.exists) {
            doc.submittedAt = now;
            doc.createdAt = now;
        } else {
            const prev = snap.data() || {};
            if (prev.confirmationNumber) {
                doc.confirmationNumber = prev.confirmationNumber;
            }
            if (prev.submittedAt) doc.submittedAt = prev.submittedAt;
            if (prev.createdAt) doc.createdAt = prev.createdAt;
            if (prev.status && prev.status !== 'New Application') {
                delete doc.status;
            }
            if (prev.lifecycle && typeof prev.lifecycle === 'object') {
                doc.lifecycle = {
                    ...prev.lifecycle,
                    ...doc.lifecycle,
                    status: prev.lifecycle.status || doc.lifecycle?.status,
                    submittedAt: prev.lifecycle.submittedAt || doc.lifecycle?.submittedAt,
                    lastResubmittedAt: new Date().toISOString(),
                };
            }
        }

        // Keep id/confirmation-derived search fields in sync with the FINAL values
        // (collision suffixing can change the id; dedup preserves the previous
        // confirmation number).
        doc.applicationIdNormalized = normalizeSearchApplicationId(id);
        if (doc.confirmationNumber) {
            doc.confirmationNumberNormalized = normalizeSearchConfirmation(doc.confirmationNumber);
        }

        transaction.set(applications.doc(id), doc, { merge: true });
        return { id, confirmationNumber: doc.confirmationNumber, existed: snap.exists };
    });

    console.log(`[${logLabel}] Upserted application ${outcome.id} for company ${companyId} (existed=${outcome.existed})`);

    return {
        success: true,
        applicationId: outcome.id,
        confirmationNumber: outcome.confirmationNumber,
        deduplicated: outcome.existed,
    };
}

module.exports = { upsertApplicationDoc };
