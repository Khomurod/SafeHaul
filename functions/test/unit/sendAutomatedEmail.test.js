/**
 * The automated email a call log sends when nobody answered: every member of
 * the company team may send it, only to one of the company's own leads or
 * applicants and a bounded number of times; it names the company and links its
 * own application page, and the names in it arrive as text. The other
 * templates stay with company admins.
 */
jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    return { HttpsError, onCall: (opts, handler) => handler };
});
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (path, handler) => handler }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => handler }));

const mockCompany = { data: null };
// The addresses on file, by collection, as stored.
const mockOnFile = { leads: [], applications: [] };
jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: {
        collection: () => ({
            doc: () => ({
                async get() { return { exists: Boolean(mockCompany.data), data: () => mockCompany.data || undefined }; },
                collection: (name) => ({
                    where: (field, op, values) => ({
                        limit: () => ({
                            async get() { return { empty: !mockOnFile[name].some((email) => values.includes(email)) }; },
                        }),
                    }),
                }),
            }),
        }),
    },
}));

const mockCheckRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args),
}));

const mockAssertCompanyAccess = jest.fn();
const mockAssertCompanyAdminStrict = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAccess: (...args) => mockAssertCompanyAccess(...args),
    assertCompanyAdminStrict: (...args) => mockAssertCompanyAdminStrict(...args),
}));

const mockSendDynamicEmail = jest.fn();
jest.mock('../../emailService', () => ({
    sendDynamicEmail: (...args) => mockSendDynamicEmail(...args),
}));

const { sendAutomatedEmail } = require('../../companyAdmin');

const recruiter = { auth: { uid: 'recruiter-1' } };
const noAnswer = (placeholders = {}) => ({
    ...recruiter,
    data: {
        companyId: 'co1',
        recipientEmail: 'driver@example.com',
        triggerType: 'no_answer',
        placeholders: { driverfirstname: 'Bob', recruitername: 'Rita Recruiter', companyslug: 'co1', ...placeholders },
    },
});
const sentBody = () => mockSendDynamicEmail.mock.calls[0][3];

beforeEach(() => {
    jest.resetAllMocks();
    mockCompany.data = { companyName: 'Blue Line Freight', appSlug: 'blue-line' };
    // A recruiter: on the company team, not a company admin.
    mockAssertCompanyAccess.mockResolvedValue(undefined);
    mockAssertCompanyAdminStrict.mockRejectedValue(Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' }));
    mockSendDynamicEmail.mockResolvedValue({ success: true });
    mockOnFile.leads = ['driver@example.com'];
    mockOnFile.applications = [];
    mockCheckRateLimit.mockResolvedValue(true);
});

describe('sendAutomatedEmail — the "no answer" follow-up', () => {
    it('is sent for a recruiter on the company team', async () => {
        const result = await sendAutomatedEmail(noAnswer());

        expect(result).toEqual({ success: true });
        expect(mockAssertCompanyAccess).toHaveBeenCalledWith('recruiter-1', 'co1');
        expect(mockSendDynamicEmail).toHaveBeenCalledWith('co1', 'driver@example.com', 'We missed you!', expect.any(String));
    });

    it('goes only to a lead or applicant of the company', async () => {
        const stranger = noAnswer();
        stranger.data.recipientEmail = 'someone@example.org';

        await expect(sendAutomatedEmail(stranger)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
    });

    it('finds the applicant under the address as the call log sent it', async () => {
        mockOnFile.leads = [];
        mockOnFile.applications = ['Driver@Example.com'];
        const call = noAnswer();
        call.data.recipientEmail = 'Driver@Example.com';

        await sendAutomatedEmail(call);

        expect(mockSendDynamicEmail).toHaveBeenCalledWith('co1', 'driver@example.com', 'We missed you!', expect.any(String));
    });

    it('is refused past the hourly limit for one sender', async () => {
        mockCheckRateLimit.mockResolvedValue(false);

        await expect(sendAutomatedEmail(noAnswer())).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimit).toHaveBeenCalledWith('no_answer_email_recruiter-1', 100, 3600, 'closed');
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
    });

    it('is refused for someone outside the company', async () => {
        mockAssertCompanyAccess.mockRejectedValue(Object.assign(new Error('No access.'), { code: 'permission-denied' }));

        await expect(sendAutomatedEmail(noAnswer())).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
    });

    it("names the company and links the company's own application page, whatever the caller sent", async () => {
        await sendAutomatedEmail(noAnswer({ companyname: 'Someone Else', companyslug: 'elsewhere' }));

        expect(sentBody()).toContain('<strong>Blue Line Freight</strong>');
        expect(sentBody()).toContain('href="https://app.safehaul.io/apply/blue-line"');
        expect(sentBody()).not.toMatch(/Someone Else|elsewhere|our fleet/);
    });

    it.each([
        // What the lead import writes for a row without an email, now and before.
        'placeholder_9f2c1a@placeholder.safehaulapp.com',
        'driver_123@placeholder.com',
    ])("is not sent to an imported lead's made-up address %s", async (address) => {
        mockOnFile.leads = [address];
        const call = noAnswer();
        call.data.recipientEmail = address;

        const result = await sendAutomatedEmail(call);

        expect(result).toEqual({ success: false, skipped: 'placeholder-recipient' });
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
        expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('refuses someone outside the company before it looks at the address', async () => {
        mockAssertCompanyAccess.mockRejectedValue(Object.assign(new Error('No access.'), { code: 'permission-denied' }));
        const call = noAnswer();
        call.data.recipientEmail = 'placeholder_9f2c1a@placeholder.safehaulapp.com';

        await expect(sendAutomatedEmail(call)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('shows the names as text', async () => {
        await sendAutomatedEmail(noAnswer({ driverfirstname: '<b>Bob</b>', recruitername: 'Rita <a href="https://evil.test">here</a>' }));

        expect(sentBody()).toContain('Hi &lt;b&gt;Bob&lt;/b&gt;,');
        expect(sentBody()).not.toContain('<b>Bob</b>');
        expect(sentBody()).not.toContain('evil.test');
    });
});

describe('sendAutomatedEmail — the other templates', () => {
    it('stay refused for a recruiter', async () => {
        const manual = { ...recruiter, data: { companyId: 'co1', recipientEmail: 'driver@example.com', triggerType: 'manual_email', placeholders: { subject: 'Hi', body: 'Text' } } };

        await expect(sendAutomatedEmail(manual)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockAssertCompanyAdminStrict).toHaveBeenCalledWith('recruiter-1', 'co1');
        expect(mockSendDynamicEmail).not.toHaveBeenCalled();
    });
});
