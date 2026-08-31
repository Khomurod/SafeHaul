// functions/shared/pdf/applicationAgreements.js
//
// The agreement pages of the application PDF: the verbatim frozen agreement
// text, and the signature block that appears only where that agreement
// itself carries acceptance evidence. Extracted verbatim from
// `applicationDocument.js`, which states those rules in its header.

const {
    INK,
    MARGIN,
    TYPE,
} = require('./documentBuilder');
const {
    clean,
    formatInstant,
} = require('./applicationText');

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

module.exports = {
    embedSignature,
    drawAgreement,
};
