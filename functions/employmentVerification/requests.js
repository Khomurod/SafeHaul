/**
 * PEV — verification request creation.
 * Company admin triggers a Previous Employment Verification: mints the token,
 * stores the verification_requests doc, and emails the previous employer.
 *
 * ## The request records WHICH employer, not just where it was
 *
 * `employerIndex` was the only pointer, and it is positional: delete or reorder an
 * employer and a request issued for one carrier writes its answer onto another.
 * Since employers became editable that is a supported workflow, so the request now
 * also records `employerId` — a stable identity minted on the row itself — and the
 * write-back resolves by it. See `shared/employerIdentity.js`.
 *
 * The id is resolved and, when the row does not yet have one, **stamped here**, so
 * a request is never issued against a row that cannot be found again. The index is
 * still stored, for the requests that predate this and for the audit record.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { sendDynamicEmail } = require("../emailService");
const { assertCompanyAccessForRequest } = require("../shared/companyAccess");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("firebase-functions");
const { buildVerificationEmailHTML } = require("./emailTemplates");
const { employerNameOf, resolveEmployerTarget, withEmployerIds } = require("../shared/employerIdentity");

/**
 * RFC 5321/5322 compatible email validation.
 * More robust than a simple /^[^\s@]+@[^\s@]+\.[^\s@]+$/ regex.
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    // Max 254 chars per RFC 5321
    if (email.length > 254) return false;
    // Split into local@domain
    const atIndex = email.lastIndexOf('@');
    if (atIndex < 1) return false; // no @ or empty local part
    const local = email.substring(0, atIndex);
    const domain = email.substring(atIndex + 1);
    // local part max 64 chars
    if (local.length > 64 || domain.length < 3) return false;
    // Domain must contain a dot and no consecutive dots
    if (!domain.includes('.') || domain.includes('..')) return false;
    // Full pattern check (RFC 5322 simplified)
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email);
}


// ============================================================
// 1. SEND VERIFICATION REQUEST (Called from PEVTab)
// ============================================================
exports.sendVerificationRequest = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const {
        companyId,
        applicationId,
        collectionName = 'applications',
        employerIndex,
        employerName,
        employerEmail,
        applicantName,
        employmentStartDate,
        employmentEndDate,
        deliveryMethod = 'email'
    } = request.data || {};

    // Validate required fields
    if (!companyId || !applicationId || employerIndex === undefined || !applicantName) {
        throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    if (deliveryMethod === 'email' && !employerEmail) {
        throw new HttpsError('invalid-argument', 'Employer email is required for email delivery.');
    }

    // PEV-SEC-2 FIX: Whitelist collectionName to prevent path injection attacks.
    const ALLOWED_COLLECTIONS = ['applications', 'leads'];
    if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
        throw new HttpsError('invalid-argument', `Invalid collection: ${collectionName}`);
    }

    // PEV-VAL-2 FIX: Validate employer email format server-side using RFC 5322 compatible check.
    if (deliveryMethod === 'email' && employerEmail && !isValidEmail(employerEmail)) {
        throw new HttpsError('invalid-argument', 'Invalid employer email address format.');
    }

    // PEV-VAL-3 FIX: Validate employerIndex is a non-negative integer.
    const empIndex = Number(employerIndex);
    if (!Number.isInteger(empIndex) || empIndex < 0) {
        throw new HttpsError('invalid-argument', 'employerIndex must be a non-negative integer.');
    }

    // PEV-SEC-1 FIX: Verify the caller actually belongs to the specified company.
    await assertCompanyAccessForRequest(request, companyId, 'PEV/sendVerificationRequest');

    try {
        // Get company name
        const companyDoc = await db.collection('companies').doc(companyId).get();
        if (!companyDoc.exists) throw new HttpsError('not-found', 'Company not found.');
        const companyData = companyDoc.data();
        const companyName = companyData.companyName || companyData.name || 'Prospective Employer';

        /**
         * Which employer this request is for, as an identity rather than a position.
         *
         * Resolved server-side against the application itself: the client may pass
         * an `employerId` it already knows, and the server still has to find the
         * row. A row with no id yet is stamped now — because a request issued
         * against a row that cannot be found again is a result with nowhere safe to
         * go.
         *
         * ## Why a transaction, and not a read followed by an update
         *
         * `withEmployerIds` mints an id for every row that lacks one and the write
         * is the whole array, so two recruiters sending requests for two different
         * employers on the same unstamped application at the same time each mint a
         * *different* set of ids and each write all of them. The second write wins,
         * and the first request is left recording an `employerId` that is no longer
         * on the document — which `recordVerificationResponse` then cannot resolve,
         * so the answer that comes back has nowhere to go. Exactly the orphaning the
         * identity was introduced to prevent, arriving by a different door. Review
         * found it on 2026-09-09.
         *
         * Reading and stamping inside one transaction makes the loser retry against
         * the winner's array, find the ids already there, and stamp nothing.
         *
         * The application document is where employers live; a `leads` record uses
         * the same shape and the same allowlisted collection names.
         */
        const appRef = db.collection('companies').doc(companyId)
            .collection(collectionName).doc(applicationId);
        const { target, employerId, employers: stamped } = await db.runTransaction(async (tx) => {
            const appSnap = await tx.get(appRef);
            if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found.');
            const stored = Array.isArray(appSnap.data()?.employers) ? appSnap.data().employers : [];
            const { employers: withIds, changed } = withEmployerIds(stored);

            const found = resolveEmployerTarget(withIds, {
                employerId: request.data?.employerId,
                employerIndex: empIndex,
                // The name the caller is sending the request about, so the legacy
                // index route has something to check against. `employerName` may be
                // absent from the payload, in which case the stored row's own name is
                // what the request records.
                employerName: employerName || employerNameOf(withIds[empIndex]),
            });
            // Refused before anything is written: an id stamped for a request that
            // cannot be issued is a change nobody asked for.
            if (!found) {
                throw new HttpsError(
                    'not-found',
                    'That employer is no longer on this application. Refresh and try again.',
                );
            }
            if (changed) tx.update(appRef, { employers: withIds });
            return { target: found, employerId: withIds[found.index].employerId, employers: withIds };
        });

        // Generate unique token
        const token = uuidv4();
        const now = admin.firestore.Timestamp.now();
        const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + (30 * 24 * 60 * 60 * 1000)); // 30 days
        const deadlineDate = new Date(expiresAt.toMillis()).toISOString().split('T')[0];

        // Determine base URL
        const baseUrl = companyData.appUrl || 'https://app.safehaul.io';

        // Create verification request document
        const verificationData = {
            token,
            companyId,
            applicationId,
            collectionName,
            employerIndex: target.index,
            // The identity the write-back resolves by. `employerIndex` above stays
            // for the audit record and for nothing else.
            employerId,
            employerName: employerName || employerNameOf(stamped[target.index]) || 'Former Employer',
            employerEmail: employerEmail || null,
            applicantName,
            employmentStartDate: employmentStartDate || 'N/A',
            employmentEndDate: employmentEndDate || 'N/A',
            companyName,
            deliveryMethod,
            status: 'sent',
            createdAt: now,
            expiresAt,
            openedAt: null,
            completedAt: null,
            reminderCount: 0,
            lastReminderAt: null,
            createdBy: request.auth.uid,
        };

        // Store in verification_requests collection (global, indexed by token)
        const verificationRef = db.collection('verification_requests').doc(token);
        await verificationRef.set(verificationData);

        // Send email if delivery method is email
        let emailResult = { success: true, message: 'Manual delivery - no email sent.' };
        if (deliveryMethod === 'email' && employerEmail) {
            const emailHTML = buildVerificationEmailHTML({
                applicantName,
                employerName: employerName || 'Former Employer',
                companyName,
                employmentDates: `${employmentStartDate || 'N/A'} to ${employmentEndDate || 'N/A'}`,
                token,
                baseUrl,
                deadlineDate,
            });

            const subject = `Previous Employment Verification Request – ${applicantName}`;
            emailResult = await sendDynamicEmail(companyId, employerEmail, subject, emailHTML);
        }

        logger.info(`[PEV] Verification request created. Token: ${token}, Applicant: ${applicantName}, Employer: ${employerName}`);

        return {
            success: true,
            token,
            emailResult,
            verificationUrl: `${baseUrl}/verify/${token}`,
            // So the caller writing the initial mirror can find the row this
            // request was actually filed against, rather than the index it
            // pressed on. See `PEVTab.writeVerification`.
            employerId,
        };

    } catch (error) {
        // An `HttpsError` raised in here is a decision, not a fault: "that employer
        // is no longer on this application" and "company not found" both carry a
        // sentence the recruiter can act on, and re-wrapping them as `internal`
        // replaced it with "Failed to send verification request". `responses.js`
        // already re-throws this way.
        if (error instanceof HttpsError) throw error;
        logger.error('[PEV] Error sending verification request:', error);
        throw new HttpsError('internal', `Failed to send verification request: ${error.message}`);
    }
});
