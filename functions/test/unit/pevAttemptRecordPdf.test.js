/**
 * The PEV record of attempts: the one-page PDF made at day 30 with no answer.
 *
 * Rendered with the real pdf-lib. Every `drawText` is recorded with its page, so
 * a test can say what the document prints: the parties, each attempt with its
 * day, outcome and author, a recruiter's note, and never the token, an address
 * or a mail error.
 */

const { PDFDocument, PDFPage } = require('pdf-lib');
const { attemptRecordFilename, buildAttemptRecordPdf } = require('../../employmentVerification/attemptRecordPdf');

const drawn = [];
const originalDrawText = PDFPage.prototype.drawText;

beforeEach(() => {
    drawn.length = 0;
    jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function record(value, options) {
        drawn.push({ page: this, text: value, y: options.y });
        return originalDrawText.call(this, value, options);
    });
});

afterEach(() => jest.restoreAllMocks());

const ts = (iso) => ({ toMillis: () => Date.parse(iso) });
const printed = () => drawn.map((d) => d.text).join(' | ');
/** The texts drawn on one line, left to right, of the row whose first cell is `first`. */
const rowStarting = (first) => {
    const at = drawn.find((d) => d.text === first);
    if (!at) throw new Error(`"${first}" was not printed`);
    return drawn.filter((d) => d.page === at.page && d.y === at.y).map((d) => d.text);
};

const TOKEN = 'portal-token-0123456789abcdef';

const REQUEST = {
    token: TOKEN,
    requestId: 'req-0f1e2d3c',
    employerName: 'Old Carrier LLC',
    employerEmail: 'hr@oldcarrier.test',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    deliveryMethod: 'email',
    reminderCount: 3,
    createdAt: ts('2026-10-01T14:05:00Z'),
    expiresAt: ts('2026-10-31T14:05:00Z'),
    attempts: [
        { kind: 'no_response', at: ts('2026-11-01T06:00:00Z'), ok: true },
        { kind: 'sent', at: ts('2026-10-01T14:05:00Z'), ok: true, by: 'recruiter-1', method: 'email' },
        { kind: 'reminder', at: ts('2026-10-06T06:00:00Z'), ok: false, step: 1, error: 'Invalid login: 535 smtp.carrier.test' },
        { kind: 'reminder', at: ts('2026-10-07T06:00:00Z'), ok: true, step: 1 },
        { kind: 'opened', at: ts('2026-10-08T17:30:00Z'), ok: true },
        { kind: 'call', at: ts('2026-10-09T12:00:00Z'), ok: true, by: 'recruiter-2', note: 'Left a voicemail with HR' },
        { kind: 'reminder', at: ts('2026-10-16T06:00:00Z'), ok: true, step: 2 },
        { kind: 'reminder', at: ts('2026-10-21T06:00:00Z'), ok: true, step: 3 },
    ],
};

const COMPANY = {
    companyName: 'SafeHaul Carrier LLC',
    teamMembers: [
        { userId: 'recruiter-1', role: 'recruiter', name: 'Rita Recruiter' },
        { userId: 'recruiter-2', role: 'hr_user', name: 'Unknown' },
    ],
};

const build = (request = REQUEST) => buildAttemptRecordPdf({
    request, company: COMPANY, requestId: 'req-0f1e2d3c', generatedAt: Date.parse('2026-11-01T06:00:00Z'),
});

describe('PEV record of attempts', () => {
    it('names the request: employer, applicant, prospective employer, delivery, dates and reference', async () => {
        await build();
        const text = printed();
        expect(text).toContain('RECORD OF VERIFICATION ATTEMPTS');
        for (const value of ['Old Carrier LLC', 'Jane Driver', 'SafeHaul Carrier LLC', 'Email', '10/01/2026', '10/31/2026', 'req-0f1e2d3c']) {
            expect(drawn.map((d) => d.text)).toContain(value);
        }
        expect(text).toContain('Generated 11/01/2026');
    });

    it('lists every attempt oldest first, with its day, outcome and author', async () => {
        await build();

        const firsts = drawn.map((d) => d.text).filter((t) => /^\d\d\/\d\d\/\d{4}( \d\d:\d\d)?$/.test(t))
            .filter((t) => !['10/01/2026', '10/31/2026'].includes(t));
        expect(firsts).toEqual([
            '10/01/2026 14:05', '10/06/2026 06:00', '10/07/2026 06:00', '10/08/2026 17:30',
            '10/09/2026', '10/16/2026 06:00', '10/21/2026 06:00', '11/01/2026 06:00',
        ]);
        expect(rowStarting('10/01/2026 14:05')).toEqual(['10/01/2026 14:05', 'Request emailed to the employer', 'Sent', 'Rita Recruiter']);
        expect(rowStarting('10/06/2026 06:00')).toEqual(['10/06/2026 06:00', 'First reminder email', 'Not sent', 'Automatic']);
        expect(rowStarting('10/07/2026 06:00')).toEqual(['10/07/2026 06:00', 'First reminder email', 'Sent', 'Automatic']);
        expect(rowStarting('10/08/2026 17:30')).toEqual(['10/08/2026 17:30', 'Employer opened the request link', 'Opened', 'Employer']);
        // A recorded call is dated by its day; a member the team cache cannot name is "Team member".
        expect(rowStarting('10/09/2026')).toEqual(['10/09/2026', 'Phone call', 'Recorded', 'Team member']);
        expect(printed()).toContain('Note: Left a voicemail with HR');
        expect(rowStarting('10/21/2026 06:00')).toEqual(['10/21/2026 06:00', 'Final notice email', 'Sent', 'Automatic']);
        expect(rowStarting('11/01/2026 06:00')).toEqual(['11/01/2026 06:00', 'No answer 30 days after the request', 'No answer', 'Automatic']);
    });

    it('prints no token, no address and no mail error', async () => {
        await build();
        const text = printed();
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain('hr@oldcarrier.test');
        expect(text).not.toContain('smtp.carrier.test');
        expect(text).not.toMatch(/good faith|391\.23/i);
    });

    it('fits a usual record on one page', async () => {
        const bytes = await build();
        expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    });

    it('says what a request sent before attempts were logged cannot show', async () => {
        await build({
            ...REQUEST,
            requestId: undefined,
            deliveryMethod: 'fax',
            reminderCount: 2,
            attempts: [{ kind: 'no_response', at: ts('2026-11-01T06:00:00Z'), ok: true }],
        });

        expect(rowStarting('10/01/2026 14:05')).toEqual(['10/01/2026 14:05', 'Request created (fax)', 'Not logged', 'Team member']);
        expect(printed()).toContain('The request also counts 2 reminder emails sent before attempts were logged one by one');
    });

    it('names the file after the applicant only', () => {
        expect(attemptRecordFilename('Jane  Driver-Smith')).toBe('Verification-Attempts-Jane-DriverSmith.pdf');
    });
});
