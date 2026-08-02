/**
 * Employment Verification — PDF generation
 * ========================================
 * Extracted verbatim from employmentVerification.js.
 */

const { db, storage } = require("../firebaseAdmin");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const { logger } = require("firebase-functions");

// ============================================================
// HELPER: Generate PDF for DQ File
// ============================================================
/**
 * Generate the PEV completion PDF and upload to Cloud Storage.
 * PEV-BRK-3 FIX: Returns the permanent Cloud Storage path (e.g. `companies/.../pev_results/PEV_...pdf`)
 * NOT a signed URL. Signed URLs are generated on demand when viewing; storing them would expire in 7
 * days while FMCSA 49 CFR 391.51 requires 3-year DQ file retention.
 *
 * @param {object} verificationData - The verification_request Firestore document data
 * @param {object} responseData     - The submitted response data from the employer
 * @param {string} token            - The verification request token (used for naming the PDF)
 * @returns {Promise<string>}       - The permanent Cloud Storage path of the generated PDF
 */
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

                // PEV-BRK-3 FIX: Store only the pdfPath (permanent Cloud Storage path) rather than a
        // 7-day expiring signed URL. The signed URL would break after 7 days, but FMCSA 49 CFR 391.51
        // requires DQ file retention for 3 years. Generate fresh signed URLs on demand when viewing.
        await db.collection('verification_requests').doc(token).update({
            pdfPath,
        });

        logger.info(`[PEV] PDF generated: ${pdfPath}`);
        return pdfPath;

    } catch (error) {
        logger.error('[PEV] PDF generation error:', error);
        throw error;
    }
}

module.exports = { generateVerificationPDF };
