/**
 * Employment Verification — Email HTML builders
 * =============================================
 * Pure template functions extracted from employmentVerification.js.
 * These return HTML strings only; sending is done by the callers.
 */

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
        <img src="${baseUrl}/api/verification/track-open?t=${token}" width="1" height="1" style="display:none;" alt="" />
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
// HELPER: Build carrier "verification complete" notification HTML
// ============================================================
function buildCarrierCompleteEmailHTML(verificationData, formResponse) {
    const wasEmployed = formResponse.wasEmployed ? 'Yes' : 'No';
    const hadViolations = formResponse.hadDrugAlcoholViolations ? '⚠️ YES' : '✅ No';
    const hadAccidents = formResponse.hadAccidents ? '⚠️ YES' : '✅ No';

    return `
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
}

// ============================================================
// HELPER: Build carrier "no response" (good faith) notification HTML
// ============================================================
function buildCarrierNoResponseEmailHTML(verificationData) {
    return `
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
}

module.exports = {
    buildVerificationEmailHTML,
    buildReminderEmailHTML,
    buildCarrierCompleteEmailHTML,
    buildCarrierNoResponseEmailHTML,
};
