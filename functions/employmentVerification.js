/**
 * Employment Verification Cloud Functions
 * =========================================
 * Implements FMCSA 49 CFR §391.23 compliant Previous Employment Verification (PEV)
 * with a secure, tokenized public response portal.
 *
 * Architecture:
 *  - Company admin triggers PEV → generates a unique token → stores verification_requests doc
 *  - Email is sent with a "Complete Verification Online" button linking to /verify/:token
 *  - Previous employer clicks link → lands on public React form (no login)
 *  - Form submission calls submitVerificationResponse → stores response, generates PDF, notifies carrier
 *  - Scheduled function sends automated reminders at 5/10/15/20/30 day intervals
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db, storage } = require("./firebaseAdmin");
const { sendDynamicEmail } = require("./emailService");
const { checkRateLimit } = require("./shared/rateLimiter");
const { v4: uuidv4 } = require("uuid");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const { logger } = require("firebase-functions");


// ============================================================
// HELPER: Build verification email HTML with CTA button
// ============================================================
function buildVerificationEmailHTML({ applicantName, employerName, companyName, employmentDates, token, baseUrl, deadlineDate }) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f7fa; padding: 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background: #f5f7fa;">
            <tr><td align="center" style="padding: 32px 0;">
                <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

                    <!-- Header -->
                    <tr>
                        <td style="background: #1a2332; padding: 24px 32px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 20px;">&#128203; Previous Employment Verification Request</h1>
                            <p style="color: #7eb8da; margin: 4px 0 0; font-size: 13px;">FMCSA 49 CFR Part 391.23 Compliance</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="font-size: 15px; line-height: 1.6; color: #333;">
                                Dear <strong>${employerName}</strong>,
                            </p>

                            <p style="font-size: 15px; line-height: 1.6; color: #333;">
                                We are writing to verify the employment history of <strong>${applicantName}</strong>,
                                who has applied for a commercial driving position with <strong>${companyName}</strong>.
                            </p>

                            <p style="font-size: 14px; line-height: 1.6; color: #555;">
                                Under <strong>FMCSA 49 CFR Part 391.23</strong>, prospective employers of commercial motor vehicle
                                drivers are required to investigate the driver's employment record for the preceding 3 years.
                                Previous employers are <strong>required to respond within 30 days</strong>.
                            </p>

                            <!-- Applicant Details Box -->
                            <table width="100%" cellpadding="12" cellspacing="0" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; margin: 20px 0;">
                                <tr><td colspan="2" style="font-weight: bold; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding: 12px;">Applicant Details</td></tr>
                                <tr><td style="color: #555; width: 180px; padding: 8px 12px;">Name:</td><td style="font-weight: bold; padding: 8px 12px;">${applicantName}</td></tr>
                                <tr><td style="color: #555; padding: 8px 12px;">Reported Dates:</td><td style="padding: 8px 12px;">${employmentDates}</td></tr>
                                <tr><td style="color: #555; padding: 8px 12px;">Response Deadline:</td><td style="color: #dc2626; font-weight: bold; padding: 8px 12px;">${deadlineDate}</td></tr>
                            </table>

                            <!-- CTA BUTTON -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                                <tr><td align="center">
                                    <a href="${baseUrl}/verify/${token}"
                                       style="display: inline-block; background: #2563eb; color: white; text-decoration: none;
                                              padding: 16px 48px; font-size: 16px; font-weight: bold; border-radius: 8px;
                                              letter-spacing: 0.5px;">
                                        &#9989; Complete Verification Online
                                    </a>
                                </td></tr>
                            </table>

                            <p style="font-size: 13px; color: #888; text-align: center;">
                                Or copy and paste this link into your browser:<br>
                                <a href="${baseUrl}/verify/${token}" style="color: #2563eb; word-break: break-all;">
                                    ${baseUrl}/verify/${token}
                                </a>
                            </p>

                            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

                            <p style="font-size: 14px; color: #555; line-height: 1.5;">
                                This secure link will take you to an online form where you can complete the verification
                                in approximately <strong>2-3 minutes</strong>. The form will ask for:
                            </p>
                            <ul style="font-size: 13px; color: #555; line-height: 1.8; padding-left: 20px;">
                                <li>Employment date confirmation</li>
                                <li>Position held and reason for leaving</li>
                                <li>DOT drug &amp; alcohol testing history</li>
                                <li>Accident history (last 3 years)</li>
                                <li>Your electronic signature</li>
                            </ul>

                            <p style="font-size: 14px; color: #333; margin-top: 20px;">
                                Thank you for your prompt attention to this matter.
                            </p>

                            <p style="font-size: 14px; color: #333;">
                                Best regards,<br>
                                <strong>${companyName}</strong>
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8fafc; padding: 16px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                                This request was generated by <strong>SafeHaul Compliance Services</strong><br>
                                Secure verification ID: ${token}<br>
                                This link expires on ${deadlineDate}.
                            </p>
                        </td>
                    </tr>

                </table>
            </td></tr>
        </table>

        <!-- Tracking Pixel -->
        <img src="${baseUrl}/api/verification/${token}/track-open" width="1" height="1" style="display:none;" alt="" />
    </div>`;
}

// ============================================================
// HELPER: Build reminder email HTML
// ============================================================
function buildReminderEmailHTML({ applicantName, employerName, companyName, employmentDates, token, baseUrl, deadlineDate, reminderType }) {
    const urgencyStyles = {
        first_reminder: { bannerColor: '#f59e0b', bannerText: 'Reminder', urgencyText: 'This is a friendly reminder that we are still awaiting your response.' },
        second_reminder: { bannerColor: '#f97316', bannerText: '2nd Reminder', urgencyText: 'We have not yet received your response. This is your second notice.' },
        final_notice: { bannerColor: '#dc2626', bannerText: 'FINAL NOTICE', urgencyText: 'This is your FINAL NOTICE. Federal regulation requires you to respond within 30 days. Failure to respond will be documented.' }
    };
    const style = urgencyStyles[reminderType] || urgencyStyles.first_reminder;

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${style.bannerColor}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="margin: 0; font-size: 18px;">&#9888;&#65039; ${style.bannerText}: Employment Verification Required</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">FMCSA 49 CFR Part 391.23 Compliance</p>
        </div>
        <div style="background: white; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
            <p>Dear <strong>${employerName}</strong>,</p>
            <p>${style.urgencyText}</p>
            <p>We previously requested verification of employment for <strong>${applicantName}</strong>, who has applied for a commercial driving position with <strong>${companyName}</strong>.</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
                <table style="width: 100%; font-size: 14px; color: #475569;">
                    <tr><td style="padding: 4px 0;"><strong>Applicant:</strong></td><td>${applicantName}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Reported Dates:</strong></td><td>${employmentDates}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Deadline:</strong></td><td style="color: #dc2626; font-weight: bold;">${deadlineDate}</td></tr>
                </table>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
                <tr><td align="center">
                    <a href="${baseUrl}/verify/${token}"
                       style="display: inline-block; background: #2563eb; color: white; text-decoration: none;
                              padding: 16px 48px; font-size: 16px; font-weight: bold; border-radius: 8px;">
                        &#9989; Complete Verification Now
                    </a>
                </td></tr>
            </table>
            <p style="font-size: 13px; color: #888; text-align: center;">
                <a href="${baseUrl}/verify/${token}" style="color: #2563eb;">${baseUrl}/verify/${token}</a>
            </p>
            <p>Best regards,<br><strong>${companyName}</strong></p>
        </div>
        <div style="background: #f1f5f9; padding: 12px 24px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; text-align: center;">Generated by SafeHaul Compliance Services &bull; ID: ${token}</p>
        </div>
    </div>`;
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


// ============================================================
// 2. GET VERIFICATION (Public endpoint — token-based access)
// ============================================================
exports.getVerificationRequest = onCall({ cors: true }, async (request) => {
    const { token } = request.data || {};
    if (!token) throw new HttpsError('invalid-argument', 'Missing verification token.');

    // Rate limit: 20 reads per minute per token
    const isAllowed = await checkRateLimit(`pev_read_${token}`, 20, 60);
    if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a moment.');

    try {
        const docRef = db.collection('verification_requests').doc(token);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new HttpsError('not-found', 'Verification request not found. The link may be invalid.');
        }

        const data = docSnap.data();

        // Check expiration
        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            throw new HttpsError('deadline-exceeded', 'This verification request has expired. Please contact the requesting company.');
        }

        // Check if already completed
        if (data.status === 'completed') {
            return {
                status: 'completed',
                completedAt: data.completedAt?.toDate()?.toISOString() || null,
                message: 'This verification has already been completed. Thank you.',
            };
        }

        // Track open (mark as opened if first time)
        if (['sent', 'pending', 'reminder_sent'].includes(data.status)) {
            await docRef.update({
                status: 'opened',
                openedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        // Return sanitized data (never expose internal IDs)
        return {
            status: 'pending',
            applicantName: data.applicantName,
            employerName: data.employerName,
            companyName: data.companyName,
            employmentStartDate: data.employmentStartDate,
            employmentEndDate: data.employmentEndDate,
            createdAt: data.createdAt?.toDate()?.toISOString() || null,
            expiresAt: data.expiresAt?.toDate()?.toISOString() || null,
        };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error('[PEV] Error fetching verification:', error);
        throw new HttpsError('internal', 'Failed to load verification request.');
    }
});


// ============================================================
// 3. SUBMIT VERIFICATION RESPONSE (Public endpoint — token-based)
// ============================================================
exports.submitVerificationResponse = onCall({ cors: true }, async (request) => {
    const { token, response: formResponse } = request.data || {};

    if (!token || !formResponse) {
        throw new HttpsError('invalid-argument', 'Missing token or response data.');
    }

    // Rate limit: 5 submissions per 10 min per token
    const isAllowed = await checkRateLimit(`pev_submit_${token}`, 5, 600, 'closed');
    if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many submission attempts. Please wait.');

    try {
        const docRef = db.collection('verification_requests').doc(token);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new HttpsError('not-found', 'Verification request not found.');
        }

        const verificationData = docSnap.data();

        // Check expiration
        if (verificationData.expiresAt && verificationData.expiresAt.toMillis() < Date.now()) {
            throw new HttpsError('deadline-exceeded', 'This verification request has expired.');
        }

        // Check if already completed
        if (verificationData.status === 'completed') {
            throw new HttpsError('already-exists', 'This verification has already been completed.');
        }

        // Validate required respondent fields
        if (!formResponse.respondentName || !formResponse.respondentTitle || !formResponse.respondentPhone) {
            throw new HttpsError('invalid-argument', 'Respondent name, title, and phone are required.');
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

        // Handle signature data (base64 image → Cloud Storage)
        let signaturePath = null;
        if (formResponse.signatureData && formResponse.signatureData.startsWith('data:image')) {
            const base64Data = formResponse.signatureData.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            signaturePath = `companies/${verificationData.companyId}/pev_signatures/${token}.png`;

            const bucket = storage.bucket();
            await bucket.file(signaturePath).save(buffer, {
                metadata: { contentType: 'image/png' },
            });
            responseData.signaturePath = signaturePath;
        }

        // Store the response in a subcollection
        await docRef.collection('responses').doc('submission').set(responseData);

        // Update verification request status
        await docRef.update({
            status: 'completed',
            completedAt: now,
        });

        // Generate PDF for DQ file
        let pdfUrl = null;
        try {
            pdfUrl = await generateVerificationPDF(verificationData, responseData, token);
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
                    employers[idx].verification.resultUrl = pdfUrl || null;
                    employers[idx].verification.responseToken = token;
                    employers[idx].verification.respondentName = formResponse.respondentName;
                    employers[idx].verification.history = employers[idx].verification.history || [];
                    employers[idx].verification.history.push({
                        action: 'Completed via Portal',
                        respondent: formResponse.respondentName,
                        timestamp: new Date().toISOString(),
                        url: pdfUrl || null,
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


// ============================================================
// 4. TRACKING PIXEL (HTTP endpoint for email open tracking)
// ============================================================
exports.trackVerificationOpen = onRequest({ cors: true }, async (req, res) => {
    const token = req.path.split('/').pop();

    if (token && token.length > 10) {
        try {
            const docRef = db.collection('verification_requests').doc(token);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                const data = docSnap.data();
                if (['sent', 'pending'].includes(data.status)) {
                    await docRef.update({
                        status: 'opened',
                        openedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            }
        } catch (e) {
            // Silent fail — tracking is non-critical
            logger.warn('[PEV] Tracking pixel error:', e.message);
        }
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).send(pixel);
});


// ============================================================
// 5. AUTOMATED REMINDERS (Scheduled — runs every 24 hours)
// ============================================================
exports.processVerificationReminders = onSchedule("every 24 hours", async () => {
    logger.info('[PEV Reminders] Starting reminder processing...');

    try {
        // Query all non-completed verification requests
        const snapshot = await db.collection('verification_requests')
            .where('status', 'in', ['sent', 'opened', 'reminder_sent'])
            .get();

        if (snapshot.empty) {
            logger.info('[PEV Reminders] No pending verifications found.');
            return;
        }

        let remindersProcessed = 0;
        let marked30Day = 0;

        for (const doc of snapshot.docs) {
            const v = doc.data();
            const daysSinceSent = Math.floor((Date.now() - v.createdAt.toMillis()) / (1000 * 60 * 60 * 24));
            const token = doc.id;

            // Determine base URL
            let baseUrl = 'https://app.safehaul.io';
            try {
                const companyDoc = await db.collection('companies').doc(v.companyId).get();
                if (companyDoc.exists) {
                    baseUrl = companyDoc.data().appUrl || baseUrl;
                }
            } catch (e) { /* use default */ }

            const deadlineDate = v.expiresAt ? new Date(v.expiresAt.toMillis()).toISOString().split('T')[0] : 'N/A';
            const emailParams = {
                applicantName: v.applicantName,
                employerName: v.employerName,
                companyName: v.companyName,
                employmentDates: `${v.employmentStartDate} to ${v.employmentEndDate}`,
                token,
                baseUrl,
                deadlineDate,
            };

            try {
                if (daysSinceSent >= 30) {
                    // Mark as no_response — document good-faith effort
                    await doc.ref.update({
                        status: 'no_response',
                        markedNoResponseAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // Update application record
                    await updateApplicationVerificationStatus(v, 'No Response (Good Faith Documented)');

                    // Notify carrier
                    await notifyCarrierNoResponse(v);

                    marked30Day++;
                    continue;
                }

                if (daysSinceSent >= 20 && v.reminderCount < 3 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'final_notice', v.applicantName);
                    await doc.ref.update({ reminderCount: 3, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                } else if (daysSinceSent >= 15 && v.reminderCount < 2 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'second_reminder', v.applicantName);
                    await doc.ref.update({ reminderCount: 2, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                } else if (daysSinceSent >= 5 && v.reminderCount < 1 && v.employerEmail) {
                    await sendReminderEmail(v.companyId, v.employerEmail, emailParams, 'first_reminder', v.applicantName);
                    await doc.ref.update({ reminderCount: 1, lastReminderAt: admin.firestore.FieldValue.serverTimestamp(), status: 'reminder_sent' });
                    remindersProcessed++;
                }
            } catch (reminderError) {
                logger.error(`[PEV Reminders] Error processing token ${token}:`, reminderError.message);
            }
        }

        logger.info(`[PEV Reminders] Complete. Reminders sent: ${remindersProcessed}, Marked no-response: ${marked30Day}`);

    } catch (error) {
        logger.error('[PEV Reminders] Fatal error:', error);
    }
});


// ============================================================
// HELPER: Send reminder email
// ============================================================
async function sendReminderEmail(companyId, recipientEmail, emailParams, reminderType, applicantName) {
    const subjects = {
        first_reminder: `Reminder: Employment Verification Pending – ${applicantName}`,
        second_reminder: `2nd Reminder: Employment Verification Required – ${applicantName}`,
        final_notice: `FINAL NOTICE: Employment Verification Required – ${applicantName}`,
    };

    const html = buildReminderEmailHTML({ ...emailParams, reminderType });
    await sendDynamicEmail(companyId, recipientEmail, subjects[reminderType], html);
}


// ============================================================
// HELPER: Update application verification status
// ============================================================
async function updateApplicationVerificationStatus(verificationData, statusText) {
    try {
        const appRef = db.collection('companies')
            .doc(verificationData.companyId)
            .collection(verificationData.collectionName || 'applications')
            .doc(verificationData.applicationId);

        const appSnap = await appRef.get();
        if (!appSnap.exists) return;

        const appData = appSnap.data();
        const employers = [...(appData.employers || [])];
        const idx = verificationData.employerIndex;

        if (employers[idx]) {
            if (!employers[idx].verification) {
                employers[idx].verification = { history: [] };
            }
            employers[idx].verification.status = statusText;
            employers[idx].verification.history = employers[idx].verification.history || [];
            employers[idx].verification.history.push({
                action: statusText,
                timestamp: new Date().toISOString(),
            });

            await appRef.update({ employers });
        }
    } catch (e) {
        logger.error('[PEV] Failed to update app verification status:', e.message);
    }
}


// ============================================================
// HELPER: Notify carrier that verification is complete
// ============================================================
async function notifyCarrierVerificationComplete(verificationData, formResponse) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const companyData = companyDoc.data();
    const adminEmail = companyData.adminEmail || companyData.email;
    if (!adminEmail) return;

    const wasEmployed = formResponse.wasEmployed ? 'Yes' : 'No';
    const hadViolations = formResponse.hadDrugAlcoholViolations ? '⚠️ YES' : '✅ No';
    const hadAccidents = formResponse.hadAccidents ? '⚠️ YES' : '✅ No';

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background: #059669; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">&#9989; Employment Verification Completed</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">${verificationData.applicantName} — Response Received</p>
        </div>
        <div style="background: white; padding: 24px; border: 1px solid #e2e8f0;">
            <p>Great news! <strong>${verificationData.employerName}</strong> has completed the employment verification for <strong>${verificationData.applicantName}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>Was Employed</strong></td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${wasEmployed}</td></tr>
                <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>Position Held</strong></td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${formResponse.positionHeld || 'N/A'}</td></tr>
                <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>Drug/Alcohol Violations</strong></td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${hadViolations}</td></tr>
                <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>Accidents (3yr)</strong></td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${hadAccidents}</td></tr>
                <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>Respondent</strong></td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${formResponse.respondentName} (${formResponse.respondentTitle})</td></tr>
            </table>
            <p style="font-size: 13px; color: #666;">Full details and PDF have been automatically added to the applicant's DQ file.</p>
        </div>
    </div>`;

    await sendDynamicEmail(verificationData.companyId, adminEmail, `✅ PEV Complete: ${verificationData.applicantName} — ${verificationData.employerName}`, html);
}


// ============================================================
// HELPER: Notify carrier of no-response (good faith documentation)
// ============================================================
async function notifyCarrierNoResponse(verificationData) {
    const companyDoc = await db.collection('companies').doc(verificationData.companyId).get();
    if (!companyDoc.exists) return;

    const companyData = companyDoc.data();
    const adminEmail = companyData.adminEmail || companyData.email;
    if (!adminEmail) return;

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background: #d97706; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">&#9888;&#65039; PEV No Response: Good Faith Effort Documented</h2>
        </div>
        <div style="background: white; padding: 24px; border: 1px solid #e2e8f0;">
            <p>After <strong>30 days</strong> and multiple follow-up attempts, <strong>${verificationData.employerName}</strong> has not responded to the employment verification request for <strong>${verificationData.applicantName}</strong>.</p>
            <p>Per <strong>FMCSA 49 CFR §391.23(j)</strong>, your good-faith effort has been documented. All attempts (initial request + ${verificationData.reminderCount || 0} reminders) have been recorded in the system.</p>
            <p><strong>Recommended next steps:</strong></p>
            <ul>
                <li>Attempt a phone follow-up directly</li>
                <li>Document the phone attempt in the applicant's DQ file</li>
                <li>If still no response, document and file as good-faith effort</li>
            </ul>
        </div>
    </div>`;

    await sendDynamicEmail(verificationData.companyId, adminEmail, `⚠️ PEV No Response (30 days): ${verificationData.applicantName} — ${verificationData.employerName}`, html);
}


// ============================================================
// HELPER: Generate PDF for DQ File
// ============================================================
async function generateVerificationPDF(verificationData, responseData, token) {
    try {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontSize = 10;
        const headerSize = 14;
        const subHeaderSize = 11;

        let page = pdfDoc.addPage([612, 792]); // Letter size
        const { width, height } = page.getSize();
        let y = height - 50;

        const drawText = (text, x, currentY, options = {}) => {
            const f = options.font || font;
            const s = options.size || fontSize;
            const c = options.color || rgb(0.1, 0.1, 0.1);
            page.drawText(text, { x, y: currentY, size: s, font: f, color: c });
        };

        const drawLine = (x1, y1, x2, y2) => {
            page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        };

        // ---- HEADER ----
        drawText('SAFEHAUL COMPLIANCE SERVICES', 50, y, { font: fontBold, size: headerSize });
        y -= 18;
        drawText('Previous Employment Verification — FMCSA 49 CFR §391.23', 50, y, { size: subHeaderSize, color: rgb(0.3, 0.3, 0.6) });
        y -= 12;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- VERIFICATION INFO ----
        drawText('VERIFICATION DETAILS', 50, y, { font: fontBold, size: subHeaderSize });
        y -= 18;

        const fields = [
            ['Applicant Name:', verificationData.applicantName],
            ['Previous Employer:', verificationData.employerName],
            ['Requesting Company:', verificationData.companyName],
            ['Reported Employment Dates:', `${verificationData.employmentStartDate} to ${verificationData.employmentEndDate}`],
            ['Request Date:', verificationData.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || 'N/A'],
            ['Completion Date:', responseData.submittedAt?.toDate?.()?.toISOString?.()?.split('T')[0] || new Date().toISOString().split('T')[0]],
            ['Verification Token:', token],
        ];

        for (const [label, value] of fields) {
            drawText(label, 50, y, { font: fontBold });
            drawText(value || 'N/A', 220, y);
            y -= 16;
        }

        y -= 10;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 1: EMPLOYMENT CONFIRMATION ----
        drawText('SECTION 1: EMPLOYMENT CONFIRMATION', 50, y, { font: fontBold, size: subHeaderSize });
        y -= 18;

        const section1 = [
            ['Was Employed:', responseData.wasEmployed ? 'Yes' : 'No'],
            ['Confirmed Start Date:', responseData.confirmedStartDate || 'N/A'],
            ['Confirmed End Date:', responseData.confirmedEndDate || 'N/A'],
            ['Position Held:', responseData.positionHeld || 'N/A'],
            ['Reason for Leaving:', responseData.reasonForLeaving || 'N/A'],
            ['Eligible for Rehire:', responseData.eligibleForRehire === true ? 'Yes' : responseData.eligibleForRehire === false ? 'No' : 'N/A'],
        ];

        for (const [label, value] of section1) {
            drawText(label, 50, y, { font: fontBold });
            drawText(value, 220, y);
            y -= 16;
        }

        y -= 10;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 2: SAFETY & COMPLIANCE ----
        drawText('SECTION 2: SAFETY & COMPLIANCE (FMCSA REQUIRED)', 50, y, { font: fontBold, size: subHeaderSize });
        y -= 18;

        const section2 = [
            ['Subject to FMCSRs:', responseData.subjectToFmcsrs ? 'Yes' : 'No'],
            ['Subject to DOT Testing:', responseData.subjectToDotTesting ? 'Yes' : 'No'],
            ['Drug/Alcohol Violations:', responseData.hadDrugAlcoholViolations ? 'YES' : 'No'],
        ];

        for (const [label, value] of section2) {
            const textColor = value === 'YES' ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.1, 0.1);
            drawText(label, 50, y, { font: fontBold });
            drawText(value, 220, y, { color: textColor });
            y -= 16;
        }

        if (responseData.violationDetails) {
            drawText('Violation Details:', 50, y, { font: fontBold });
            y -= 14;
            // Wrap long text
            const words = responseData.violationDetails.split(' ');
            let line = '';
            for (const word of words) {
                if (font.widthOfTextAtSize(line + ' ' + word, fontSize) > width - 120) {
                    drawText(line, 70, y);
                    y -= 14;
                    line = word;
                } else {
                    line = line ? line + ' ' + word : word;
                }
            }
            if (line) { drawText(line, 70, y); y -= 14; }
            y -= 4;
        }

        if (responseData.completedReturnToDuty) {
            drawText('Return-to-Duty Completed:', 50, y, { font: fontBold });
            drawText(responseData.completedReturnToDuty, 220, y);
            y -= 16;
        }

        y -= 6;
        const accidentFields = [
            ['DOT-Recordable Accidents:', responseData.hadAccidents ? 'YES' : 'No'],
        ];
        for (const [label, value] of accidentFields) {
            const textColor = value === 'YES' ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.1, 0.1);
            drawText(label, 50, y, { font: fontBold });
            drawText(value, 220, y, { color: textColor });
            y -= 16;
        }

        if (responseData.accidentDetails) {
            drawText('Accident Details:', 50, y, { font: fontBold });
            y -= 14;
            const words = responseData.accidentDetails.split(' ');
            let line = '';
            for (const word of words) {
                if (font.widthOfTextAtSize(line + ' ' + word, fontSize) > width - 120) {
                    drawText(line, 70, y);
                    y -= 14;
                    line = word;
                } else {
                    line = line ? line + ' ' + word : word;
                }
            }
            if (line) { drawText(line, 70, y); y -= 14; }
        }

        y -= 10;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // Check if we need a new page
        if (y < 200) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 50;
        }

        // ---- SECTION 3: RESPONDENT VERIFICATION ----
        drawText('SECTION 3: RESPONDENT VERIFICATION & SIGNATURE', 50, y, { font: fontBold, size: subHeaderSize });
        y -= 18;

        const section3 = [
            ['Respondent Name:', responseData.respondentName],
            ['Respondent Title:', responseData.respondentTitle],
            ['Respondent Phone:', responseData.respondentPhone],
            ['Respondent Email:', responseData.respondentEmail || 'N/A'],
            ['IP Address:', responseData.ipAddress || 'N/A'],
            ['Submission Date:', responseData.submittedAt?.toDate?.()?.toISOString?.() || new Date().toISOString()],
        ];

        for (const [label, value] of section3) {
            drawText(label, 50, y, { font: fontBold });
            drawText(value || 'N/A', 220, y);
            y -= 16;
        }

        // Embed signature if available
        if (responseData.signaturePath) {
            y -= 10;
            drawText('Electronic Signature:', 50, y, { font: fontBold });
            y -= 6;

            try {
                const bucket = storage.bucket();
                const [buffer] = await bucket.file(responseData.signaturePath).download();
                const sigImage = await pdfDoc.embedPng(buffer);
                const sigDims = sigImage.scale(0.3);
                page.drawImage(sigImage, {
                    x: 50,
                    y: y - sigDims.height,
                    width: sigDims.width,
                    height: sigDims.height,
                });
                y -= sigDims.height + 10;
            } catch (sigError) {
                drawText('[Signature on file in Cloud Storage]', 50, y - 14);
                y -= 24;
            }
        }

        y -= 20;
        drawLine(50, y, width - 50, y);
        y -= 16;

        // ---- FOOTER ----
        drawText('This document was electronically generated by SafeHaul Compliance Services.', 50, y, { size: 8, color: rgb(0.5, 0.5, 0.5) });
        y -= 12;
        drawText(`Verification ID: ${token} | Generated: ${new Date().toISOString()}`, 50, y, { size: 8, color: rgb(0.5, 0.5, 0.5) });

        // Save PDF to Cloud Storage
        const pdfBytes = await pdfDoc.save();
        const pdfPath = `companies/${verificationData.companyId}/${verificationData.collectionName}/${verificationData.applicationId}/pev_results/PEV_${verificationData.employerName.replace(/[^a-zA-Z0-9]/g, '_')}_${token.slice(0, 8)}.pdf`;

        const bucket = storage.bucket();
        const file = bucket.file(pdfPath);
        await file.save(Buffer.from(pdfBytes), {
            metadata: { contentType: 'application/pdf' },
        });

        // Generate signed URL (valid for 7 days)
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        // Also store the storage path in the verification request for permanent reference
        await db.collection('verification_requests').doc(token).update({
            pdfPath,
            pdfUrl: url,
        });

        logger.info(`[PEV] PDF generated: ${pdfPath}`);
        return url;

    } catch (error) {
        logger.error('[PEV] PDF generation error:', error);
        throw error;
    }
}
