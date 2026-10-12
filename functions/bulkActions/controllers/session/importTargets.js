// =====================================================================
// Persisting an import's targets, without the rows the campaign leaves out.
//
// `initBulkSession`'s import phase. Each raw row mints the import ID that
// becomes its target ID. A row is left out when the recruiter un-ticked it in
// the preview, or when the company's ledgers show it was messaged inside the
// "Exclude Previously Messaged" window (`helpers/recentlyMessaged.js`). Only
// the rows that stay are written to the session's `targets` subcollection.
// =====================================================================

const { admin, db } = require("../../../firebaseAdmin");
const { excludeWindow, recipientsMessagedWithin } = require("../../helpers/recentlyMessaged");

// The window the upload screen shows until the recruiter picks another
// (`AudienceBuilder`), so a list sent without one is filtered as it promised.
const UPLOAD_EXCLUDE_DEFAULT = '7';
const BATCH_WRITES = 490; // Safety margin under Firestore's 500

/**
 * Persists raw import rows as session targets, leaving out the un-ticked and
 * the recently-messaged ones. Returns the target-ID list and how many rows the
 * recently-messaged filter left out.
 */
const persistImportTargets = async ({ companyId, sessionRef, rawItems, filters, config, finalTargetIds }) => {
    // The rows the recruiter un-ticked in the preview are neither stored nor sent.
    // The preview names a row by its `id`, or by its place in the list when it has
    // none (`VirtualLeadList`), and rawItems arrive in that same order.
    const excludedRows = new Set(Array.isArray(filters.excludedLeadIds) ? filters.excludedLeadIds : []);
    const rows = [];
    rawItems.forEach((item, i) => {
        if (excludedRows.has(item?.id || `import_${i}`)) return;
        rows.push({
            key: `imp_${i}_${Date.now()}`, // Simple unique ID within session context
            item,
            phone: item.phone || item.phoneNumber || '',
            email: item.email,
        });
    });

    let messaged = new Set();
    try {
        messaged = await recipientsMessagedWithin({
            db,
            companyId,
            window: excludeWindow(filters.excludeRecentDays || UPLOAD_EXCLUDE_DEFAULT),
            method: config?.method,
            recipients: rows,
        });
    } catch (filterErr) {
        // Non-fatal: if the ledgers cannot be read, proceed with all contacts.
        console.error('[initBulkSession] Recently-messaged filter error (proceeding without filter):', filterErr);
    }
    if (messaged.size > 0) {
        console.log(`[initBulkSession] Recently-messaged filter removed ${messaged.size} rows from import`);
    }

    const kept = rows.filter((row) => !messaged.has(row.key));
    const batches = [];
    for (let i = 0; i < kept.length; i += BATCH_WRITES) {
        const batch = db.batch();
        kept.slice(i, i + BATCH_WRITES).forEach((row) => {
            batch.set(sessionRef.collection('targets').doc(row.key), {
                ...row.item,
                importedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        batches.push(batch);
    }
    await Promise.all(batches.map((batch) => batch.commit()));

    kept.forEach((row) => finalTargetIds.push(row.key));
    return { finalTargetIds, importFilteredCount: messaged.size };
};

module.exports = {
    persistImportTargets,
};
