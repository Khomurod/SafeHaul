// functions/notificationTriggers.js
// Firebase triggers that create in-app notifications for company team members
// Notifications are stored in: companies/{companyId}/notifications

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");

// --- Lazy Database Connection ---
let dbInstance = null;

function getDb() {
    if (!dbInstance) {
        const admin = require("firebase-admin");
        const { getFirestore } = require("firebase-admin/firestore");

        if (!admin.apps.length) {
            admin.initializeApp();
        }

        dbInstance = getFirestore();
        dbInstance.settings({ ignoreUndefinedProperties: true });
    }
    return dbInstance;
}

// --- Helper: Create Notification ---
async function createNotification(db, companyId, notification) {
    const notifRef = db.collection('companies').doc(companyId).collection('notifications').doc();

    await notifRef.set({
        ...notification,
        read: false,
        createdAt: new Date()
    });

    console.log(`[Notifications] Created: ${notification.type} for ${companyId}`);
    return notifRef.id;
}

// --- TRIGGER 1: Application Status Changed ---
exports.onApplicationStatusChanged = onDocumentUpdated(
    {
        document: 'companies/{companyId}/applications/{appId}',
        region: 'us-central1'
    },
    async (event) => {
        const db = getDb();
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();

        if (!before || !after) return;

        // Only trigger if status actually changed
        if (before.status === after.status) return;

        const applicantName = `${after.firstName || ''} ${after.lastName || ''}`.trim() || 'Applicant';

        await createNotification(db, event.params.companyId, {
            type: 'status_change',
            title: 'Status Updated',
            message: `${applicantName} moved from "${before.status}" to "${after.status}"`,
            relatedId: event.params.appId,
            relatedType: 'application',
            oldStatus: before.status,
            newStatus: after.status
        });
    }
);

// --- TRIGGER 2: Lead Assigned to Recruiter ---
exports.onLeadAssigned = onDocumentUpdated(
    {
        document: 'companies/{companyId}/leads/{leadId}',
        region: 'us-central1'
    },
    async (event) => {
        const db = getDb();
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();

        if (!before || !after) return;

        // Only trigger if assignedTo changed
        if (before.assignedTo === after.assignedTo) return;
        if (!after.assignedTo) return; // Skip unassignment

        const leadName = after.fullName || `${after.firstName || ''} ${after.lastName || ''}`.trim() || 'Lead';

        await createNotification(db, event.params.companyId, {
            type: 'lead_assigned',
            title: 'Lead Assigned',
            message: `${leadName} was assigned to ${after.assignedToName || 'a recruiter'}`,
            relatedId: event.params.leadId,
            relatedType: 'lead',
            assignedTo: after.assignedTo,
            assignedToName: after.assignedToName
        });
    }
);

// --- TRIGGER 3: New Application Submitted ---
exports.onNewApplicationNotification = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}',
        region: 'us-central1'
    },
    async (event) => {
        const db = getDb();
        const data = event.data?.data();

        if (!data) return;

        const applicantName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'New Applicant';
        const position = data.positionApplyingTo || 'Driver';

        await createNotification(db, event.params.companyId, {
            type: 'new_application',
            title: 'New Application',
            message: `${applicantName} applied for ${position}`,
            relatedId: event.params.appId,
            relatedType: 'application'
        });
    }
);

// --- TRIGGER 4: Callback Scheduled (from activity logs) ---
exports.onCallbackScheduled = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}/activity_logs/{logId}',
        region: 'us-central1'
    },
    async (event) => {
        const db = getDb();
        const data = event.data?.data();

        if (!data) return;

        // Only notify for callbacks
        if (data.outcome !== 'callback') return;

        // Get applicant info from parent document
        const appRef = db.collection('companies').doc(event.params.companyId)
            .collection('applications').doc(event.params.appId);
        const appDoc = await appRef.get();
        const appData = appDoc.data() || {};

        const applicantName = `${appData.firstName || ''} ${appData.lastName || ''}`.trim() || 'Driver';
        const scheduledTime = data.callbackTime || data.notes || 'No time specified';

        await createNotification(db, event.params.companyId, {
            type: 'callback_scheduled',
            title: 'Callback Scheduled',
            message: `${applicantName}: ${scheduledTime}`,
            relatedId: event.params.appId,
            relatedType: 'application',
            performedBy: data.performedBy,
            performedByName: data.performedByName
        });
    }
);

// --- TRIGGER 5: Callback Scheduled (from LEADS activity logs) ---
exports.onLeadCallbackScheduled = onDocumentCreated(
    {
        document: 'companies/{companyId}/leads/{leadId}/activity_logs/{logId}',
        region: 'us-central1'
    },
    async (event) => {
        const db = getDb();
        const data = event.data?.data();

        if (!data) return;

        // Only notify for callbacks
        if (data.outcome !== 'callback') return;

        // Get lead info from parent document
        const leadRef = db.collection('companies').doc(event.params.companyId)
            .collection('leads').doc(event.params.leadId);
        const leadDoc = await leadRef.get();
        const leadData = leadDoc.data() || {};

        const leadName = leadData.fullName || `${leadData.firstName || ''} ${leadData.lastName || ''}`.trim() || 'Lead';
        const scheduledTime = data.callbackTime || data.notes || 'No time specified';

        await createNotification(db, event.params.companyId, {
            type: 'callback_scheduled',
            title: 'Callback Scheduled',
            message: `${leadName}: ${scheduledTime}`,
            relatedId: event.params.leadId,
            relatedType: 'lead',
            performedBy: data.performedBy,
            performedByName: data.performedByName
        });
    }
);
