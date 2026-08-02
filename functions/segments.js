const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./firebaseAdmin");

/**
 * Smart Segments: Automatically categorizes drivers into lists based on rules.
 * L4 FIX: Rules are exported as a constant so they can be overridden or extended
 * by company-level config in the future. See SEGMENT_RULES below.
 */

// Rules definitions — exported for testability and future configurability
const SEGMENT_RULES = {
    INACTIVE_30_DAYS: {
        slug: 'inactive_30_days',
        label: 'Inactive (30 Days)',
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
        label: 'Ghosted',
        check: (data) => {
            return data.status === 'applied' && data.lastCallOutcome === 'no_answer';
        }
    },
    NEW_LEADS: {
        slug: 'new_leads',
        label: 'New Leads',
        check: (data) => {
            const createdAt = data.createdAt?.toDate() || new Date();
            const fortyEightHoursAgo = new Date();
            fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);
            return createdAt > fortyEightHoursAgo && data.status === 'new';
        }
    }
};

// Export for external use / testing
exports.SEGMENT_RULES = SEGMENT_RULES;

/**
 * Trigger: Watch for changes in driver applications within a company.
 * This updates segments for that specific company.
 */
exports.onApplicationUpdateSegments = onDocumentUpdated("companies/{companyId}/applications/{applicationId}", async (event) => {
    const newData = event.data.after.data();
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

    for (const ruleKey in SEGMENT_RULES) {
        const rule = SEGMENT_RULES[ruleKey];
        const isMember = rule.check(data);
        const segmentRef = db.collection('companies').doc(companyId)
            .collection('segments').doc(rule.slug);
        const segmentMemberRef = segmentRef.collection('members').doc(recordId);

        // H3 FIX: Check current membership to determine +1/-1 delta
        const memberDoc = await segmentMemberRef.get();
        const wasMember = memberDoc.exists;

        if (isMember && !wasMember) {
            // Adding new member → +1
            batch.set(segmentMemberRef, {
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                data: {
                    firstName: data.firstName || '',
                    lastName: data.lastName || '',
                    phone: data.phone || data.phoneNumber || ''
                }
            });
            batch.set(segmentRef, {
                memberCount: admin.firestore.FieldValue.increment(1)
            }, { merge: true });
        } else if (!isMember && wasMember) {
            // Removing existing member → -1
            batch.delete(segmentMemberRef);
            batch.set(segmentRef, {
                memberCount: admin.firestore.FieldValue.increment(-1)
            }, { merge: true });
        } else if (isMember && wasMember) {
            // Member still qualifies → update data but no count change
            batch.set(segmentMemberRef, {
                joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                data: {
                    firstName: data.firstName || '',
                    lastName: data.lastName || '',
                    phone: data.phone || data.phoneNumber || ''
                }
            }, { merge: true });
        }
        // !isMember && !wasMember → no-op
    }

    await batch.commit();
}

