/**
 * The automated email a call log sends when nobody answered: every member of
 * the company team may send it, it names the company and links its own
 * application page, and the names in it arrive as text. The other templates
 * stay with company admins.
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
jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: {
        collection: () => ({
            doc: () => ({
                async get() { return { exists: Boolean(mockCompany.data), data: () => mockCompany.data || undefined }; },
            }),
        }),
    },
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
});

describe('sendAutomatedEmail — the "no answer" follow-up', () => {
    it('is sent for a recruiter on the company team', async () => {
        const result = await sendAutomatedEmail(noAnswer());

        expect(result).toEqual({ success: true });
        expect(mockAssertCompanyAccess).toHaveBeenCalledWith('recruiter-1', 'co1');
        expect(mockSendDynamicEmail).toHaveBeenCalledWith('co1', 'driver@example.com', 'We missed you!', expect.any(String));
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
