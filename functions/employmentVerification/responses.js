/**
 * PEV — verification response processing.
 * The previous employer submits the FMCSA §391.23 form: atomically claim the
 * token, persist the response + signature, generate the DQ-file PDF, mirror
 * status onto the application's employer entry, and notify the carrier.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, storage } = require("../firebaseAdmin");
const { checkRateLimit } = require("../shared/rateLimiter");
const { logger } = require("firebase-functions");
const { generateVerificationPDF } = require("./pdf");
const { notifyCarrierVerificationComplete } = require("./notifications");
const { normaliseSignature } = require("./signature");

// ============================================================
// 3. SUBMIT VERIFICATION RESPONSE (Public endpoint — token-based)
// ============================================================
exports.submitVerificationResponse = onCall({ cors: true, memory: '1GiB', timeoutSeconds: 120 }, async (request) => {
    const { token, response: formResponse } = request.data || {};

    if (!token || !formResponse) {
        throw new HttpsError('invalid-argument', 'Missing token or response data.');
    }

    // Rate limit: 5 submissions per 10 min per token
    const isAllowed = await checkRateLimit(`pev_submit_${token}`, 5, 600, 'closed');
    if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many submission attempts. Please wait.');

    try {
        const docRef = db.collection('verification_requests').doc(token);
        // PEV-INT-1 FIX: Use a Firestore transaction to atomically check + claim the submission.
        // A non-atomic read-then-write allows two concurrent submissions to both pass the
        // 'completed' check, with the second overwriting a legitimate response.
        let verificationData = null;
        try {
            await db.runTransaction(async (txn) => {
                const snap = await txn.get(docRef);
                if (!snap.exists) throw new HttpsError('not-found', 'Verification request not found.');
                const data = snap.data();

                if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
                    throw new HttpsError('deadline-exceeded', 'This verification request has expired.');
                }
                if (data.status === 'completed') {
                    throw new HttpsError('already-exists', 'This verification has already been completed.');
                }

                // Claim the slot atomically — prevents double-submission race
                txn.update(docRef, { status: 'processing', claimedAt: admin.firestore.FieldValue.serverTimestamp() });
                verificationData = data;
            });
        } catch (txnErr) {
            if (txnErr instanceof HttpsError) throw txnErr;
            throw new HttpsError('internal', 'Failed to process verification request.');
        }

        if (!verificationData) throw new HttpsError('internal', 'Verification data unavailable.');

        // Validate required respondent fields (after transaction so we don't hold a lock during validation)
        if (!formResponse.respondentName || !formResponse.respondentTitle || !formResponse.respondentPhone) {
            throw new HttpsError('invalid-argument', 'Respondent name, title, and phone are required.');
        }

        // The signature is validated here, before anything is stored: a drawn
        // PNG or a typed name (`TEXT_SIGNATURE:<name>`), nothing else. See
        // ./signature.js for what is refused and why.
        const signature = normaliseSignature(formResponse.signatureData, formResponse.signatureMethod);

        // PEV-VAL-1 FIX: Server-side length limits to prevent oversized PDF / memory exhaustion
        if (formResponse.violationDetails && formResponse.violationDetails.length > 2000) {
            throw new HttpsError('invalid-argument', 'Violation details cannot exceed 2000 characters.');
        }
        if (formResponse.accidentDetails && formResponse.accidentDetails.length > 2000) {
            throw new HttpsError('invalid-argument', 'Accident details cannot exceed 2000 characters.');
        }
        if (formResponse.additionalComments && formResponse.additionalComments.length > 2000) {
            throw new HttpsError('invalid-argument', 'Additional comments cannot exceed 2000 characters.');
        }

        const now = admin.firestore.Timestamp.now();

        // Build response document
        const responseData = {
            verificationToken: token,
            submittedAt: now,

            // Section 1: Employment Confirmation
            wasEmployed: formResponse.wasEmployed ?? null,
            confirmedStartDate: formResponse.confirmedStartDate || null,
            confirmedEndDate: formResponse.confirmedEndDate || null,
            positionHeld: formResponse.positionHeld || null,
            reasonForLeaving: formResponse.reasonForLeaving || null,
            eligibleForRehire: formResponse.eligibleForRehire ?? null,

            // Section 2: Safety & Compliance (FMCSA Required)
            subjectToFmcsrs: formResponse.subjectToFmcsrs ?? null,
            subjectToDotTesting: formResponse.subjectToDotTesting ?? null,
            hadDrugAlcoholViolations: formResponse.hadDrugAlcoholViolations ?? null,
            violationDetails: formResponse.violationDetails || null,
            completedReturnToDuty: formResponse.completedReturnToDuty || null,
            hadAccidents: formResponse.hadAccidents ?? null,
            accidentDetails: formResponse.accidentDetails || null,

            // Section 3: Additional Info
            additionalComments: formResponse.additionalComments || null,

            // Section 4: Respondent Verification
            respondentName: formResponse.respondentName,
            respondentTitle: formResponse.respondentTitle,
            respondentPhone: formResponse.respondentPhone,
            respondentEmail: formResponse.respondentEmail || null,

            // Audit trail
            ipAddress: request.rawRequest?.ip || 'unknown',
            userAgent: request.rawRequest?.headers?.['user-agent'] || 'unknown',
        };

        // Signature (validated above). A drawn mark is a PNG in Cloud Storage
        // referenced by path; a typed mark is stored as text. The method is
        // recorded from what was validated, not from what the client claimed.
        responseData.signatureMethod = signature.kind === 'none' ? null : signature.kind;
        if (signature.kind === 'drawn') {
            const signaturePath = `companies/${verificationData.companyId}/pev_signatures/${token}.png`;
            const bucket = storage.bucket();
            await bucket.file(signaturePath).save(signature.png, {
                metadata: { contentType: 'image/png' },
            });
            responseData.signaturePath = signaturePath;
        } else if (signature.kind === 'typed') {
            responseData.signatureText = signature.name;
        }

        // Store the response in a subcollection
        await docRef.collection('responses').doc('submission').set(responseData);

        // Update verification request status
        await docRef.update({
            status: 'completed',
            completedAt: now,
        });

        // Generate PDF for DQ file
        let pdfPath = null;
        try {
            // PEV-BRK-3: generateVerificationPDF now returns the permanent pdfPath, not a signed URL
            pdfPath = await generateVerificationPDF(verificationData, responseData, token);
        } catch (pdfError) {
            logger.error('[PEV] PDF generation failed (non-blocking):', pdfError);
        }

        // Update the employer's verification status in the application document
        try {
            const appRef = db.collection('companies')
                .doc(verificationData.companyId)
                .collection(verificationData.collectionName || 'applications')
                .doc(verificationData.applicationId);

            const appSnap = await appRef.get();
            if (appSnap.exists) {
                const appData = appSnap.data();
                const employers = [...(appData.employers || [])];
                const idx = verificationData.employerIndex;

                if (employers[idx]) {
                    if (!employers[idx].verification) {
                        employers[idx].verification = { history: [] };
                    }
                    employers[idx].verification.status = 'Completed';
                    employers[idx].verification.completedAt = new Date().toISOString();
                    employers[idx].verification.resultUrl = pdfPath || null;
                    // PEV-SEC-3 FIX: Do NOT store the raw verification token in the application document.
                    // The application doc is readable by all company team members; storing the token
                    // here would allow any team member to reuse it to re-submit or tamper with the
                    // verification response. Reference the verification by the respondent name only.
                    employers[idx].verification.respondentName = formResponse.respondentName;
                    employers[idx].verification.history = employers[idx].verification.history || [];
                    employers[idx].verification.history.push({
                        action: 'Completed via Portal',
                        respondent: formResponse.respondentName,
                        timestamp: new Date().toISOString(),
                        url: pdfPath || null,
                    });

                    await appRef.update({ employers });
                }
            }
        } catch (updateError) {
            logger.error('[PEV] Failed to update application (non-blocking):', updateError);
        }

        // Notify the requesting company
        try {
            await notifyCarrierVerificationComplete(verificationData, formResponse);
        } catch (notifyError) {
            logger.error('[PEV] Failed to notify carrier (non-blocking):', notifyError);
        }

        logger.info(`[PEV] Verification completed. Token: ${token}, Respondent: ${formResponse.respondentName}`);

        return {
            success: true,
            message: 'Verification response submitted successfully. Thank you for your cooperation.',
        };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[PEV] Error submitting response:', error);
        throw new HttpsError('internal', 'Failed to submit verification response.');
    }
});
