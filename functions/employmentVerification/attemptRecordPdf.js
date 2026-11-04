/**
 * PEV — the printed record of attempts, made when day 30 passes with no answer.
 *
 * A factual list, from the request's attempt log (./attemptLog.js): who was
 * asked about whom, when the request went out, and each attempt with its day,
 * what it was, its outcome and who made it, oldest first. It states what was
 * done and when; it makes no claim about what the record satisfies.
 *
 * Never the portal token, an address, an email body or a mail error.
 */

const { CONTENT_WIDTH, DocumentBuilder, INK, MARGIN, TYPE, wrapText } = require('../shared/pdf/documentBuilder');
const { MANUAL_KINDS, REMINDER_NAMES, teamMemberName } = require('./attemptLog');

const DELIVERY = { email: 'Email', fax: 'Fax', manual: 'Hand delivery' };

const COLUMNS = [
    { label: 'Date (UTC)', x: 0, width: 98 },
    { label: 'Attempt', x: 104, width: 190 },
    { label: 'Outcome', x: 300, width: 70 },
    { label: 'By', x: 376, width: CONTENT_WIDTH - 376 },
];

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const millisOf = (at) => {
    if (typeof at?.toMillis === 'function') return at.toMillis();
    const ms = at instanceof Date ? at.getTime() : Date.parse(at);
    return Number.isNaN(ms) ? null : ms;
};

/** MM/DD/YYYY in UTC, and the time too when asked. */
function formatUtc(ms, { time = false } = {}) {
    if (ms === null || ms === undefined) return 'Not on record';
    const date = new Date(ms);
    const day = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: '2-digit', day: '2-digit', year: 'numeric' });
    return time ? `${day} ${date.toISOString().slice(11, 16)}` : day;
}

/** What one entry was, how it ended, and who made it. */
function describeAttempt(entry, request, company) {
    const team = (uid) => teamMemberName(company, uid) || 'Team member';
    const by = entry.by ? team(entry.by) : 'Automatic';
    switch (entry.kind) {
    case 'sent':
        return entry.method === 'email' || (!entry.method && request.deliveryMethod === 'email')
            ? { attempt: 'Request emailed to the employer', outcome: 'Sent', by }
            : { attempt: `Request issued for ${(DELIVERY[entry.method] || 'manual delivery').toLowerCase()}`, outcome: 'Issued', by };
    case 'send_failed':
        return { attempt: 'Request email', outcome: 'Not sent', by };
    case 'reminder':
        return { attempt: `${REMINDER_NAMES[entry.step] || 'Reminder'} email`, outcome: entry.ok ? 'Sent' : 'Not sent', by };
    case 'opened':
        return { attempt: 'Employer opened the request link', outcome: 'Opened', by: 'Employer' };
    case 'response':
        return { attempt: 'Employer answered in the portal', outcome: 'Answered', by: 'Employer' };
    case 'manual_result':
        return { attempt: 'Result uploaded by the team', outcome: 'On file', by };
    case 'no_response':
        return { attempt: 'No answer 30 days after the request', outcome: 'No answer', by };
    default:
        return { attempt: MANUAL_KINDS[entry.kind] || String(entry.kind || 'Attempt'), outcome: 'Recorded', by };
    }
}

/**
 * The log oldest first. A request sent before the log existed has no entry
 * for its sending: it gets a row from its creation time, said so.
 */
function rowsOf(request) {
    const logged = (Array.isArray(request.attempts) ? request.attempts : [])
        .filter((entry) => entry && typeof entry.kind === 'string')
        .map((entry, order) => ({ entry, order, ms: millisOf(entry.at) }))
        .sort((a, b) => ((a.ms ?? Infinity) - (b.ms ?? Infinity)) || (a.order - b.order))
        .map(({ entry, ms }) => ({ entry, ms }));
    const hasSend = logged.some(({ entry }) => entry.kind === 'sent' || entry.kind === 'send_failed');
    if (hasSend) return logged;
    return [{ entry: { kind: 'created' }, ms: millisOf(request.createdAt) }, ...logged];
}

function drawRow(doc, values, { font = doc.font.regular, color = INK.TEXT, size = TYPE.BODY } = {}) {
    const lines = values.map((value, i) => wrapText(value, { font, size, maxWidth: COLUMNS[i].width }));
    const height = Math.max(...lines.map((cell) => cell.length)) * size * 1.35 + 3;
    doc.ensure(height);
    const top = doc.y;
    lines.forEach((cell, i) => {
        doc.y = top;
        for (const line of cell) doc.line(line, { x: MARGIN.LEFT + COLUMNS[i].x, size, font, color });
    });
    doc.y = top - height;
}

function drawAttempts(doc, request, company) {
    doc.sectionHeading('Attempts', { keepWith: 60 });
    drawRow(doc, COLUMNS.map((column) => column.label.toUpperCase()), { font: doc.font.bold, color: INK.MUTED, size: TYPE.LABEL });
    doc.rule();
    doc.moveDown(4);
    for (const { entry, ms } of rowsOf(request)) {
        const manual = Object.hasOwn(MANUAL_KINDS, entry.kind);
        const { attempt, outcome, by } = entry.kind === 'created'
            ? {
                attempt: `Request created (${(DELIVERY[request.deliveryMethod] || 'Email').toLowerCase()})`,
                outcome: 'Not logged',
                by: teamMemberName(company, request.createdBy) || 'Team member',
            }
            : describeAttempt(entry, request, company);
        drawRow(doc, [formatUtc(ms, { time: !manual }), attempt, outcome, by]);
        if (text(entry.note)) {
            doc.paragraph(`Note: ${entry.note}`, {
                x: MARGIN.LEFT + COLUMNS[1].x, width: CONTENT_WIDTH - COLUMNS[1].x, size: TYPE.SMALL, color: INK.MUTED,
            });
        }
        doc.moveDown(3);
    }
    const loggedReminders = rowsOf(request).filter(({ entry }) => entry.kind === 'reminder' && entry.ok).length;
    const unlogged = Math.max(0, (Number(request.reminderCount) || 0) - loggedReminders);
    if (unlogged > 0) {
        doc.note(`The request also counts ${unlogged} reminder email${unlogged === 1 ? '' : 's'} sent before attempts `
            + 'were logged one by one; their dates are not on record.');
    }
}

/**
 * @param {object} opts
 * @param {object} opts.request    the `verification_requests` document, its `attempts` included
 * @param {object} opts.company    the company document (its name, and `teamMembers` for who made each attempt)
 * @param {string} opts.requestId  the request's reference (`requestIdOf`), never the token
 * @param {number} opts.generatedAt epoch milliseconds
 * @returns {Promise<Uint8Array>}
 */
async function buildAttemptRecordPdf({ request, company = {}, requestId, generatedAt = Date.now() }) {
    const applicantName = text(request.applicantName) || 'Applicant';
    const doc = await DocumentBuilder.create();
    doc.line('RECORD OF VERIFICATION ATTEMPTS', { size: TYPE.TITLE, font: doc.font.bold });
    doc.line('Previous employment verification', { size: TYPE.SUBHEADING, color: INK.MUTED });
    doc.moveDown(6);
    doc.paragraph(
        'No answer from the previous employer had been recorded 30 days after the request was sent. '
            + 'The attempts recorded for this request are listed below, oldest first.',
    );

    doc.sectionHeading('Request');
    doc.fieldGrid([
        { label: 'Previous employer', value: text(request.employerName) || 'Former Employer' },
        { label: 'Applicant', value: applicantName },
        { label: 'Prospective employer', value: text(company.companyName) || text(request.companyName) || 'Prospective Employer' },
        { label: 'Delivery', value: DELIVERY[request.deliveryMethod] || 'Email' },
        { label: 'Request sent', value: formatUtc(millisOf(request.createdAt)) },
        { label: 'Answer requested by', value: formatUtc(millisOf(request.expiresAt)) },
        { label: 'Request reference', value: requestId },
    ]);

    drawAttempts(doc, request, company);

    doc.runningHeader = `Verification attempts · ${applicantName}`;
    doc.footerLeft = `Generated ${formatUtc(generatedAt)}`;
    return doc.save();
}

/** The file name in the DQ file, from names only — never an id. */
function attemptRecordFilename(applicantName) {
    const safe = String(applicantName || 'Applicant').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return `Verification-Attempts-${safe || 'Applicant'}.pdf`;
}

module.exports = { attemptRecordFilename, buildAttemptRecordPdf };
