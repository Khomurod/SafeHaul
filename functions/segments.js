const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./firebaseAdmin");

/**
 * Smart Segments: Automatically categorizes drivers into lists based on rules.
 */

// Rules definitions
const RULES = {
    INACTIVE_30_DAYS: {
        slug: 'inactive_30_days',
        check: (data) => {
            if (!data.lastContactedAt) return true;
            const lastContact = data.lastContactedAt.toDate();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return lastContact < thirtyDaysAgo;
        }
    },
    GHOSTED: {
        slug: 'ghosted',
        check: (data) => {
            return data.status === 'applied' && data.lastCallOutcome === 'no_answer';
        }
    },
    NEW_LEADS: {
        slug: 'new_leads',
        check: (data) => {
            const createdAt = data.createdAt?.toDate() || new Date();
            const fortyEightHoursAgo = new Date();
            fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);
            return createdAt > fortyEightHoursAgo && data.status === 'new';
        }
    }
};

/**
 * Trigger: Watch for changes in driver applications within a company.
 * This updates segments for that specific company.
 */
exports.onApplicationUpdateSegments = onDocumentUpdated("companies/{companyId}/applications/{applicationId}", async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const companyId = event.params.companyId;
    const appId = event.params.applicationId;

    await updateSegments(companyId, appId, newData);
});

exports.onApplicationCreatedSegments = onDocumentCreated("companies/{companyId}/applications/{applicationId}", async (event) => {
    const data = event.data.data();
    const companyId = event.params.companyId;
    const appId = event.params.applicationId;

    await updateSegments(companyId, appId, data);
});

/**
 * Helper to update segment memberships for a specific record.
 */
async function updateSegments(companyId, recordId, data) {
    const batch = db.batch();

    for (const ruleKey in RULES) {
        const rule = RULES[ruleKey];
        const isMember = rule.check(data);
        const segmentMemberRef = db.collection('companies').doc(companyId)
            .collection('segments').doc(rule.slug)
            .collection('members').doc(recordId);

        if (isMember) {
            batch.set(segmentMemberRef, {
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                data: {
                    firstName: data.firstName || '',
                    lastName: data.lastName || '',
                    phone: data.phone || data.phoneNumber || ''
                }
            }, { merge: true });
        } else {
            batch.delete(segmentMemberRef);
        }
    }

    // Also update a global count for the dashboard
    // Note: In production, use a distributed counter if high frequency
    await batch.commit();
    await updateSegmentCounts(companyId);
}

async function updateSegmentCounts(companyId) {
    const segmentsRef = db.collection('companies').doc(companyId).collection('segments');
    const segmentsSnap = await segmentsRef.get();

    for (const segmentDoc of segmentsSnap.docs) {
        const countSnap = await segmentDoc.ref.collection('members').count().get();
        await segmentDoc.ref.set({ memberCount: countSnap.data().count }, { merge: true });
    }
}
