const {
    normalizeSearchApplicationId,
    normalizeSearchConfirmation,
} = require('./searchNormalization');

async function upsertApplicationDoc({
    db,
    companyId,
    applicationId,
    applicantKeyFull,
    applicationDoc,
    now,
    logLabel = 'submitGuestApplication',
}) {
    let finalApplicationId = applicationId;

    const docRef = db
        .collection('companies')
        .doc(companyId)
        .collection('applications')
        .doc(finalApplicationId);

    const existing = await docRef.get();
    if (existing.exists) {
        const prev = existing.data() || {};
        if (prev.applicantKeyFull && prev.applicantKeyFull !== applicantKeyFull) {
            let suffix = 2;
            let candidateId = `${finalApplicationId}_${suffix}`;
            while (suffix < 100) {
                const collisionSnap = await db
                    .collection('companies')
                    .doc(companyId)
                    .collection('applications')
                    .doc(candidateId)
                    .get();
                if (!collisionSnap.exists) break;
                const collisionData = collisionSnap.data() || {};
                if (!collisionData.applicantKeyFull || collisionData.applicantKeyFull === applicantKeyFull) break;
                suffix += 1;
                candidateId = `${applicationId}_${suffix}`;
            }
            console.error(
                `[${logLabel}] Hash collision for ${finalApplicationId}, using ${candidateId}`
            );
            finalApplicationId = candidateId;
            applicationDoc.applicationId = finalApplicationId;
            applicationDoc.applicantId = finalApplicationId;
            applicationDoc.driverId = finalApplicationId;
            applicationDoc.userId = finalApplicationId;
        }
    }

    const finalDocRef = db
        .collection('companies')
        .doc(companyId)
        .collection('applications')
        .doc(finalApplicationId);

    const existingFinal = await finalDocRef.get();
    if (!existingFinal.exists) {
        applicationDoc.submittedAt = now;
        applicationDoc.createdAt = now;
    } else {
        const prev = existingFinal.data() || {};
        if (prev.confirmationNumber) {
            applicationDoc.confirmationNumber = prev.confirmationNumber;
        }
        if (prev.submittedAt) applicationDoc.submittedAt = prev.submittedAt;
        if (prev.createdAt) applicationDoc.createdAt = prev.createdAt;
        if (prev.status && prev.status !== 'New Application') {
            delete applicationDoc.status;
        }
        if (prev.lifecycle && typeof prev.lifecycle === 'object') {
            applicationDoc.lifecycle = {
                ...prev.lifecycle,
                ...applicationDoc.lifecycle,
                status: prev.lifecycle.status || applicationDoc.lifecycle.status,
                submittedAt: prev.lifecycle.submittedAt || applicationDoc.lifecycle.submittedAt,
                lastResubmittedAt: new Date().toISOString(),
            };
        }
    }

    // Keep id/confirmation-derived search fields in sync with the FINAL values
    // (collision suffixing can change the id; dedup preserves the previous
    // confirmation number).
    applicationDoc.applicationIdNormalized = normalizeSearchApplicationId(finalApplicationId);
    if (applicationDoc.confirmationNumber) {
        applicationDoc.confirmationNumberNormalized = normalizeSearchConfirmation(
            applicationDoc.confirmationNumber
        );
    }

    await finalDocRef.set(applicationDoc, { merge: true });

    console.log(`[${logLabel}] Upserted application ${finalApplicationId} for company ${companyId} (existed=${existingFinal.exists})`);

    return {
        success: true,
        applicationId: finalApplicationId,
        confirmationNumber: applicationDoc.confirmationNumber,
        deduplicated: existingFinal.exists,
    };
}

module.exports = { upsertApplicationDoc };
