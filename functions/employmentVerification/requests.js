/**
 * PEV — verification request creation.
 * Company admin triggers a Previous Employment Verification: mints the token,
 * stores the verification_requests doc, and emails the previous employer.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { sendDynamicEmail } = require("../emailService");
const { assertCompanyAccessForRequest } = require("../shared/companyAccess");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("firebase-functions");
const { buildVerificationEmailHTML } = require("./emailTemplates");

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
            employerIndex: Number(employerIndex),
            employerName: employerName || 'Former Employer',
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
        };

    } catch (error) {
        logger.error('[PEV] Error sending verification request:', error);
        throw new HttpsError('internal', `Failed to send verification request: ${error.message}`);
    }
});
