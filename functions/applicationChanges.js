/**
 * applicationChanges.js
 * =====================
 * Company-Admin edits to a submitted driver application become *pending changes*
 * that the driver reviews via a token link and approves / rejects / edits. The
 * main application doc stays the CANONICAL ORIGINAL until a change is resolved
 * (so PDF export naturally shows originals for unapproved edits). Per-field
 * resolution; the app-level `hasPendingCompanyChanges` flag clears once all are
 * resolved.
 *
 * Callables:
 *  - proposeApplicationChanges  (company_admin)  → writes pending_changes docs
 *  - createChangeReview         (company_admin)  → mints a token review link
 *  - getChangeReview            (public/token)   → driver loads before/after
 *  - submitChangeResolution     (public/token)   → driver approve/reject/edit
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { v4: uuidv4 } = require("uuid");
const { admin, db } = require("./firebaseAdmin");
const { assertCompanyAdminStrict } = require("./shared/companyAccess");
const { checkRateLimit } = require("./shared/rateLimiter");
const { isEditableField, fieldLabel, valuesEqual } = require("./shared/applicationEditableFields");

const ALLOWED_COLLECTIONS = new Set(['applications', 'leads']);
const REVIEW_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function appRef(companyId, collectionName, applicationId) {
    return db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId);
}

function validateTarget(data) {
    const { companyId, applicationId, collectionName = 'applications' } = data || {};
    if (!companyId || !applicationId || typeof companyId !== 'string' || typeof applicationId !== 'string') {
        throw new HttpsError('invalid-argument', 'companyId and applicationId are required.');
    }
    if (!ALLOWED_COLLECTIONS.has(collectionName)) {
        throw new HttpsError('invalid-argument', 'Invalid collectionName.');
    }
    return { companyId, applicationId, collectionName };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. proposeApplicationChanges (company_admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.proposeApplicationChanges = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { companyId, applicationId, collectionName } = validateTarget(request.data);
    const { changes } = request.data || {};
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new HttpsError('invalid-argument', 'changes[] is required.');
    }

    await assertCompanyAdminStrict(request.auth.uid, companyId);

    const ref = appRef(companyId, collectionName, applicationId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Application not found.');
    const current = snap.data() || {};

    const performedByName = request.auth.token?.name || request.auth.token?.email || 'Company admin';
    const batch = db.batch();
    const applied = [];
    const skipped = [];

    for (const change of changes) {
        const fieldKey = change?.fieldKey;
        if (!fieldKey || !isEditableField(fieldKey)) { skipped.push(fieldKey); continue; }
        const originalValue = current[fieldKey] ?? null;
        const proposedValue = change.proposedValue ?? null;
        if (valuesEqual(originalValue, proposedValue)) { skipped.push(fieldKey); continue; }

        batch.set(ref.collection('pending_changes').doc(fieldKey), {
            fieldKey,
            fieldLabel: fieldLabel(fieldKey),
            originalValue,
            proposedValue,
            status: 'pending',
            createdBy: request.auth.uid,
            createdByName: performedByName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            resolvedValue: null,
            resolvedAt: null,
            resolution: null,
        });
        applied.push(fieldKey);
    }

    if (applied.length === 0) {
        return { success: true, applied, skipped, message: 'No applicable changes.' };
    }

    batch.set(ref, { hasPendingCompanyChanges: true }, { merge: true });
    await batch.commit();

    // Best-effort audit log (does not block).
    try {
        await ref.collection('activity_logs').add({
            action: 'Company Edit Proposed',
            details: `Pending driver approval: ${applied.map(fieldLabel).join(', ')}`,
            type: 'user',
            companyId,
            performedBy: request.auth.uid,
            performedByName,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) { logger.warn(`[proposeApplicationChanges] activity log failed: ${e?.message || e}`); }

    logger.info(`[proposeApplicationChanges] ${applied.length} change(s) proposed on ${collectionName}/${applicationId} (company ${companyId})`);
    return { success: true, applied, skipped };
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. createChangeReview (company_admin) → token link
// ─────────────────────────────────────────────────────────────────────────────
exports.createChangeReview = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { companyId, applicationId, collectionName } = validateTarget(request.data);
    await assertCompanyAdminStrict(request.auth.uid, companyId);

    const ref = appRef(companyId, collectionName, applicationId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Application not found.');
    const data = snap.data() || {};

    const pendingSnap = await ref.collection('pending_changes').where('status', '==', 'pending').limit(1).get();
    if (pendingSnap.empty) {
        throw new HttpsError('failed-precondition', 'There are no pending changes to review.');
    }

    const token = uuidv4();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + REVIEW_TTL_MS);
    const applicantName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Driver';

    await db.collection('change_reviews').doc(token).set({
        token,
        companyId,
        applicationId,
        collectionName,
        applicantName,
        status: 'open',
        createdBy: request.auth.uid,
        createdAt: now,
        expiresAt,
    });

    logger.info(`[createChangeReview] token created for ${collectionName}/${applicationId} (company ${companyId})`);
    // Frontend builds the full URL from window.location.origin + /review-change/{token}.
    return { success: true, token, path: `/review-change/${token}` };
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getChangeReview (public — token)
// ─────────────────────────────────────────────────────────────────────────────
exports.getChangeReview = onCall({ cors: true }, async (request) => {
    const { token } = request.data || {};
    if (!token || typeof token !== 'string') throw new HttpsError('invalid-argument', 'Missing token.');

    const allowed = await checkRateLimit(`change_review_read_${token}`, 30, 60, 'closed');
    if (!allowed) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment.');

    const reviewSnap = await db.collection('change_reviews').doc(token).get();
    if (!reviewSnap.exists) throw new HttpsError('not-found', 'This review link is invalid.');
    const review = reviewSnap.data();
    if (review.expiresAt && review.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError('failed-precondition', 'This review link has expired.');
    }

    const ref = appRef(review.companyId, review.collectionName, review.applicationId);
    const changesSnap = await ref.collection('pending_changes').get();
    const changes = changesSnap.docs.map((d) => {
        const c = d.data();
        return {
            fieldKey: c.fieldKey,
            fieldLabel: c.fieldLabel,
            originalValue: c.originalValue ?? null,
            proposedValue: c.proposedValue ?? null,
            status: c.status,
            resolvedValue: c.resolvedValue ?? null,
        };
    });

    return {
        applicantName: review.applicantName,
        status: review.status,
        changes,
    };
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. submitChangeResolution (public — token): approve / reject / edit (final)
// ─────────────────────────────────────────────────────────────────────────────
exports.submitChangeResolution = onCall({ cors: true }, async (request) => {
    const { token, resolutions } = request.data || {};
    if (!token || typeof token !== 'string') throw new HttpsError('invalid-argument', 'Missing token.');
    if (!Array.isArray(resolutions) || resolutions.length === 0) {
        throw new HttpsError('invalid-argument', 'resolutions[] is required.');
    }

    const allowed = await checkRateLimit(`change_review_submit_${token}`, 10, 600, 'closed');
    if (!allowed) throw new HttpsError('resource-exhausted', 'Too many submissions. Please wait.');

    const reviewSnap = await db.collection('change_reviews').doc(token).get();
    if (!reviewSnap.exists) throw new HttpsError('not-found', 'This review link is invalid.');
    const review = reviewSnap.data();
    if (review.expiresAt && review.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError('failed-precondition', 'This review link has expired.');
    }

    const ref = appRef(review.companyId, review.collectionName, review.applicationId);
    const pendingSnap = await ref.collection('pending_changes').get();
    const byKey = new Map(pendingSnap.docs.map((d) => [d.id, d.data()]));

    const batch = db.batch();
    const docUpdates = {};
    for (const r of resolutions) {
        const fieldKey = r?.fieldKey;
        const action = r?.action;
        const change = byKey.get(fieldKey);
        if (!change || change.status !== 'pending') continue; // ignore unknown/resolved
        const pcRef = ref.collection('pending_changes').doc(fieldKey);

        if (action === 'approve') {
            docUpdates[fieldKey] = change.proposedValue ?? null;
            batch.set(pcRef, { status: 'approved', resolvedValue: change.proposedValue ?? null, resolution: 'approve', resolvedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        } else if (action === 'reject') {
            batch.set(pcRef, { status: 'rejected', resolvedValue: change.originalValue ?? null, resolution: 'reject', resolvedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        } else if (action === 'edit') {
            const driverValue = r.value ?? null; // driver's edit is final
            docUpdates[fieldKey] = driverValue;
            batch.set(pcRef, { status: 'edited', resolvedValue: driverValue, resolution: 'edit', resolvedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        } else {
            continue; // invalid action
        }
    }

    if (Object.keys(docUpdates).length > 0) {
        batch.set(ref, docUpdates, { merge: true });
    }
    await batch.commit();

    // Recompute remaining pending; clear the mark + close the review when none remain.
    const remainingSnap = await ref.collection('pending_changes').where('status', '==', 'pending').limit(1).get();
    const remaining = remainingSnap.size;
    if (remaining === 0) {
        await ref.set({ hasPendingCompanyChanges: false }, { merge: true });
        await db.collection('change_reviews').doc(token).set({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    try {
        await ref.collection('activity_logs').add({
            action: 'Driver Reviewed Company Edits',
            details: resolutions.map((r) => `${r.fieldKey}: ${r.action}`).join(', '),
            type: 'user',
            companyId: review.companyId,
            performedBy: 'driver',
            performedByName: review.applicantName,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) { logger.warn(`[submitChangeResolution] activity log failed: ${e?.message || e}`); }

    return { success: true, remaining, completed: remaining === 0 };
});
