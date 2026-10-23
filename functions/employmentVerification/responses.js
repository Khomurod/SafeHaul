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
const { resolveEmployerTarget } = require("../shared/employerIdentity");
const { generateVerificationPDF } = require("./pdf");
const { notifyCarrierVerificationComplete } = require("./notifications");
const { normaliseSignature } = require("./signature");

/** The free-text answers, each limited to 2,000 characters. */
const TEXT_ANSWERS = [
    ['violationDetails', 'Violation details'],
    ['accidentDetails', 'Accident details'],
    ['additionalComments', 'Additional comments'],
    ['rehireExplanation', 'The rehire explanation'],
    ['followUpTestingPlan', 'The follow-up testing plan'],
    ['nonRecordableAccidentDetails', 'Other accident details'],
];

/** Return-to-duty answers after which a follow-up testing plan applies. */
const FOLLOW_UP_ANSWERS = ['yes', 'in_progress'];

/**
 * The optional answers the portal shows only after a given answer. Each is
 * kept only when the answer it follows is on the response, so text left in a
 * box the employer then hid never reaches the record.
 */
function followUpAnswers(formResponse) {
    const textOf = (value) => (typeof value === 'string' && value.trim() ? value : null);
    const otherAccidents = typeof formResponse.hadNonRecordableAccidents === 'boolean'
        ? formResponse.hadNonRecordableAccidents
        : null;
    return {
        rehireExplanation: formResponse.eligibleForRehire === false ? textOf(formResponse.rehireExplanation) : null,
        followUpTestingPlan: formResponse.hadDrugAlcoholViolations === true
            && FOLLOW_UP_ANSWERS.includes(formResponse.completedReturnToDuty)
            ? textOf(formResponse.followUpTestingPlan)
            : null,
        hadNonRecordableAccidents: otherAccidents,
        nonRecordableAccidentDetails: otherAccidents === true ? textOf(formResponse.nonRecordableAccidentDetails) : null,
    };
}

/**
 * The checks an answer must pass. They run before the request is claimed: a
 * claim left behind by a refused answer ('processing') took the request out of
 * the reminder query (./reminders.js) for good, with no 30-day no-response mark.
 */
function validateResponse(formResponse) {
    if (!formResponse.respondentName || !formResponse.respondentTitle || !formResponse.respondentPhone) {
        throw new HttpsError('invalid-argument', 'Respondent name, title, and phone are required.');
    }

    // The signature is validated here, before anything is stored: a drawn
    // PNG or a typed name (`TEXT_SIGNATURE:<name>`), nothing else. See
    // ./signature.js for what is refused and why.
    const signature = normaliseSignature(formResponse.signatureData, formResponse.signatureMethod);

    // Server-side length limits to prevent oversized PDF / memory exhaustion
    for (const [field, label] of TEXT_ANSWERS) {
        if (formResponse[field] && formResponse[field].length > 2000) {
            throw new HttpsError('invalid-argument', `${label} cannot exceed 2000 characters.`);
        }
    }
    return signature;
}

/**
 * Put back the status a request had before a submission that failed claimed it,
 * so it stays in the reminder cycle and its employer can submit again. Only a
 * request still 'processing' is touched: a claim does not refuse an overlapping
 * submission, and one that completed keeps 'completed'. A request this
 * submission found 'processing' already goes back to 'opened'.
 */
async function releaseClaim(docRef, previousStatus) {
    const status = previousStatus && previousStatus !== 'processing' ? previousStatus : 'opened';
    try {
        await db.runTransaction(async (txn) => {
            const snap = await txn.get(docRef);
            if (snap.exists && snap.data().status === 'processing') txn.update(docRef, { status });
        });
    } catch (error) {
        logger.error(`[PEV] Could not release the claim on ${docRef.id}:`, error);
    }
}

// ============================================================
// 3. SUBMIT VERIFICATION RESPONSE (Public endpoint — token-based)
// ============================================================
// The secret decrypts an SMTP password stored encrypted (emailService.js).
exports.submitVerificationResponse = onCall({ cors: true, memory: '1GiB', timeoutSeconds: 120, secrets: ['SMS_ENCRYPTION_KEY'] }, async (request) => {
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
        let signature = null;
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
                signature = validateResponse(formResponse);

                // Claim the slot atomically — prevents double-submission race
                txn.update(docRef, { status: 'processing', claimedAt: admin.firestore.FieldValue.serverTimestamp() });
                verificationData = data;
            });
        } catch (txnErr) {
            if (txnErr instanceof HttpsError) throw txnErr;
            throw new HttpsError('internal', 'Failed to process verification request.');
        }

        if (!verificationData) throw new HttpsError('internal', 'Verification data unavailable.');

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

            // Optional answers that follow another one (see followUpAnswers).
            ...followUpAnswers(formResponse),

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
        try {
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

            // The answer and the completion are one write. An answer kept on a
            // request put back in the reminder cycle would draw reminders and a
            // no-response mark, and the employer's retry would overwrite it.
            const batch = db.batch();
            batch.set(docRef.collection('responses').doc('submission'), responseData);
            batch.update(docRef, { status: 'completed', completedAt: now });
            await batch.commit();
        } catch (claimedStepError) {
            await releaseClaim(docRef, verificationData.status);
            throw claimedStepError;
        }

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
                /**
                 * Which employer this answer belongs to.
                 *
                 * `employerIndex` alone used to decide, and it is positional: a
                 * carrier that deleted or reordered an employer after sending the
                 * request would have this completed verification — its respondent,
                 * its signature and its result PDF — filed against a DIFFERENT
                 * company, silently. `resolveEmployerTarget` answers by
                 * `employerId`, falls back to the index only for a request that
                 * predates ids AND still finds the employer it was sent to by name,
                 * and otherwise answers null. Null is refused below rather than
                 * guessed at: the response itself is stored on this request document
                 * and its PDF is generated, so nothing is lost by declining to
                 * mirror it onto the wrong row.
                 */
                const target = resolveEmployerTarget(employers, verificationData);
                if (!target) {
                    logger.warn(
                        `[PEV] Verification ${token} could not be matched to an employer on `
                        + `${verificationData.collectionName || 'applications'}/${verificationData.applicationId}; `
                        + 'the response and its PDF are on the request record and were not mirrored.',
                    );
                }
                const idx = target ? target.index : -1;

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
