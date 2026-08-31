// functions/shared/pdf/applicationDocument.js
//
// Renders THE driver application PDF from a preserved submission snapshot.
//
// WHAT THIS REPLACES
// ------------------
// The browser-side jsPDF generator, which:
//   * read live, mutable application data, so the "original" changed whenever a
//     company edited a question, a company detail or an applicant's record;
//   * printed custom questions by iterating the ANSWER map and using each key as
//     the label — and those keys are ids, which is how UUIDs reached recruiters;
//   * carried its own copy of the legal text, so editing the wording rewrote
//     every historical document;
//   * stamped the same signature block onto all four agreement pages regardless
//     of what was presented or accepted;
//   * printed "Fatalities: 0" and "Injuries: 0" on every accident, which nobody
//     was ever asked;
//   * regenerated from scratch on every download, so no two downloads of "the
//     original" were guaranteed to match.
//
// THE RULES THIS FILE ENFORCES
//   1. Everything printed comes from the snapshot. There is no second source.
//   2. Nothing is invented. A blank answer prints as "Not provided"; it is never
//      filled in, and it is never turned into a zero.
//   3. A question the driver was never shown does not appear.
//   4. No internal identifier is printed. Field ids, question ids, application
//      ids and storage paths are all withheld; an uploaded file is named by its
//      filename. A custom question with no recorded wording says so.
//   5. A signature appears against an agreement only where that agreement itself
//      carries acceptance evidence.
//   6. Agreement text is the verbatim wording the snapshot froze, never
//      regenerated from the current registry.

const {
    DocumentBuilder,
    INK,
} = require('./documentBuilder');
const { currentRepeatingColumns } = require('../submissionSnapshot');

const {
    NOT_PROVIDED,
    NONE_RECORDED,
    WORDING_UNAVAILABLE,
    clean,
    formatInstant,
    formatDay,
    formatMonth,
    singularize,
    pluralMonths,
    maskSsn,
    applicantNameFrom,
} = require('./applicationText');
const {
    drawCompanyHeader,
    drawTitleBlock,
    drawSubmissionBand,
    drawProvenance,
    drawSection,
    drawCoverage,
    drawCustomQuestions,
} = require('./applicationSections');
const { embedSignature, drawAgreement } = require('./applicationAgreements');

/**
 * Build the application PDF.
 *
 * @param {object} opts
 * @param {object} opts.snapshot          A preserved submission snapshot.
 * @param {boolean} [opts.includeFullSsn] Authorized ORIGINAL only. Default false.
 * @param {string} [opts.signatureImage]  `data:image/png;base64,...`
 * @param {number} [opts.sequence]        Snapshot sequence; 1 is the original.
 * @param {string} [opts.generatedAt]     ISO instant, stamped in the footer.
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, applicantName: string}>}
 */
async function renderApplicationPdf({
    snapshot,
    includeFullSsn = false,
    signatureImage = null,
    sequence = 1,
    generatedAt = null,
} = {}) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.sections)) {
        throw new Error('renderApplicationPdf requires a preserved submission snapshot');
    }

    const doc = await DocumentBuilder.create();
    const applicantName = applicantNameFrom(snapshot);
    const isOriginal = Number(sequence) === 1;
    const companyName = clean(snapshot.company?.companyName) || 'Company name not recorded';

    doc.runningHeader = `${applicantName}  ·  ${companyName}  ·  Driver Application for Employment`;
    doc.footerLeft = applicantName;
    doc.footerCenter = isOriginal
        ? `Original submission preserved ${formatDay(snapshot.submittedAt) || 'date not recorded'}`
        : `Resubmission #${sequence} preserved ${formatDay(snapshot.submittedAt) || 'date not recorded'}`;

    const headerTop = doc.y;
    drawCompanyHeader(doc, snapshot.company);
    drawTitleBlock(doc, headerTop);
    doc.moveDown(4);
    doc.rule({ color: INK.ACCENT, thickness: 1.2 });

    drawSubmissionBand(doc, snapshot, { sequence, isOriginal });
    drawProvenance(doc, snapshot);

    const columnsById = currentRepeatingColumns();
    for (const section of snapshot.sections || []) {
        drawSection(doc, section, { includeFullSsn, columnsById });
    }

    drawCoverage(doc, snapshot);
    drawCustomQuestions(doc, snapshot);

    const signature = await embedSignature(doc.pdfDoc, signatureImage);
    const agreements = Array.isArray(snapshot.agreements) ? snapshot.agreements : [];
    agreements.forEach((agreement, index) => {
        drawAgreement(doc, agreement, {
            signatureImage: signature,
            applicantName,
            index: index + 1,
            total: agreements.length,
        });
    });

    // A closing note about the document itself, so a reader knows what they hold.
    doc.addPage();
    doc.sectionHeading('About this document');
    doc.paragraph(
        isOriginal
            ? 'This is the preserved ORIGINAL of the application as submitted. It was generated once, '
              + 'from the record frozen at submission, and stored. Later changes to the company\'s '
              + 'questions, company details, legal wording or the applicant\'s record do not alter it.'
            : `This is preserved resubmission #${sequence}. The original submission is preserved `
              + 'separately and is unaffected by it.',
    );
    doc.moveDown(6);
    doc.fieldGrid([
        { label: 'Applicant', value: applicantName },
        { label: 'Company', value: companyName },
        { label: 'Submitted', value: formatInstant(snapshot.submittedAt) || 'Not recorded' },
        { label: 'Document generated', value: formatInstant(generatedAt) || formatInstant(new Date().toISOString()) },
        { label: 'Record type', value: snapshot.provenance?.source === 'reconstructed' ? 'Reconstructed' : 'Captured at submission' },
        { label: 'Social Security Number', value: includeFullSsn ? 'Shown in full (authorized original)' : 'Masked to last four digits' },
    ]);

    // Document metadata, set explicitly rather than left to default to "now".
    // Two consequences, both wanted: a viewer shows a real title instead of a
    // storage object name, and rendering the same snapshot twice produces
    // byte-identical output — so a rebuilt historical document can be compared
    // against a preserved one rather than merely eyeballed.
    const stamp = new Date(clean(generatedAt) || snapshot.submittedAt || 0);
    const stamped = Number.isNaN(stamp.getTime()) ? new Date(0) : stamp;
    doc.pdfDoc.setTitle(`Driver Application for Employment — ${applicantName}`);
    doc.pdfDoc.setSubject(`Application submitted to ${companyName}`);
    doc.pdfDoc.setProducer('SafeHaul');
    doc.pdfDoc.setCreator('SafeHaul');
    doc.pdfDoc.setCreationDate(stamped);
    doc.pdfDoc.setModificationDate(stamped);

    const bytes = await doc.save();
    return { bytes, pageCount: doc.pages.length, applicantName };
}

module.exports = {
    NONE_RECORDED,
    formatMonth,
    pluralMonths,
    singularize,
    NOT_PROVIDED,
    WORDING_UNAVAILABLE,
    applicantNameFrom,
    formatDay,
    formatInstant,
    maskSsn,
    renderApplicationPdf,
};
