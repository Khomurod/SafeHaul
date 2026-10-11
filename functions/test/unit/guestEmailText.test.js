/**
 * Text a stranger typed never carries markup or a link into an email a
 * company's mail server sends: the applicant confirmation (the guest picks
 * both the recipient and the name) and the PEV emails (names the driver typed,
 * answers the past employer typed).
 */

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, data: () => ({ companyName: 'Acme <b>Trucking</b>' }) })),
            })),
        })),
    },
}));
jest.mock('../../emailService', () => ({ sendDynamicEmail: jest.fn(async () => ({ success: true })) }));

const { sendDynamicEmail } = require('../../emailService');
const { onNewApplicationEmailConfirmation } = require('../../notificationTriggers');
const {
    buildVerificationEmailHTML,
    buildReminderEmailHTML,
    buildCarrierCompleteEmailHTML,
    buildCarrierNoResponseEmailHTML,
} = require('../../employmentVerification/emailTemplates');
const { escapeHtml, clipText, plainGuestText } = require('../../shared/plainText');

const LINK = '<a href="https://evil.test/login">Verify your account</a>';

describe('the shared helpers', () => {
    it('escapes the five HTML characters', () => {
        expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
        expect(escapeHtml(null)).toBe('');
    });

    it('drops control and direction characters, folds spaces and marks a cut', () => {
        expect(clipText('  Jane\u0000\n\t Doe\u202E  ', 80)).toBe('Jane Doe');
        expect(clipText('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`);
        expect(clipText('Amazon.com Services LLC', 120)).toBe('Amazon.com Services LLC');
    });

    it('removes anything a mail client would turn into a link, and keeps real names', () => {
        expect(plainGuestText('Jane https://evil.test/x Doe', 80)).toBe('Jane Doe');
        expect(plainGuestText('Jane www.evil.test Doe', 80)).toBe('Jane Doe');
        expect(plainGuestText('Jane evil.test/login Doe', 80)).toBe('Jane Doe');
        expect(plainGuestText('Jane me@evil.test Doe', 80)).toBe('Jane Doe');
        // A zero-width space cannot hide a domain from the check.
        expect(plainGuestText('Jane evil\u200B.test Doe', 80)).toBe('Jane Doe');
        expect(plainGuestText("J.R. O'Neil-Smith Jr.", 80)).toBe("J.R. O'Neil-Smith Jr.");
        expect(plainGuestText('Class A CDL Driver (OTR) w/ home time', 80)).toBe('Class A CDL Driver (OTR) w/ home time');
    });
});

describe('the applicant confirmation email', () => {
    beforeEach(() => sendDynamicEmail.mockClear());

    function event(data) {
        return {
            params: { companyId: 'co1', appId: 'app12345' },
            data: { data: () => ({ email: 'victim@example.test', confirmationNumber: 'CN-42', ...data }) },
        };
    }

    it('shows a typed name and position as plain words, never markup or a link', async () => {
        await onNewApplicationEmailConfirmation(event({
            firstName: LINK,
            lastName: 'Doe',
            positionApplyingTo: '<img src=x onerror=alert(1)>Driver',
        }));
        const html = sendDynamicEmail.mock.calls[0][3];
        expect(html).not.toContain('<a href="https://evil.test');
        expect(html).not.toContain('evil.test');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Driver');
        // The company's own name is escaped too.
        expect(html).toContain('Acme &lt;b&gt;Trucking&lt;/b&gt;');
    });

    it('cuts an over-long name and position', async () => {
        await onNewApplicationEmailConfirmation(event({ firstName: 'A'.repeat(500), lastName: '', positionApplyingTo: 'B'.repeat(500) }));
        const html = sendDynamicEmail.mock.calls[0][3];
        expect(html).not.toContain('A'.repeat(81));
        expect(html).not.toContain('B'.repeat(81));
        expect(html).toContain(`${'A'.repeat(80)}…`);
    });
});

describe('the PEV emails', () => {
    const request = {
        applicantName: LINK,
        employerName: 'Amazon.com Services <i>LLC</i>',
        companyName: 'Acme <b>Trucking</b>',
        employmentDates: '01/2020 - <u>02/2022</u>',
        token: 'tok123',
        baseUrl: 'https://app.test',
        deadlineDate: 'November 10, 2026',
    };

    it('escapes every name in the request and reminder emails, keeping a company name whole', () => {
        for (const html of [buildVerificationEmailHTML(request), buildReminderEmailHTML({ ...request, reminderType: 'final_notice' })]) {
            expect(html).not.toContain('evil.test');
            expect(html).not.toMatch(/<(i|b|u)>/);
            expect(html).toContain('Amazon.com Services &lt;i&gt;LLC&lt;/i&gt;');
            expect(html).toContain('Acme &lt;b&gt;Trucking&lt;/b&gt;');
            expect(html).toContain('01/2020 - &lt;u&gt;02/2022&lt;/u&gt;');
            // The real link to the form is untouched.
            expect(html).toContain('href="https://app.test/verify/tok123"');
        }
    });

    it("shows the past employer's answers as plain words in the carrier's email", () => {
        const html = buildCarrierCompleteEmailHTML(request, {
            wasEmployed: true,
            positionHeld: `Driver ${LINK}`,
            respondentName: '<script>alert(1)</script>Pat',
            respondentTitle: 'Safety Manager www.evil.test',
        });
        expect(html).not.toContain('evil.test');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Pat');
        expect(html).toContain('Safety Manager');
    });

    it('escapes the names in the no-response email', () => {
        const html = buildCarrierNoResponseEmailHTML({ ...request, reminderCount: 3 });
        expect(html).not.toContain('evil.test');
        expect(html).toContain('Amazon.com Services &lt;i&gt;LLC&lt;/i&gt;');
    });
});
