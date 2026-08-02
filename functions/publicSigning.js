const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, storage } = require("./firebaseAdmin");
const crypto = require('crypto');
const { checkRateLimit } = require("./shared/rateLimiter");

// ESIGN-5 FIX: Constant-time token comparison to eliminate timing side-channel attacks.
// JavaScript's !== operator short-circuits on the first differing character, leaking token length
// information to attackers who can measure response time.
function safeCompare(a, b) {
    if (!a || !b) return false;
    try {
        // Pad both values to the same fixed length before comparing to prevent
        // length-based timing attacks. We use a 256-byte fixed buffer so length
        // differences don't leak information.
        const MAX_LEN = 256;
        const strA = String(a);
        const strB = String(b);
        const paddedA = strA.substring(0, MAX_LEN).padEnd(MAX_LEN, '\0');
        const paddedB = strB.substring(0, MAX_LEN).padEnd(MAX_LEN, '\0');
        const bufA = Buffer.from(paddedA, 'utf8');
        const bufB = Buffer.from(paddedB, 'utf8');
        // Both buffers are now the same length, so timingSafeEqual won't leak length
        const equal = crypto.timingSafeEqual(bufA, bufB);
        // Also verify the original lengths match (both checks always run)
        const lengthsMatch = strA.length === strB.length;
        return equal && lengthsMatch;
    } catch {
        return false;
    }
}

/** Coerce pageNumber to a number so clients never fail strict page filters. */
function normalizePublicFields(fields) {
    if (!Array.isArray(fields)) return [];
    return fields
        .filter((f) => f != null)
        .map((f) => ({
            ...f,
            pageNumber: Number(f.pageNumber) || 1,
            xPosition: f.xPosition ?? f.x ?? 10,
            yPosition: f.yPosition ?? f.y ?? 10,
        }));
}

/** Treat blank client strings for locked/read-only fields as missing so Firestore defaultValue wins. */
function isLockedFieldForSubmit(field) {
    return field.prefillPolicy === 'locked' || field.readOnly === true;
}

// 1. GET PUBLIC DOCUMENT (Read Only)
exports.getPublicEnvelope = onCall({ cors: true }, async (request) => {
    if (!request.data) throw new HttpsError('invalid-argument', 'Missing data payload.');
    const { companyId, requestId, accessToken } = request.data;

    if (!companyId || !requestId || !accessToken) {
        throw new HttpsError('invalid-argument', 'Missing parameters.');
    }

    // A2 FIX: Rate-limit the unauthenticated read path (it mints a signed Storage URL per call).
    // Layered, defense-in-depth limits keyed by the most specific stable identifiers, both
    // 'closed' (a security path must not fail open). Limits are well above real signer behavior.
    const okEnvelope = await checkRateLimit(`envelope_read_${requestId}`, 30, 300, 'closed');
    if (!okEnvelope) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait and retry.');

    const ip = request.rawRequest?.ip || 'unknown';
    const okIp = await checkRateLimit(`envelope_read_ip_${ip}`, 100, 300, 'closed');
    if (!okIp) throw new HttpsError('resource-exhausted', 'Too many requests from this network.');

    try {
        const docRef = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) throw new HttpsError('not-found', 'Document not found.');

        const data = docSnap.data();

        // BUG-2 FIX: Read accessToken from secrets subcollection (not parent doc)
        const secretSnap = await docRef.collection('secrets').doc('token').get();
        // ADV-4 FIX: Fallback to parent doc for pre-migration signing requests
        const storedToken = secretSnap.exists ? secretSnap.data().accessToken : (data.accessToken || null);

        // ESIGN-5 FIX: Use constant-time comparison
        if (!safeCompare(storedToken, accessToken)) {
            console.warn(`Token Mismatch for requestId: ${requestId}`);
            throw new HttpsError('permission-denied', 'Invalid Access Token.');
        }

        if (data.status === 'signed') {
            return { status: 'signed' };
        }

        // PHASE 4 FIX: Block voided documents server-side (not just client-side)
        if (data.status === 'voided') {
            return { status: 'voided' };
        }

        // Reject if the signing link has expired
        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            throw new HttpsError('deadline-exceeded', 'This signing link has expired. Please request a new one.');
        }

        if (!data.storagePath) {
            throw new HttpsError('failed-precondition', 'Document file reference is missing.');
        }

        const bucket = storage.bucket();
        let filePath = data.storagePath;

        if (filePath.startsWith('gs://')) {
            const bucketName = bucket.name;
            filePath = filePath.replace(`gs://${bucketName}/`, '');
        }

        const fileRef = bucket.file(filePath);

        try {
            const [url] = await fileRef.getSignedUrl({
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000
            });

            return {
                title: data.title,
                recipientName: data.recipientName,
                // recipientEmail intentionally omitted — never expose PII on public endpoint
                fields: normalizePublicFields(data.fields),
                pdfUrl: url,
                status: data.status
            };

        } catch (signErr) {
            console.error("Signing URL error:", signErr);
            throw new HttpsError('internal', 'Server permission error: Cannot sign URL.');
        }

    } catch (error) {
        // ESIGN-10 FIX: Re-throw intentional HttpsErrors, but wrap unexpected errors
        // to avoid leaking Firestore paths, project IDs, or stack traces.
        if (error instanceof HttpsError) throw error;
        console.error("Error in getPublicEnvelope:", error);
        throw new HttpsError('internal', 'An unexpected error occurred. Please try again.');
    }
});

// 2. SUBMIT SIGNED DOCUMENT (Write)
exports.submitPublicEnvelope = onCall({ cors: true }, async (request) => {
    const { companyId, requestId, accessToken, fieldValues, auditData } = request.data;

    // ESIGN-18 FIX: Pass 'closed' as failBehavior so rate-limit system failures don't allow
    // unlimited requests through (fail-open was the previous default).
    const isAllowed = await checkRateLimit(`submit_envelope_${requestId}`, 5, 60, 'closed');
    if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many attempts. Please wait.');

    if (!companyId || !requestId) throw new HttpsError('invalid-argument', 'Missing parameters.');
    if (fieldValues !== undefined && (fieldValues === null || typeof fieldValues !== 'object' || Array.isArray(fieldValues))) {
        throw new HttpsError('invalid-argument', 'fieldValues must be an object.');
    }

    const docRef = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
    const normalizedFieldValues = (fieldValues && typeof fieldValues === 'object' && !Array.isArray(fieldValues))
        ? fieldValues
        : {};
    let requestData = null;
    let claimCommitted = false;

    try {
        // ESIGN-19 FIX: Use a transaction to atomically verify the status hasn't changed and
        // update it, preventing double-submission race conditions.
        await db.runTransaction(async (txn) => {
            const docSnap = await txn.get(docRef);
            if (!docSnap.exists) throw new HttpsError('not-found', 'Document not found');

            const data = docSnap.data();
            requestData = data;

            // BUG-2 FIX: Read accessToken from secrets subcollection
            const secretSnap = await txn.get(docRef.collection('secrets').doc('token'));
            // ADV-4 FIX: Fallback to parent doc for pre-migration signing requests
            const storedToken = secretSnap.exists ? secretSnap.data().accessToken : (data.accessToken || null);

            // ESIGN-5 FIX: Constant-time token comparison
            if (!safeCompare(storedToken, accessToken)) {
                throw new HttpsError('permission-denied', 'Unauthorized');
            }

            if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
                throw new HttpsError('deadline-exceeded', 'This signing link has expired. Please request a new one.');
            }

            // Allow fresh submissions and self-healing retries over a hung 'processing' claim
            if (data.status !== 'sent' && data.status !== 'processing') {
                throw new HttpsError('failed-precondition', 'This document has already been submitted or is no longer available.');
            }

            // Claim the slot atomically
            txn.update(docRef, { status: 'processing' });
            claimCommitted = true;
        });

        const fields = Array.isArray(requestData?.fields)
            ? requestData.fields.filter((f) => f && f.id)
            : [];
        const allowedFieldIds = new Set(fields.map((f) => String(f.id)));

        const bucket = storage.bucket();
        const finalValues = {};

        for (const [key, value] of Object.entries(normalizedFieldValues)) {
            if (!allowedFieldIds.has(key)) {
                throw new HttpsError('invalid-argument', `Invalid field id submitted: ${key}`);
            }

            if (typeof value === 'string' && value.startsWith('data:image')) {
                const base64Image = value.split(';base64,').pop();
                const buffer = Buffer.from(base64Image, 'base64');
                const filePath = `secure_documents/${companyId}/signatures/${requestId}_${key}.png`;

                await bucket.file(filePath).save(buffer, {
                    metadata: { contentType: 'image/png' }
                });
                finalValues[key] = filePath;
            } else {
                finalValues[key] = value;
            }
        }

        const missingRequired = [];
        for (const field of fields) {
            if (!field.required) continue;

            let submitted = Object.prototype.hasOwnProperty.call(finalValues, field.id)
                ? finalValues[field.id]
                : field.defaultValue;

            if (
                field.type !== 'checkbox' &&
                isLockedFieldForSubmit(field) &&
                submitted !== null &&
                submitted !== undefined &&
                typeof submitted === 'string' &&
                submitted.trim() === ''
            ) {
                submitted = field.defaultValue;
                finalValues[field.id] = submitted;
            }

            if (field.type === 'checkbox') {
                if (submitted !== true) missingRequired.push(field.label || field.id);
                continue;
            }

            if (submitted === null || submitted === undefined) {
                missingRequired.push(field.label || field.id);
                continue;
            }

            if (typeof submitted === 'string' && submitted.trim() === '') {
                missingRequired.push(field.label || field.id);
            }
        }

        if (missingRequired.length > 0) {
            throw new HttpsError(
                'failed-precondition',
                `Required fields missing: ${missingRequired.join(', ')}`
            );
        }

        // ESIGN-2 FIX: Override the client-supplied IP with the actual server-observed IP.
        const signerIp =
            request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
            request.rawRequest?.ip ||
            '0.0.0.0';

        await docRef.update({
            status: 'pending_seal',
            fieldValues: finalValues,
            signedAt: admin.firestore.FieldValue.serverTimestamp(),
            auditTrail: {
                ...auditData,
                ip: signerIp,
                timestamp: new Date().toISOString(),
                method: 'Public Secure Link'
            }
        });

        // Submission succeeded — do not roll back on token invalidation failure
        claimCommitted = false;

        // BUG-2 FIX: Delete the secrets sub-doc to invalidate the token
        await docRef.collection('secrets').doc('token').delete();

        return { success: true };

    } catch (error) {
        if (claimCommitted) {
            try {
                await docRef.update({
                    status: 'sent',
                    lastError: error.message || String(error),
                    errorTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (rollbackErr) {
                console.error('Self-healing rollback failed:', rollbackErr);
            }
        }

        // ESIGN-10 FIX: Never leak internal error details to the public signer
        if (error instanceof HttpsError) throw error;
        console.error("Submit Error:", error);
        throw new HttpsError('internal', 'An error occurred processing your submission. Please try again.');
    }
});
