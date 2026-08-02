// functions/notificationTriggers.js
// Firebase triggers that create in-app notifications for company team members
// Notifications are stored in: companies/{companyId}/notifications

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
// H5 FIX: Use shared db instance from firebaseAdmin instead of lazy-initializing a duplicate
const { db } = require("./firebaseAdmin");

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


// --- TRIGGER 5: DL-4 FIX — Send confirmation email to applicant on new application ---
// Why a server-side trigger (not client-side send):
//  1. Ensures the email is sent even when the client drops the connection after submit.
//  2. The Cloud Function has access to the company's SMTP config (and decrypts the password).
//  3. Provides a consistent audit trail — the email is sent once, atomically.
exports.onNewApplicationEmailConfirmation = onDocumentCreated(
    {
        document: 'companies/{companyId}/applications/{appId}',
        region: 'us-central1'
    },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        // Only send for actual driver applications that have a valid applicant email
        const applicantEmail = data.email;
        if (!applicantEmail || !applicantEmail.includes('@')) return;

        const applicantName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Applicant';
        const appIdFormatted = event.params.appId.length >= 8
            ? event.params.appId.slice(0, 8).toUpperCase()
            : event.params.appId.toUpperCase().padEnd(8, '0');
        const confirmationNumber = data.confirmationNumber || appIdFormatted;
        const position = data.positionApplyingTo || 'Driver';
        const companyId = event.params.companyId;

        try {
            // Load company name for the email subject/body
            const companyDoc = await db.collection('companies').doc(companyId).get();
            const companyName = companyDoc.exists ? (companyDoc.data().companyName || 'SafeHaul') : 'SafeHaul';

            const { sendDynamicEmail } = require('./emailService');

            const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f7fa; padding: 20px;">
                <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
                    <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 8px;">Application Received</h1>
                    <p style="color: #6b7280; font-size: 16px; margin-bottom: 24px;">Thank you for applying to <strong>${companyName}</strong>.</p>

                    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                        <p style="color: #166534; font-size: 14px; margin: 0 0 8px;">
                            <strong>Confirmation Number:</strong>
                        </p>
                        <p style="color: #15803d; font-size: 28px; font-family: monospace; font-weight: bold; letter-spacing: 2px; margin: 0;">
                            ${confirmationNumber}
                        </p>
                        <p style="color: #166534; font-size: 12px; margin: 8px 0 0;">
                            Keep this number for your records. You may be asked to provide it when following up.
                        </p>
                    </div>

                    <div style="margin-bottom: 24px;">
                        <p style="color: #374151; margin: 0 0 4px;"><strong>Applicant:</strong> ${applicantName}</p>
                        <p style="color: #374151; margin: 0 0 4px;"><strong>Position:</strong> ${position}</p>
                        <p style="color: #374151; margin: 0;"><strong>Submitted:</strong> ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
                    </div>

                    <p style="color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                        A recruiter from <strong>${companyName}</strong> will review your application and contact you.
                        This is an automated confirmation — please do not reply to this email.
                    </p>
                </div>
            </div>`;

            // sendDynamicEmail takes positional args: (companyId, to, subject, html, options).
            await sendDynamicEmail(
                companyId,
                applicantEmail,
                `Application Received – ${companyName} (${confirmationNumber})`,
                emailHtml,
            );

            console.log(`[DL-4] Confirmation email sent for application ${confirmationNumber}`);
        } catch (err) {
            // Non-fatal: email failure must not prevent application creation from completing.
            // Log it so the team can investigate SMTP configuration issues.
            console.error(`[DL-4] Failed to send confirmation email for ${event.params.appId}:`, err.message);
        }
    }
);
