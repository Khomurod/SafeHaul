/**
 * The carrier's PEV notices go to the company's email, in whichever shape its
 * document holds it. Edit Company and Settings save `contact.email`; a company
 * the older Create screen made holds a flat `email` too, which can be out of date,
 * and an older document an `adminEmail` no screen edits.
 * All addresses are artificial test fixtures.
 */
const mockCompanies = new Map();
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: () => ({
            doc: (id) => ({
                get: async () => ({ exists: mockCompanies.has(id), data: () => mockCompanies.get(id) }),
            }),
        }),
    },
}));
const mockSendDynamicEmail = jest.fn(async () => ({ success: true }));
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendDynamicEmail(...args) }));

const { notifyCarrierNoResponse, notifyCarrierVerificationComplete } = require('../../employmentVerification/notifications');

const VERIFICATION = { companyId: 'co-1', applicantName: 'Jane Driver', employerName: 'Old Carrier LLC' };

beforeEach(() => {
    mockCompanies.clear();
    mockSendDynamicEmail.mockClear();
});

const recipient = () => mockSendDynamicEmail.mock.calls[0]?.[1];

it('sends to the contact email Edit Company and Settings save', async () => {
    mockCompanies.set('co-1', { contact: { email: 'ops@example.test' } });
    await notifyCarrierVerificationComplete(VERIFICATION, { wasEmployed: true });
    expect(recipient()).toBe('ops@example.test');
});

it('prefers the saved contact email to a stale flat one an edit left behind', async () => {
    mockCompanies.set('co-1', { email: 'old@example.test', contact: { email: 'ops@example.test' } });
    await notifyCarrierNoResponse(VERIFICATION);
    expect(recipient()).toBe('ops@example.test');
});

it('prefers the saved contact email to an adminEmail no screen can change', async () => {
    mockCompanies.set('co-1', { adminEmail: 'former-admin@example.test', email: 'old@example.test', contact: { email: 'ops@example.test' } });
    await notifyCarrierVerificationComplete(VERIFICATION, { wasEmployed: true });
    expect(recipient()).toBe('ops@example.test');
});

it('falls back to adminEmail, then the flat email, when the contact email is blank', async () => {
    mockCompanies.set('co-1', { adminEmail: 'admin@example.test', email: 'old@example.test', contact: { email: '  ' } });
    await notifyCarrierNoResponse(VERIFICATION);
    expect(recipient()).toBe('admin@example.test');
});

it('still reaches a company created with a flat email', async () => {
    mockCompanies.set('co-1', { email: 'old@example.test', contact: { email: '' } });
    await notifyCarrierNoResponse(VERIFICATION);
    expect(recipient()).toBe('old@example.test');
});

it('sends nothing when the company has no email', async () => {
    mockCompanies.set('co-1', { companyName: 'Artificial Freight Co' });
    await notifyCarrierVerificationComplete(VERIFICATION, { wasEmployed: true });
    expect(mockSendDynamicEmail).not.toHaveBeenCalled();
});
