// functions/pipelineTriggers.js
// Firestore onWrite trigger for the hiring pipeline tracker.
// Handles: CST timestamp formatting, audit trail, statusChangedAt stamping.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");

// Note: This trigger does NOT need a Firestore client instance.
// It uses event.data.after.ref.update() to write back to the same document,
// and only needs FieldValue for serverTimestamp().

// --- Helper: Format current time to CST display string ---
// Returns: "Mon, 10:45 AM"
function formatCSTDisplay(date) {
    const options = {
        timeZone: 'America/Chicago',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    };
    return new Intl.DateTimeFormat('en-US', options).format(date);
}

// --- Helper: Format current date to CST date string ---
// Returns: "02/17/2026"
function formatCSTDate(date) {
    const options = {
        timeZone: 'America/Chicago',
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
    };
    return new Intl.DateTimeFormat('en-US', options).format(date);
}

// --- SERVER-MANAGED FIELDS (used for loop prevention) ---
// H2 FIX: Added 'comments' and 'lastCheckedDisplay' — the trigger writes to these fields,
// so they must be in the skip-set to prevent unnecessary re-invocations.
const SERVER_MANAGED_FIELDS = new Set([
    'lastCheckedDisplay',
    'lastModifiedAt',
    'statusChangedAt',
    'comments', // H2 FIX: Audit trail comments are server-written
]);

// --- MAIN TRIGGER ---
exports.onPipelineEntryWrite = onDocumentWritten(
    {
        document: 'companies/{companyId}/pipeline_entries/{entryId}',
        region: 'us-central1',
    },
    async (event) => {
        const { FieldValue } = require("firebase-admin/firestore");

        // Skip deletes — no after data
        if (!event.data?.after?.exists) {
            console.log('[Pipeline] Document deleted, skipping.');
            return null;
        }

        const afterData = event.data.after.data();
        const beforeData = event.data.before?.exists ? event.data.before.data() : null;

        // --- LOOP PREVENTION ---
        // If this is an update (not a create), check if the only changed fields
        // are server-managed fields. If so, this is our own write echoing back.
        if (beforeData) {
            const changedFields = [];
            for (const key of Object.keys(afterData)) {
                if (key === 'lastModifiedAt' || key === 'statusChangedAt') {
                    // Timestamps — compare via toMillis if available
                    const bVal = beforeData[key]?.toMillis?.() || 0;
                    const aVal = afterData[key]?.toMillis?.() || 0;
                    if (bVal !== aVal) changedFields.push(key);
                } else if (beforeData[key] !== afterData[key]) {
                    changedFields.push(key);
                }
            }

            // If the only changes are server-managed fields, skip
            if (changedFields.length > 0 && changedFields.every(f => SERVER_MANAGED_FIELDS.has(f))) {
                console.log('[Pipeline] Only server-managed fields changed, skipping to prevent loop.');
                return null;
            }
        }

        // --- DETECT CHANGES ---
        const hiringStageChanged = !beforeData || beforeData.hiringStage !== afterData.hiringStage;
        const commentsChanged = !beforeData || beforeData.comments !== afterData.comments;

        // If neither hiringStage nor comments changed, nothing to do
        if (!hiringStageChanged && !commentsChanged) {
            console.log('[Pipeline] No relevant field changes detected.');
            return null;
        }

        const now = new Date();
        const updatePayload = {};

        // 1. STATUS TIMESTAMPING — update statusChangedAt when hiringStage changes
        if (hiringStageChanged) {
            updatePayload.statusChangedAt = FieldValue.serverTimestamp();
            console.log(`[Pipeline] hiringStage changed: ${beforeData?.hiringStage || 'NEW'} → ${afterData.hiringStage}`);
        }

        // 2. AUDIT TRAIL — append system comment when hired or rejected
        if (hiringStageChanged && (afterData.hiringStage === 'hired' || afterData.hiringStage === 'rejected')) {
            const dateCST = formatCSTDate(now);
            const auditNote = ` [System]: Driver is ${afterData.hiringStage} on ${dateCST}.`;
            const existingComments = afterData.comments || '';
            updatePayload.comments = existingComments
                ? `${existingComments}\n${auditNote}`
                : auditNote;
            console.log(`[Pipeline] Audit trail appended: ${auditNote}`);
        }

        // 3. CST TIMESTAMP DISPLAY — update lastCheckedDisplay when hiringStage or comments change
        if (hiringStageChanged || commentsChanged) {
            updatePayload.lastCheckedDisplay = formatCSTDisplay(now);
            updatePayload.lastModifiedAt = FieldValue.serverTimestamp();
            console.log(`[Pipeline] lastCheckedDisplay updated: ${updatePayload.lastCheckedDisplay}`);
        }

        // --- WRITE ---
        if (Object.keys(updatePayload).length > 0) {
            try {
                await event.data.after.ref.update(updatePayload);
                console.log(`[Pipeline] Successfully updated entry ${event.params.entryId}`);
            } catch (error) {
                console.error(`[Pipeline] Failed to update entry ${event.params.entryId}:`, error);
            }
        }

        return null;
    }
);
