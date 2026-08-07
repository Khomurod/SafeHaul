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
    CONTENT_WIDTH,
    DocumentBuilder,
    INK,
    MARGIN,
    TYPE,
} = require('./documentBuilder');
const { currentRepeatingColumns, resolveRepeatingRows } = require('../submissionSnapshot');

/** Printed where a presented question was left blank. */
const NOT_PROVIDED = 'Not provided';

/** Printed where a repeating section has no records. */
const NONE_RECORDED = 'None recorded.';

/** Printed for a custom question whose wording was never recorded. */
const WORDING_UNAVAILABLE = 'Question wording was not recorded';

function clean(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** ISO instant → "March 14, 2026 at 09:07 UTC". Times are stated in UTC. */
function formatInstant(iso) {
    const raw = clean(iso);
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hh}:${mm} UTC`;
}

/** ISO instant → "March 14, 2026". */
function formatDay(iso) {
    const instant = formatInstant(iso);
    return instant ? instant.split(' at ')[0] : null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM` → "March 2026". Coverage gaps are month-granular. */
function formatMonth(value) {
    const raw = clean(value);
    if (!raw) return null;
    const match = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!match) return raw;
    const month = MONTH_NAMES[Number(match[2]) - 1];
    return month ? `${month} ${match[1]}` : raw;
}

/**
 * Turn a plural group label into the singular used to number one record.
 *
 * "Previous Addresses" → "Previous Address", "Additional Licences" →
 * "Additional Licence", "Military Service" → unchanged. A bare `s`-strip gave
 * "Previous Addresse 1".
 */
function singularize(label) {
    const text = clean(label) || '';
    if (/sses$/.test(text)) return text.slice(0, -2);
    if (/ies$/.test(text)) return `${text.slice(0, -3)}y`;
    if (/[^s]s$/.test(text)) return text.slice(0, -1);
    return text;
}

/** "1 month" / "3 months", with a verb that agrees. */
function pluralMonths(count) {
    return count === 1 ? '1 month is' : `${count} months are`;
}

/**
 * Mask a Social Security Number to its last four digits.
 *
 * Used everywhere the full number is not authorized. The masked form keeps the
 * last four because that is what a recruiter matches against, and reveals
 * nothing more.
 */
function maskSsn(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return null;
    return `***-**-${digits.slice(-4)}`;
}

/**
 * The applicant's name, from the snapshot's own personal section.
 *
 * Deliberately not taken from the application document: the PDF must describe
 * the submission, and the application document is mutable.
 */
function applicantNameFrom(snapshot) {
    const answers = new Map();
    for (const section of snapshot?.sections || []) {
        for (const answer of section.answers || []) answers.set(answer.fieldId, answer);
    }
    const part = (id) => clean(answers.get(id)?.displayValue);
    const name = [part('firstName'), part('middleName'), part('lastName'), part('suffix')]
        .filter(Boolean)
        .join(' ');
    return name || 'Applicant name not recorded';
}

/** The value to print for one scalar answer, honouring the SSN policy. */
function scalarValue(answer, { includeFullSsn }) {
    if (answer.sensitive && answer.fieldId === 'ssn') {
        const raw = answer.value ?? answer.displayValue;
        if (!clean(raw)) return null;
        return includeFullSsn ? String(raw).trim() : maskSsn(raw);
    }
    return clean(answer.displayValue);
}

/** Company identity block, top-left of page one. */
function drawCompanyHeader(doc, company) {
    const name = clean(company?.companyName) || 'Company name not recorded';

    doc.line(name, { size: TYPE.COMPANY, font: doc.font.bold, width: CONTENT_WIDTH * 0.62 });

    const dba = clean(company?.dba);
    if (dba) doc.line(`d/b/a ${dba}`, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const address = company?.address || {};
    const street = clean(address.street);
    const locality = [clean(address.city), clean(address.state)].filter(Boolean).join(', ');
    const cityLine = [locality, clean(address.zip)].filter(Boolean).join(' ');
    if (street) doc.line(street, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });
    if (cityLine) doc.line(cityLine, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const contact = company?.contact || {};
    const contactLine = [clean(contact.phone), clean(contact.email)].filter(Boolean).join('  ·  ');
    if (contactLine) doc.line(contactLine, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });

    const registration = [
        clean(company?.dotNumber) ? `USDOT ${clean(company.dotNumber)}` : null,
        clean(company?.mcNumber) ? `MC ${clean(company.mcNumber)}` : null,
    ].filter(Boolean).join('  ·  ');
    if (registration) doc.line(registration, { size: TYPE.BODY, color: INK.MUTED, width: CONTENT_WIDTH * 0.62 });
}

/**
 * The title block, right-aligned against the company block.
 *
 * Drawn at a fixed y rather than through the cursor, because it sits beside the
 * company details rather than after them.
 */
function drawTitleBlock(doc, topY) {
    const savedY = doc.y;
    doc.y = topY;
    const width = CONTENT_WIDTH * 0.36;
    const x = MARGIN.LEFT + CONTENT_WIDTH - width;

    doc.line('DRIVER APPLICATION', { x, width, align: 'right', size: TYPE.TITLE, font: doc.font.bold });
    doc.line('FOR EMPLOYMENT', { x, width, align: 'right', size: TYPE.TITLE, font: doc.font.bold });
    doc.moveDown(3);
    doc.line('49 CFR Part 391, Subpart C', {
        x, width, align: 'right', size: TYPE.SMALL, color: INK.MUTED,
    });
    doc.y = savedY;
}

/** Submission metadata band under the header. */
function drawSubmissionBand(doc, snapshot, { sequence, isOriginal }) {
    const submitted = formatInstant(snapshot.submittedAt);
    const entries = [
        ['Submitted', submitted || 'Not recorded'],
        ['Record', isOriginal ? 'Original submission' : `Resubmission #${sequence}`],
    ];
    if (clean(snapshot.agreementVersion)) {
        entries.push(['Agreement set', clean(snapshot.agreementVersion)]);
    }

    doc.moveDown(6);
    doc.page.drawRectangle({
        x: MARGIN.LEFT, y: doc.y - 22, width: CONTENT_WIDTH, height: 26, color: INK.BAND,
    });
    doc.moveDown(2);

    const cellWidth = CONTENT_WIDTH / entries.length;
    const savedY = doc.y;
    entries.forEach(([label, value], index) => {
        doc.y = savedY;
        const x = MARGIN.LEFT + 10 + index * cellWidth;
        doc.line(label.toUpperCase(), {
            x, width: cellWidth - 12, size: 6.5, font: doc.font.bold, color: INK.MUTED, leading: 1.4,
        });
        doc.line(value, { x, width: cellWidth - 12, size: TYPE.SMALL, leading: 1.2 });
    });
    doc.y = savedY - 24;
}

/** Provenance caveats, stated plainly rather than implied. */
function drawProvenance(doc, snapshot) {
    const provenance = snapshot.provenance || {};
    if (provenance.source !== 'reconstructed') return;

    doc.moveDown(6);
    doc.page.drawRectangle({
        x: MARGIN.LEFT, y: doc.y - 4, width: 2.5, height: 4, color: INK.WARNING,
    });
    doc.line('RECONSTRUCTED RECORD', {
        x: MARGIN.LEFT + 9, size: TYPE.LABEL, font: doc.font.bold, color: INK.WARNING,
    });
    doc.paragraph(
        'This application was submitted before submissions were preserved. The record below was '
        + 'rebuilt from the evidence that survives. Where something could not be recovered it is '
        + 'stated as such and has not been reconstructed from present-day settings.',
        { x: MARGIN.LEFT + 9, width: CONTENT_WIDTH - 9, size: TYPE.SMALL, color: INK.MUTED, font: doc.font.italic },
    );
    for (const note of provenance.notes || []) {
        doc.paragraph(`• ${note}`, {
            x: MARGIN.LEFT + 9, width: CONTENT_WIDTH - 9, size: TYPE.SMALL, color: INK.MUTED, font: doc.font.italic,
        });
    }
    doc.moveDown(4);
}

/** One answer section: scalars in a grid, repeating groups as record blocks. */
function drawSection(doc, section, { includeFullSsn, columnsById }) {
    const answers = (section.answers || []).filter((answer) => answer.presented !== false);
    if (answers.length === 0) return;

    const scalars = answers.filter((answer) => !answer.repeating);
    const groups = answers.filter((answer) => answer.repeating);

    // A section whose every scalar is blank and whose every group is empty still
    // gets its heading: "we asked, nothing came back" is information.
    //
    // A section that opens with a repeating group reserves room for its first
    // record, not the two rows a scalar grid needs — otherwise "EDUCATION &
    // MILITARY" lands alone at the foot of a page with its schools overleaf.
    const firstRows = groups[0] && Array.isArray(groups[0].rows) ? groups[0].rows : null;
    doc.sectionHeading(section.title, {
        keepWith: scalars.length > 0
            ? 62
            : (firstRows && firstRows.length
                ? Math.min(doc.measureRecordBlock(firstRows[0]) + 34, 420)
                : 40),
    });

    if (scalars.length > 0) {
        doc.fieldGrid(scalars.map((answer) => {
            const value = scalarValue(answer, { includeFullSsn });
            return {
                label: answer.label,
                value: value || NOT_PROVIDED,
                muted: !value,
            };
        }));
    }

    for (const group of groups) {
        const { rows, usedCurrentColumns } = resolveRepeatingRows(group, columnsById);
        // Keep the group label with its first record, measured rather than
        // guessed: a fifteen-field employer block is three times the height of a
        // four-field violation, and a fixed reserve orphans one or wastes a
        // third of a page on the other. Capped so a record taller than a page
        // cannot force an endless break.
        doc.subheading(group.label, {
            keepWith: rows.length ? Math.min(doc.measureRecordBlock(rows[0]) + 10, 420) : 24,
        });
        if (rows.length === 0) {
            doc.note(NONE_RECORDED);
            continue;
        }
        if (usedCurrentColumns) {
            doc.note(
                'This record predates stored field names, so these entries are laid out under '
                + 'the application\'s current ones. The applicant\'s answers are unchanged.',
            );
        }
        const singular = singularize(group.label);
        rows.forEach((cells, index) => {
            doc.recordBlock(`${singular} ${index + 1} of ${rows.length}`, cells);
        });
    }
}

/**
 * Three-year employment coverage, stated as a fact about the record rather than
 * a judgement about the applicant.
 */
function drawCoverage(doc, snapshot) {
    const coverage = snapshot.employmentCoverage;
    if (!coverage) return;

    doc.sectionHeading('Employment History Coverage');

    if (coverage.isComplete) {
        doc.paragraph(
            `The employment, unemployment, schooling and military records above account for the `
            + `full ${coverage.requiredMonths} months of history required by 49 CFR 391.21(b)(10).`,
        );
    } else {
        doc.paragraph(
            `The records above account for ${coverage.coveredMonths} of the ${coverage.requiredMonths} `
            + `months of history required by 49 CFR 391.21(b)(10). `
            + `${pluralMonths(coverage.missingMonths)} unaccounted for.`,
        );
        const gaps = Array.isArray(coverage.gaps) ? coverage.gaps : [];
        if (gaps.length > 0) {
            doc.moveDown(4);
            doc.subheading('Unaccounted periods');
            for (const gap of gaps) {
                const from = formatMonth(gap.fromMonth);
                const to = formatMonth(gap.toMonth);
                if (!from && !to) continue;
                const span = from === to ? from : `${from || 'unknown'} to ${to || 'unknown'}`;
                const length = Number.isFinite(gap.months)
                    ? ` (${gap.months} month${gap.months === 1 ? '' : 's'})`
                    : '';
                doc.paragraph(`• ${span}${length}`, { size: TYPE.BODY });
            }
        }
        doc.moveDown(4);
        doc.note(
            'The applicant was shown this shortfall before submitting and chose to continue. '
            + 'The gap is recorded here rather than filled in.',
        );
    }
}

/**
 * Company-authored questions, printed with their HUMAN wording.
 *
 * The old generator iterated the answer map and used each key as the label,
 * which put question UUIDs in front of recruiters under this exact heading.
 */
function drawCustomQuestions(doc, snapshot) {
    const answers = Array.isArray(snapshot.customAnswers) ? snapshot.customAnswers : [];
    if (answers.length === 0) return;

    doc.sectionHeading('Supplemental Questions');

    for (const answer of answers) {
        const value = clean(answer.displayValue);
        doc.ensure(34);
        doc.moveDown(2);

        if (answer.labelMissing) {
            doc.line(WORDING_UNAVAILABLE, {
                size: TYPE.SUBHEADING, font: doc.font.italic, color: INK.MUTED,
            });
        } else {
            doc.paragraph(answer.label, { size: TYPE.SUBHEADING, font: doc.font.bold });
        }

        if (answer.unknownQuestion) {
            doc.note(
                'This answer no longer matches a question on the company\'s application. '
                + 'It is kept because the applicant gave it.',
            );
        }

        if (value) {
            doc.paragraph(value);
        } else {
            doc.paragraph(NOT_PROVIDED, { font: doc.font.italic, color: INK.MUTED });
        }
        doc.moveDown(4);
    }
}

/** Embed the signature bitmap, returning its pdf-lib image or null. */
async function embedSignature(pdfDoc, signatureImage) {
    const raw = clean(signatureImage);
    if (!raw) return null;

    const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(raw);
    if (!match) return null;
    const bytes = Buffer.from(match[2], 'base64');
    try {
        return match[1].toLowerCase() === 'png'
            ? await pdfDoc.embedPng(bytes)
            : await pdfDoc.embedJpg(bytes);
    } catch {
        // A corrupt bitmap must not cost the whole document; the acceptance
        // evidence below still stands on its own.
        return null;
    }
}

/**
 * One agreement page: the exact wording presented, then that agreement's own
 * acceptance evidence, then — only where acceptance is recorded — the signature.
 */
function drawAgreement(doc, agreement, { signatureImage, applicantName, index, total }) {
    doc.addPage();

    doc.line(`AGREEMENT ${index} OF ${total}  ·  VERSION ${agreement.version}`, {
        size: TYPE.SMALL, font: doc.font.bold, color: INK.MUTED,
    });
    doc.moveDown(4);

    // The frozen body opens with its own title. Styling that first line as the
    // heading prints the preserved text exactly once, with hierarchy — printing
    // the registry title above it as well repeated the same words twice, and
    // deleting the line would mean the page no longer showed what was presented.
    const bodyLines = String(agreement.body || '').split('\n');
    const opener = bodyLines[0]?.trim() || '';
    const openerIsTitle = opener.length > 0 && opener.length <= 90 && !/[.]$/.test(opener);

    // `paragraph`, not `line`: the PSP disclosure's title is 77 characters and
    // ran off the right margin when drawn as a single unwrapped line.
    doc.paragraph(openerIsTitle ? opener : agreement.title, {
        size: TYPE.SECTION + 1.5, font: doc.font.bold, leading: 1.25,
    });
    doc.moveDown(3);
    doc.rule({ color: INK.ACCENT, thickness: 1 });
    doc.moveDown(8);

    if (agreement.legacyWording) {
        doc.note('This is the wording in force when the application was submitted, not the current wording.');
    }

    doc.paragraph(openerIsTitle ? bodyLines.slice(1).join('\n').replace(/^\n+/, '') : agreement.body, {
        leading: 1.45,
    });
    doc.moveDown(10);

    doc.ensure(120);
    doc.rule();
    doc.moveDown(10);

    if (!agreement.accepted) {
        doc.line('ACCEPTANCE', { size: TYPE.LABEL, font: doc.font.bold, color: INK.MUTED });
        doc.moveDown(2);
        doc.paragraph(
            agreement.evidenceRecorded
                ? 'The applicant did NOT accept this agreement. No signature is attached to it.'
                : 'No acceptance was recorded for this agreement. No signature is attached to it.',
            { font: doc.font.italic, color: INK.WARNING },
        );
        return;
    }

    const combined = agreement.acceptanceScope === 'combined';
    doc.line(combined ? 'CERTIFIED AS PART OF A COMBINED ACKNOWLEDGEMENT' : 'ACCEPTED AND SIGNED', {
        size: TYPE.LABEL, font: doc.font.bold, color: INK.MUTED,
    });
    doc.moveDown(4);
    if (combined) {
        // Recording this as an individual acceptance would overclaim; recording
        // it as a refusal would be false. Say exactly what the evidence supports.
        doc.note(
            'The applicant certified the agreements as a set with one action. Individual '
            + 'acceptance of this agreement was not captured at the time.',
        );
        doc.moveDown(2);
    }

    const hasBitmap = Boolean(signatureImage && agreement.signature && agreement.signature.present);
    if (hasBitmap) {
        const maxWidth = 190;
        const scale = Math.min(maxWidth / signatureImage.width, 46 / signatureImage.height, 1);
        const width = signatureImage.width * scale;
        const height = signatureImage.height * scale;
        doc.ensure(height + 26);
        doc.page.drawImage(signatureImage, {
            x: MARGIN.LEFT,
            y: doc.y - height,
            width,
            height,
        });
        doc.moveDown(height + 4);
    } else {
        doc.moveDown(20);
    }

    doc.rule({ width: 210 });
    doc.moveDown(4);
    doc.line(applicantName, { size: TYPE.BODY, font: doc.font.bold });
    doc.moveDown(2);

    const evidence = [
        ['Accepted', formatInstant(agreement.acceptedAt) || 'Timestamp not recorded'],
        ['Signature', agreement.signature
            ? `Electronic (${agreement.signature.type})`
            : 'No signature recorded'],
    ];
    const context = agreement.acceptanceContext || {};
    if (clean(context.ip)) evidence.push(['Origin IP', clean(context.ip)]);
    if (clean(context.userAgent)) evidence.push(['Device', clean(context.userAgent)]);

    for (const [label, value] of evidence) {
        doc.paragraph(`${label}: ${value}`, { size: TYPE.SMALL, color: INK.MUTED });
    }
}

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
