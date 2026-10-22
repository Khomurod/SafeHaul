/**
 * PEV — the request document sent to a previous employer.
 *
 * One PDF per request: who asks, about whom, for which employment, and the
 * applicant's own release with their signature. It is attached to the request
 * email and its reminders, and kept beside the request as the record of what
 * was sent.
 *
 * It never carries the portal link: the link answers as the employer, and this
 * file is stored in the driver's record where the whole team can open it.
 * The SSN is printed as its last four digits only.
 */

const { CONTENT_WIDTH, DocumentBuilder, INK, MARGIN, TYPE, wrapText } = require('../shared/pdf/documentBuilder');
const { embedSignature } = require('../shared/pdf/applicationAgreements');
const { maskSsn } = require('../shared/pdf/applicationText');
const { snapshotCompanyDetails } = require('../shared/applicationDefinition');
const { RELEASE_NOTES, RELEASE_PARAGRAPHS, RELEASE_RIGHTS, applicantNameOf, releaseOf } = require('../shared/previousEmployerRelease');

const NOT_ON_FILE = 'Not on file';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** MM/DD/YYYY of an instant, in UTC, as the signed-date displays print it. */
function formatDay(ms) {
    if (ms === null || ms === undefined) return null;
    return new Date(ms).toLocaleDateString('en-US', {
        timeZone: 'UTC', month: '2-digit', day: '2-digit', year: 'numeric',
    });
}

function joinAddress(parts) {
    const line = parts.map(text).filter(Boolean).join(', ');
    return line || null;
}

function drawParties(doc, { company, employer }) {
    const from = snapshotCompanyDetails(company);
    const fromAddress = joinAddress([from.address.street, from.address.city, from.address.state, from.address.zip]);
    const numbers = [from.dotNumber && `USDOT ${from.dotNumber}`, from.mcNumber && `MC ${from.mcNumber}`]
        .filter(Boolean).join('  ·  ');
    const contact = [from.contact.email, from.contact.phone].filter(Boolean).join('  ·  ');
    const employerAddress = joinAddress([employer.address, employer.city, employer.state]);

    doc.sectionHeading('To (previous employer)');
    doc.fieldGrid([
        { label: 'Company', value: text(employer.name) || 'Former Employer' },
        field('Email', text(employer.email)),
        field('Address', employerAddress),
        field('Phone', text(employer.phone)),
    ]);

    doc.sectionHeading('From (prospective employer)');
    doc.fieldGrid([
        { label: 'Company', value: from.companyName || 'Prospective Employer' },
        field('DOT / MC', numbers),
        field('Address', fromAddress),
        field('Contact', contact),
    ]);
}

/** A grid cell that says "Not on file", muted, when there is nothing to print. */
function field(label, value) {
    return value ? { label, value } : { label, value: NOT_ON_FILE, muted: true };
}

function drawApplicant(doc, { applicantName, application, employer }) {
    const ssn = maskSsn(application?.ssn);
    const dates = [text(employer.startDate) || 'N/A', text(employer.endDate) || 'N/A'].join(' to ');
    doc.sectionHeading('Applicant');
    doc.fieldGrid([
        field('Name', text(applicantName)),
        field('SSN (last four)', ssn),
        field('Position held', text(employer.position)),
        { label: 'Dates of employment reported', value: dates },
    ]);
}

/** Room the signature, its rule, the name and the date line take. */
const SIGNATURE_BLOCK = 110;

/** The height the release wording takes at body size, as `drawRelease` lays it out. */
function releaseHeight(doc) {
    const lines = (value, width) => wrapText(value, { font: doc.font.regular, size: TYPE.BODY, maxWidth: width }).length;
    const leading = TYPE.BODY * 1.45;
    const paragraphs = RELEASE_PARAGRAPHS.reduce((sum, p) => sum + lines(p, CONTENT_WIDTH) * leading + 4, 0);
    const rights = RELEASE_RIGHTS.reduce((sum, r) => sum + lines(`•  ${r}`, CONTENT_WIDTH) * leading, 0);
    return paragraphs + rights + 10;
}

async function drawRelease(doc, { applicantName, application }) {
    const release = releaseOf(application);
    // The wording and the signature beneath it share a page: a signature alone
    // overleaf no longer shows what it was given under.
    const keepWith = release.status === 'signed' ? releaseHeight(doc) + SIGNATURE_BLOCK : 40;
    doc.sectionHeading("Applicant's release (signed with the application)", { keepWith });

    if (release.status !== 'signed') {
        doc.note(RELEASE_NOTES[release.status]);
        return release.status;
    }

    for (const paragraph of RELEASE_PARAGRAPHS) {
        doc.paragraph(paragraph, { leading: 1.45 });
        doc.moveDown(4);
    }
    for (const right of RELEASE_RIGHTS) {
        doc.paragraph(`•  ${right}`, { x: MARGIN.LEFT + 10, leading: 1.45 });
    }
    doc.moveDown(10);

    const image = release.drawnImage ? await embedSignature(doc.pdfDoc, release.drawnImage) : null;
    if (image) {
        const scale = Math.min(190 / image.width, 46 / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        // The mark, its rule, the name and the date line stay on one page.
        doc.ensure(height + 34);
        doc.page.drawImage(image, { x: MARGIN.LEFT, y: doc.y - height, width, height });
        doc.moveDown(height + 4);
    } else if (release.typedName) {
        doc.ensure(52);
        doc.line(`/s/ ${release.typedName}`, { size: 14, font: doc.font.italic });
    } else {
        // A drawn signature that cannot be read back: the record says so rather than leaving a blank line.
        doc.ensure(52);
        doc.note('The signature image on file could not be reproduced.');
    }
    doc.rule({ width: 210 });
    doc.moveDown(4);
    doc.line(text(applicantName) || 'Applicant', { font: doc.font.bold });
    doc.paragraph(
        `Signed electronically (${release.typedName ? 'typed name' : 'drawn'}) on ${formatDay(release.signedAt)} (UTC), `
            + 'as part of the Certification of Applicant at the end of the application.',
        { size: TYPE.SMALL, color: INK.MUTED },
    );
    return 'signed';
}

/**
 * @param {object} opts
 * @param {object} opts.company      the company document
 * @param {object} opts.application  the application or lead document
 * @param {object} opts.employer     `{ name, email, address, city, state, phone, position, startDate, endDate }`
 * @param {string} opts.applicantName  used only when the application records no name
 * @param {string} opts.deadlineDate `YYYY-MM-DD`
 * @param {number} opts.sentAt       epoch milliseconds
 * @param {boolean} [opts.emailed]   false when the sender delivers the link by hand
 * @returns {Promise<{ bytes: Uint8Array, release: string }>}
 */
async function buildRequestPdf({ company, application, employer, applicantName: requestedName, deadlineDate, sentAt, emailed = true }) {
    // The name printed under the signature is the one the signed application
    // records, not whatever the caller sent; the caller's stands in only when
    // the application holds none.
    const applicantName = applicantNameOf(application) || requestedName;
    const doc = await DocumentBuilder.create();
    doc.line('REQUEST FOR VERIFICATION OF EMPLOYMENT', { size: TYPE.TITLE, font: doc.font.bold });
    doc.line('Safety performance history  ·  49 CFR 391.23', { size: TYPE.SUBHEADING, color: INK.MUTED });
    doc.moveDown(6);
    doc.paragraph(
        'The applicant named below has applied to drive for the prospective employer, who must investigate '
            + 'the applicant\'s employment and safety performance history with each employer of the preceding three '
            + `years. Please respond by ${deadlineDate} using the secure link `
            + (emailed ? 'in the email this document came with.' : 'provided with this document.'),
    );

    drawParties(doc, { company, employer });
    drawApplicant(doc, { applicantName, application, employer });
    const release = await drawRelease(doc, { applicantName, application });

    doc.runningHeader = `Verification of employment · ${text(applicantName) || 'Applicant'}`;
    doc.footerLeft = `Sent ${formatDay(sentAt)}`;
    const bytes = await doc.save();
    return { bytes, release };
}

/** The file name the employer sees, from names only — never an id or the SSN. */
function requestPdfFilename(applicantName) {
    const safe = String(applicantName || 'Applicant').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return `Verification-of-Employment-Request-${safe || 'Applicant'}.pdf`;
}

module.exports = { buildRequestPdf, requestPdfFilename };
