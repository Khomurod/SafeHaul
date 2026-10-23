/**
 * Employment Verification — PDF generation
 * ========================================
 * Extracted verbatim from employmentVerification.js.
 */

const { db, storage } = require("../firebaseAdmin");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const { logger } = require("firebase-functions");
const { sanitizeForStandardFont, wrapText } = require("../shared/pdf/layout");

// Nothing is drawn below this line; the next row starts a new page instead.
const BOTTOM_MARGIN = 50;

/**
 * A yes/no answer as the record must state it. The portal requires these
 * questions, but the server stores what arrives (`?? null`), and a missing
 * answer printed as "No" would put a statement on the record that the
 * employer never made.
 */
function answer(value, yes = 'Yes') {
    if (value === true) return yes;
    if (value === false) return 'No';
    return 'Not answered';
}

/** The portal's return-to-duty choices as the record states them. */
const RETURN_TO_DUTY = { yes: 'Yes', no: 'No', in_progress: 'In progress' };

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
        const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
        const fontSize = 10;
        const headerSize = 14;
        const subHeaderSize = 11;

        let page = pdfDoc.addPage([612, 792]); // Letter size
        const { width, height } = page.getSize();
        let y = height - 50;

        // The standard fonts encode WinAnsi only, and pdf-lib throws on anything
        // else, a newline included: one such character in an answer used to
        // abort the whole document. Every string is drawn sanitized, on one line.
        const drawText = (text, x, currentY, options = {}) => {
            const f = options.font || font;
            const s = options.size || fontSize;
            const c = options.color || rgb(0.1, 0.1, 0.1);
            const line = sanitizeForStandardFont(text).replace(/\n/g, ' ');
            page.drawText(line, { x, y: currentY, size: s, font: f, color: c });
        };

        // Room for `needed` points below the cursor, or a fresh page.
        const ensureSpace = (needed) => {
            if (y - needed >= BOTTOM_MARGIN) return;
            page = pdfDoc.addPage([612, 792]);
            y = height - 50;
        };

        // A label and its value; a long value wraps in its column, onto the
        // next page if it must.
        const VALUE_X = 220;
        const drawRow = (label, value, options = {}) => {
            const lines = wrapText(value ?? 'N/A', { font, size: fontSize, maxWidth: width - 50 - VALUE_X });
            ensureSpace(16);
            drawText(label, 50, y, { font: fontBold });
            lines.forEach((line, i) => {
                if (i > 0) {
                    y -= 14;
                    ensureSpace(16);
                }
                drawText(line, VALUE_X, y, options);
            });
            y -= 16;
        };

        // Free text under its label, wrapped to the page and continued on the next.
        const drawParagraph = (label, text) => {
            ensureSpace(28);
            drawText(label, 50, y, { font: fontBold });
            y -= 14;
            for (const line of wrapText(text, { font, size: fontSize, maxWidth: width - 120 })) {
                ensureSpace(14);
                drawText(line, 70, y);
                y -= 14;
            }
        };

        const drawSectionTitle = (title) => {
            ensureSpace(42);
            drawText(title, 50, y, { font: fontBold, size: subHeaderSize });
            y -= 18;
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
        drawSectionTitle('VERIFICATION DETAILS');

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
            drawRow(label, value || 'N/A');
        }

        y -= 10;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 1: EMPLOYMENT CONFIRMATION ----
        drawSectionTitle('SECTION 1: EMPLOYMENT CONFIRMATION');

        const section1 = [
            ['Was Employed:', answer(responseData.wasEmployed)],
            ['Confirmed Start Date:', responseData.confirmedStartDate || 'N/A'],
            ['Confirmed End Date:', responseData.confirmedEndDate || 'N/A'],
            ['Position Held:', responseData.positionHeld || 'N/A'],
            ['Reason for Leaving:', responseData.reasonForLeaving || 'N/A'],
            ['Eligible for Rehire:', answer(responseData.eligibleForRehire)],
        ];

        for (const [label, value] of section1) {
            drawRow(label, value);
        }
        if (responseData.rehireExplanation) {
            drawParagraph('Rehire Explanation:', responseData.rehireExplanation);
        }

        y -= 10;
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 2: SAFETY & COMPLIANCE ----
        drawSectionTitle('SECTION 2: SAFETY & COMPLIANCE (FMCSA REQUIRED)');

        const flagged = (value) => (value === 'YES' ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.1, 0.1));
        const section2 = [
            ['Subject to FMCSRs:', answer(responseData.subjectToFmcsrs)],
            ['Subject to DOT Testing:', answer(responseData.subjectToDotTesting)],
            ['Drug/Alcohol Violations:', answer(responseData.hadDrugAlcoholViolations, 'YES')],
        ];

        for (const [label, value] of section2) {
            drawRow(label, value, { color: flagged(value) });
        }

        if (responseData.violationDetails) {
            drawParagraph('Violation Details:', responseData.violationDetails);
            y -= 4;
        }

        if (responseData.completedReturnToDuty) {
            drawRow('Return-to-Duty Completed:', RETURN_TO_DUTY[responseData.completedReturnToDuty] || responseData.completedReturnToDuty);
        }
        if (responseData.followUpTestingPlan) {
            drawParagraph('Follow-up Testing Plan:', responseData.followUpTestingPlan);
        }

        y -= 6;
        const accidents = answer(responseData.hadAccidents, 'YES');
        drawRow('DOT-Recordable Accidents:', accidents, { color: flagged(accidents) });

        if (responseData.accidentDetails) {
            drawParagraph('Accident Details:', responseData.accidentDetails);
        }

        // Asked as an optional question; a response without an answer prints nothing.
        if (typeof responseData.hadNonRecordableAccidents === 'boolean') {
            y -= 6;
            const otherAccidents = answer(responseData.hadNonRecordableAccidents, 'YES');
            drawRow('Non-Recordable Accidents:', otherAccidents, { color: flagged(otherAccidents) });
        }
        if (responseData.nonRecordableAccidentDetails) {
            drawParagraph('Non-Recordable Accident Details:', responseData.nonRecordableAccidentDetails);
        }

        y -= 10;
        ensureSpace(24);
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 3: ADDITIONAL INFORMATION ----
        // The portal's own Section 3; the comments were collected and stored
        // but never printed.
        drawSectionTitle('SECTION 3: ADDITIONAL INFORMATION');
        drawParagraph('Additional Comments:', responseData.additionalComments || 'None');

        y -= 10;
        ensureSpace(24);
        drawLine(50, y, width - 50, y);
        y -= 24;

        // ---- SECTION 4: RESPONDENT VERIFICATION ----
        drawSectionTitle('SECTION 4: RESPONDENT VERIFICATION & SIGNATURE');

        const section3 = [
            ['Respondent Name:', responseData.respondentName],
            ['Respondent Title:', responseData.respondentTitle],
            ['Respondent Phone:', responseData.respondentPhone],
            ['Respondent Email:', responseData.respondentEmail || 'N/A'],
            ['IP Address:', responseData.ipAddress || 'N/A'],
            ['Submission Date:', responseData.submittedAt?.toDate?.()?.toISOString?.() || new Date().toISOString()],
        ];

        for (const [label, value] of section3) {
            drawRow(label, value || 'N/A');
        }

        // ---- SIGNATURE ----
        // A typed mark is the name the respondent adopted as their signature
        // (ESIGN, 15 U.S.C. §7006(5)), set in an oblique face so the page reads
        // as signed rather than merely filled in; a drawn mark is the PNG saved
        // to Cloud Storage by responses.js. Both carry the method in the label.
        if (responseData.signatureText) {
            y -= 10;
            ensureSpace(60);
            drawText('Electronic Signature (typed):', 50, y, { font: fontBold });
            y -= 22;
            drawText(responseData.signatureText, 50, y, { font: fontOblique, size: 16 });
            y -= 14;
            drawText('Typed by the respondent and adopted as their signature.', 50, y, { size: 8, color: rgb(0.5, 0.5, 0.5) });
            y -= 10;
        } else if (responseData.signaturePath) {
            y -= 10;
            // Loaded before anything is drawn, so the label and the mark land on
            // the same page.
            let sigImage = null;
            try {
                const bucket = storage.bucket();
                const [buffer] = await bucket.file(responseData.signaturePath).download();
                sigImage = await pdfDoc.embedPng(buffer);
            } catch (sigError) {
                sigImage = null;
            }
            const sigDims = sigImage ? sigImage.scale(0.3) : null;
            ensureSpace(6 + (sigDims ? sigDims.height + 10 : 24));
            drawText('Electronic Signature (drawn):', 50, y, { font: fontBold });
            y -= 6;

            if (sigImage) {
                page.drawImage(sigImage, {
                    x: 50,
                    y: y - sigDims.height,
                    width: sigDims.width,
                    height: sigDims.height,
                });
                y -= sigDims.height + 10;
            } else {
                drawText('[Signature on file in Cloud Storage]', 50, y - 14);
                y -= 24;
            }
        }

        y -= 20;
        ensureSpace(44);
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
