/**
 * Who may manage a company's SMS settings: one rule for every SMS settings
 * callable (owner decision K1, `integrations/controllers/config/smsSettingsAccess.js`).
 *
 * K1: company owners may manage SMS-provider settings even without a separate
 * Company Admin role, with company isolation and the deactivation refusal kept.
 * The rule is the shared `assertCompanyAdminStrict`: a super admin, a Company
 * Admin (by token or membership), or the company's owner (`ownerId`, `createdBy`
 * or `adminId` on the company); never a recruiter, an HR user or another
 * company's admin; a deactivated company refused, but for a super admin.
 *
 * Before K1 the callables disagreed: three asked only a `company_admin`
 * membership, three only the token's role, two the strict rule, so an owner
 * could assign numbers but not save the provider. `BEFORE` records that (this
 * suite, run against the code before the change, observed exactly it); `AFTER`
 * is asserted against the real callables, with the real access check over an
 * in-memory Firestore. "Touched" means the callable reached the company's SMS
 * settings or provider at all. All ids, numbers and secrets are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const mockTouched = [];
const mockDocs = new Map();
const mockMemberships = [];
const mockClaims = new Map();

jest.mock('../../firebaseAdmin', () => {
    const touch = (op, path) => { if (path.includes('integrations')) mockTouched.push(`${op} ${path}`); };
    const ref = (path) => ({
        path,
        get: async () => {
            touch('get', path);
            const data = mockDocs.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        set: async () => touch('set', path),
        update: async () => touch('update', path),
        delete: async () => touch('delete', path),
        collection: (name) => collection(`${path}/${name}`),
    });
    const membershipQuery = (filters) => ({
        where: (field, _op, value) => membershipQuery({ ...filters, [field]: value }),
        limit: () => membershipQuery(filters),
        get: async () => {
            const docs = mockMemberships
                .filter((m) => Object.entries(filters).every(([field, value]) => m[field] === value))
                .map((m) => ({ data: () => m }));
            return { empty: docs.length === 0, docs };
        },
    });
    const collection = (path) => (path === 'memberships'
        ? membershipQuery({})
        : { doc: (id) => ref(`${path}/${id}`) });
    const db = { collection };
    return {
        db,
        admin: {
            firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => '__ts', delete: () => '__del' } }),
            auth: () => ({ getUser: async (uid) => ({ customClaims: mockClaims.get(uid) || {} }) }),
        },
    };
});

jest.mock('../../integrations/factory', () => {
    const adapter = () => ({ verifyConnection: async () => ({}), sendSMS: async () => ({}) });
    return {
        getAdapter: async () => { mockTouched.push('provider'); return adapter(); },
        getAdapterForNumber: async () => { mockTouched.push('provider'); return adapter(); },
    };
});
jest.mock('../../integrations/encryption', () => ({ encrypt: (v) => `enc:${v}`, decrypt: (v) => `plain:${v}` }));
jest.mock('../../integrations/adapters/ringcentral', () => class {
    constructor() {
        mockTouched.push('provider');
        this.rc = { login: async () => ({}), get: async () => ({ json: async () => ({ contact: {} }) }) };
    }
});
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
jest.mock('../../integrations/adapters/ringcentralSdk', () => ({
    createRingCentralSdk: () => {
        mockTouched.push('provider');
        return { login: async () => ({}), get: async () => ({ json: async () => ({ contact: {}, records: [] }) }) };
    },
}));
jest.mock('@ringcentral/sdk', () => ({ SDK: { server: { sandbox: 'sandbox-url', production: 'prod-url' } } }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => { mockTouched.push('rate-limit'); return true; } }));

const callables = require('../../integrations');

const LINE = '+15550001111';
const CALLS = {
    saveIntegrationConfig: (companyId) => ({ companyId, provider: '8x8', config: { apiKey: 'k' } }),
    verifySmsConfig: (companyId) => ({ companyId }),
    testLineConnection: (companyId) => ({ companyId, jwt: 'jwt', clientId: 'id', clientSecret: 'secret' }),
    verifyLineConnection: (companyId) => ({ companyId, phoneNumber: LINE }),
    addPhoneLine: (companyId) => ({ companyId, phoneNumber: LINE, jwt: 'jwt' }),
    removePhoneLine: (companyId) => ({ companyId, phoneNumber: LINE }),
    saveSmsLineAssignments: (companyId) => ({ companyId, assignmentTokens: {} }),
    sendTestSMS: (companyId) => ({ companyId, testPhoneNumber: '+15550002222' }),
};

/** Each caller: the token it signs in with, and the company it asks about. */
const PEOPLE = {
    superAdmin: { uid: 'super-1', token: { globalRole: 'super_admin', roles: { globalRole: 'super_admin' } }, companyId: 'co-1' },
    companyAdmin: { uid: 'admin-1', token: { roles: { 'co-1': 'company_admin' } }, companyId: 'co-1' },
    adminByTokenOnly: { uid: 'token-admin-1', token: { roles: { 'co-1': 'company_admin' } }, companyId: 'co-1' },
    adminByMembershipOnly: { uid: 'member-admin-1', token: { roles: {} }, companyId: 'co-1' },
    ownerWithoutAdminRole: { uid: 'owner-1', token: { roles: {} }, companyId: 'co-1' },
    creatorWithoutAdminRole: { uid: 'creator-1', token: { roles: {} }, companyId: 'co-1' },
    recruiter: { uid: 'recruiter-1', token: { roles: { 'co-1': 'recruiter' } }, companyId: 'co-1' },
    hrUser: { uid: 'hr-1', token: { roles: { 'co-1': 'hr_user' } }, companyId: 'co-1' },
    otherCompanyAdmin: { uid: 'admin-2', token: { roles: { 'co-2': 'company_admin' } }, companyId: 'co-1' },
    deactivatedCompanyAdmin: { uid: 'off-admin-1', token: { roles: { 'co-off': 'company_admin' } }, companyId: 'co-off' },
    deactivatedCompanyOwner: { uid: 'off-owner-1', token: { roles: {} }, companyId: 'co-off' },
    superAdminOnDeactivated: { uid: 'super-1', token: { globalRole: 'super_admin', roles: { globalRole: 'super_admin' } }, companyId: 'co-off' },
};

const ALL = Object.keys(PEOPLE);
const allowing = (...who) => Object.fromEntries(ALL.map((name) => [name, who.includes(name)]));

/** The one rule now (`assertCompanyAdminStrict`). */
const STRICT = allowing(
    'superAdmin', 'companyAdmin', 'adminByTokenOnly', 'adminByMembershipOnly',
    'ownerWithoutAdminRole', 'creatorWithoutAdminRole', 'superAdminOnDeactivated',
);
const BY_MEMBERSHIP = allowing('superAdmin', 'companyAdmin', 'adminByMembershipOnly', 'superAdminOnDeactivated');
const BY_TOKEN = allowing('superAdmin', 'companyAdmin', 'adminByTokenOnly', 'superAdminOnDeactivated');

const BEFORE = {
    saveIntegrationConfig: BY_MEMBERSHIP,
    verifySmsConfig: BY_MEMBERSHIP,
    verifyLineConnection: BY_MEMBERSHIP,
    testLineConnection: BY_TOKEN,
    addPhoneLine: BY_TOKEN,
    removePhoneLine: BY_TOKEN,
    saveSmsLineAssignments: STRICT,
    sendTestSMS: STRICT,
};
const AFTER = Object.fromEntries(Object.keys(CALLS).map((name) => [name, STRICT]));

/** Whom K1 may newly let in: owners, and Company Admins the old check read from the other source. */
const K1_MAY_ADD = new Set(['ownerWithoutAdminRole', 'creatorWithoutAdminRole', 'adminByTokenOnly', 'adminByMembershipOnly']);

beforeEach(() => {
    mockTouched.length = 0;
    mockDocs.clear();
    mockMemberships.length = 0;
    mockClaims.clear();
    mockDocs.set('companies/co-1', { companyName: 'Artificial Freight', isActive: true, ownerId: 'owner-1', createdBy: 'creator-1' });
    mockDocs.set('companies/co-2', { companyName: 'Other Freight', isActive: true });
    mockDocs.set('companies/co-off', { companyName: 'Off Freight', isActive: false, ownerId: 'off-owner-1' });
    mockDocs.set('companies/co-1/integrations/sms_provider', { inventory: [{ phoneNumber: LINE }], config: {} });
    mockClaims.set('super-1', { globalRole: 'super_admin', roles: { globalRole: 'super_admin' } });
    for (const [uid, roles] of [
        ['admin-1', { 'co-1': 'company_admin' }], ['token-admin-1', { 'co-1': 'company_admin' }],
        ['recruiter-1', { 'co-1': 'recruiter' }], ['hr-1', { 'co-1': 'hr_user' }],
        ['admin-2', { 'co-2': 'company_admin' }], ['off-admin-1', { 'co-off': 'company_admin' }],
    ]) mockClaims.set(uid, { roles });
    mockMemberships.push(
        { userId: 'admin-1', companyId: 'co-1', role: 'company_admin' },
        { userId: 'member-admin-1', companyId: 'co-1', role: 'company_admin' },
        { userId: 'recruiter-1', companyId: 'co-1', role: 'recruiter' },
        { userId: 'hr-1', companyId: 'co-1', role: 'hr_user' },
        { userId: 'admin-2', companyId: 'co-2', role: 'company_admin' },
        { userId: 'off-admin-1', companyId: 'co-off', role: 'company_admin' },
    );
});

/** Whether the callable let this person through: it touched the SMS settings, and refused nothing. */
async function observe(name, person) {
    mockTouched.length = 0;
    const { uid, token, companyId } = PEOPLE[person];
    const outcome = await callables[name]({ auth: { uid, token }, data: CALLS[name](companyId) })
        .then(() => null, (error) => error);
    const refused = /admin|permission|deactivated/i.test(String(outcome?.message || ''));
    return mockTouched.length > 0 && !refused;
}

describe.each(Object.keys(CALLS))('%s', (name) => {
    it('lets in exactly whom the one SMS settings rule allows', async () => {
        const observed = {};
        for (const person of ALL) observed[person] = await observe(name, person);
        expect(observed).toEqual(AFTER[name]);
    });

    it('refuses a deactivated company with its reason, before touching anything', async () => {
        const { uid, token } = PEOPLE.deactivatedCompanyAdmin;
        const error = await callables[name]({ auth: { uid, token }, data: CALLS[name]('co-off') }).catch((e) => e);
        expect(error?.message).toBe('This company has been deactivated.');
        expect(mockTouched).toEqual([]);
    });

    it('refuses a recruiter and an HR user, touching nothing', async () => {
        for (const person of ['recruiter', 'hrUser']) {
            const { uid, token, companyId } = PEOPLE[person];
            const error = await callables[name]({ auth: { uid, token }, data: CALLS[name](companyId) }).catch((e) => e);
            expect(error?.message).toBe('Company admin access required.');
            expect(mockTouched).toEqual([]);
        }
    });
});

describe('K1: before and after', () => {
    it.each(Object.keys(CALLS))('%s takes no one away, and adds only owners and Company Admins', (name) => {
        for (const person of ALL) {
            if (BEFORE[name][person]) expect([person, AFTER[name][person]]).toEqual([person, true]);
            if (!BEFORE[name][person] && AFTER[name][person]) expect(K1_MAY_ADD.has(person)).toBe(true);
        }
    });

    it('lets the owner without an admin role save the provider, as it could already assign numbers', () => {
        expect(BEFORE.saveIntegrationConfig.ownerWithoutAdminRole).toBe(false);
        expect(BEFORE.saveSmsLineAssignments.ownerWithoutAdminRole).toBe(true);
        expect(AFTER.saveIntegrationConfig.ownerWithoutAdminRole).toBe(true);
    });
});
