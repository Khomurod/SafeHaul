/**
 * The quick interest form a referred driver fills in. Artificial people and
 * companies only.
 */
jest.mock('firebase-functions/v1', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    const https = { HttpsError, onCall: (fn) => fn };
    return { https, runWith: () => ({ https }) };
});

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock({}, { filters: true });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));
const mockRateLimit = jest.fn(async () => true);
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...args) => mockRateLimit(...args) }));

const { submitReferralInterest, consentText } = require('../../referrals/submitReferralInterest');

const CO = 'co-ref';
const CODE = 'ABCD2345';
const CONTEXT = { rawRequest: { ip: '203.0.113.7', headers: {} } };
const ANSWERS = {
    companyId: CO,
    referralCode: CODE,
    firstName: '  Dana ',
    lastName: 'Driver',
    phone: '(555) 010-2030',
    email: 'Dana.Driver@Example.test',
    contactConsent: true,
};

const SEED = {
    [`companies/${CO}`]: { companyName: 'Artificial Freight', isActive: true },
    [`companies/${CO}/referral_links/${CODE}`]: {
        companyId: CO, code: CODE, referrerName: 'Rita Referrer', createdBy: 'rec-1', createdByName: 'Riley', active: true,
    },
    'memberships/m1': { userId: 'rec-1', companyId: CO, role: 'recruiter' },
    'users/rec-1': { name: 'Riley Recruiter' },
};

const submit = (overrides = {}) => submitReferralInterest({ ...ANSWERS, ...overrides }, CONTEXT);
const docsUnder = (prefix) => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`${prefix}/`) && path.slice(prefix.length + 1).split('/').length === 1)
    .map(([path, data]) => ({ path, data }));
const leads = () => docsUnder(`companies/${CO}/leads`);
const notifications = () => docsUnder(`companies/${CO}/notifications`);

beforeEach(() => {
    // This file queues a *Once value, so every mock is reset and its default put back.
    jest.resetAllMocks();
    mock.reset(SEED);
    mockRateLimit.mockImplementation(async () => true);
});

describe('submitReferralInterest', () => {
    it('creates a lead assigned to the link creator, with the referral and the consent, and tells them', async () => {
        await expect(submit()).resolves.toEqual({ ok: true });

        expect(mockRateLimit).toHaveBeenCalledWith('referral_interest_203.0.113.7', 5, 60, 'closed');
        const [lead] = leads();
        expect(lead.data).toMatchObject({
            companyId: CO,
            firstName: 'Dana',
            lastName: 'Driver',
            phone: '+15550102030',
            normalizedPhone: '5550102030',
            email: 'dana.driver@example.test',
            source: 'Driver Referral',
            status: 'New Lead',
            assignedTo: 'rec-1',
            assignedToName: 'Riley Recruiter',
            referral: { code: CODE, referrerName: 'Rita Referrer' },
            'sms-consent': 'yes',
            contactConsent: { text: consentText('Artificial Freight'), ip: '203.0.113.7' },
        });
        expect(notifications()).toEqual([expect.objectContaining({
            data: expect.objectContaining({
                type: 'referral_lead', recipientId: 'rec-1', relatedType: 'lead', relatedId: lead.path.split('/').pop(),
                message: 'Dana Driver was referred by Rita Referrer',
            }),
        })]);
    });

    it('still takes the driver, unassigned and without a referral, when the code is unknown or switched off', async () => {
        await submit({ referralCode: 'ZZZZ9999' });
        mock.docs.set(`companies/${CO}/referral_links/${CODE}`, { ...SEED[`companies/${CO}/referral_links/${CODE}`], active: false });
        await submit({ phone: '5550109999', email: 'other@example.test' });

        for (const { data } of leads()) {
            expect(data).toMatchObject({ assignedTo: '', assignedToName: '' });
            expect(data.referral).toBeUndefined();
        }
        expect(leads()).toHaveLength(2);
        expect(notifications()).toEqual([]);
    });

    it('keeps the referral but assigns nobody when the creator has left the team', async () => {
        mock.docs.delete('memberships/m1');
        await submit();
        expect(leads()[0].data).toMatchObject({ assignedTo: '', referral: { code: CODE } });
        expect(notifications()).toEqual([]);
    });

    it('adds the referral to a driver already in the records, without a second record, answering the same', async () => {
        mock.docs.set(`companies/${CO}/leads/old`, { companyId: CO, normalizedPhone: '5550102030', email: 'x@example.test', status: 'Contacted' });
        mock.docs.set(`companies/${CO}/applications/app`, { companyId: CO, phoneNormalized: '5559990000', emailNormalized: 'dana.driver@example.test' });

        await expect(submit()).resolves.toEqual({ ok: true });
        expect(leads()).toHaveLength(1);
        expect(mock.docs.get(`companies/${CO}/leads/old`)).toMatchObject({ status: 'Contacted', referral: { code: CODE } });
        expect(docsUnder(`companies/${CO}/leads/old/activity_logs`)).toHaveLength(1);

        // A second time changes nothing more.
        await submit();
        expect(docsUnder(`companies/${CO}/leads/old/activity_logs`)).toHaveLength(1);

        mock.docs.delete(`companies/${CO}/leads/old`);
        await submit();
        expect(leads()).toHaveLength(0);
        expect(mock.docs.get(`companies/${CO}/applications/app`).referral).toEqual({ code: CODE, referrerName: 'Rita Referrer' });
    });

    it.each([
        [{ firstName: '  ' }, /first name/],
        [{ lastName: 'x'.repeat(81) }, /last name is too long/],
        [{ phone: '555-0102' }, /10-digit phone/],
        [{ email: 'not-an-email' }, /valid email/],
        [{ contactConsent: 'yes' }, /agree to be contacted/],
    ])('refuses %p, writing nothing', async (overrides, message) => {
        await expect(submit(overrides)).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringMatching(message) });
        expect(leads()).toEqual([]);
    });

    it('refuses a company that does not exist, and too many tries', async () => {
        await expect(submit({ companyId: 'nope' })).rejects.toMatchObject({ code: 'not-found' });
        mockRateLimit.mockResolvedValueOnce(false);
        await expect(submit()).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(leads()).toEqual([]);
    });
});
