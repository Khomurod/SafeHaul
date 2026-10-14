/**
 * Deactivating a company takes its roles out of its staff's sign-in tokens and
 * ends their sessions; re-activating puts the roles back. A super admin keeps
 * every role and every session.
 *
 * Firestore and Storage rules read only the token's `roles` (and
 * `companyTeamIds`), and `onMembershipWrite` rebuilt them from the memberships
 * alone, so a deactivated company's staff kept reading and writing its data
 * directly. All ids are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts, handler) => handler,
    onDocumentUpdated: (_opts, handler) => handler,
}));

const mockMemberships = [];
const mockCompanies = new Map();
const mockClaims = new Map();
const mockRevoked = [];
jest.mock('../../firebaseAdmin', () => {
    const db = {
        collection: (name) => {
            if (name === 'memberships') {
                return {
                    where: (field, _op, value) => ({
                        get: async () => {
                            const docs = mockMemberships
                                .filter((m) => m[field] === value)
                                .map((m, i) => ({ id: `m${i}`, data: () => m }));
                            return { docs, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
                        },
                    }),
                };
            }
            if (name === 'companies') {
                return {
                    doc: (id) => ({
                        get: async () => ({ exists: mockCompanies.has(id), data: () => mockCompanies.get(id) }),
                        update: async () => {},
                    }),
                };
            }
            return { doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) };
        },
    };
    return {
        db,
        admin: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
        auth: {
            getUser: async (uid) => ({ uid }),
            setCustomUserClaims: async (uid, claims) => { mockClaims.set(uid, claims); },
            revokeRefreshTokens: async (uid) => { mockRevoked.push(uid); },
        },
    };
});

const { onMembershipWrite, onCompanyActivationChange } = require('../../hrAdmin');

const OWNER_CLAIMS = { roles: { 'co-a': 'super_admin', globalRole: 'super_admin' } };

/** The company document changing from `before` to `after`. */
const change = (companyId, before, after) => {
    mockCompanies.set(companyId, after);
    return onCompanyActivationChange({ params: { companyId }, data: { before: { data: () => before }, after: { data: () => after } } });
};

beforeEach(() => {
    mockMemberships.length = 0;
    mockCompanies.clear();
    mockClaims.clear();
    mockRevoked.length = 0;
    mockMemberships.push(
        { userId: 'recruiter-1', companyId: 'co-a', role: 'recruiter' },
        { userId: 'recruiter-1', companyId: 'co-b', role: 'recruiter' },
        { userId: 'admin-1', companyId: 'co-a', role: 'company_admin' },
        { userId: 'owner-1', companyId: 'co-a', role: 'super_admin' },
    );
    mockCompanies.set('co-b', { companyName: 'B Freight', isActive: true });
});

describe('deactivating a company', () => {
    it("takes its roles out of its staff's tokens, keeping their other companies", async () => {
        await change('co-a', { isActive: true }, { isActive: false });

        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-b': 'recruiter' }, companyTeamIds: ['co-b'] });
        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });
    });

    it("ends its staff's sessions, never a super admin's", async () => {
        await change('co-a', { isActive: true }, { isActive: false });

        expect(mockRevoked.sort()).toEqual(['admin-1', 'recruiter-1']);
        expect(mockClaims.get('owner-1')).toEqual(OWNER_CLAIMS);
    });

    it('is not undone by a later membership write', async () => {
        await change('co-a', { isActive: true }, { isActive: false });
        await onMembershipWrite({ data: { before: { data: () => undefined }, after: { data: () => mockMemberships[0] } } });

        expect(mockClaims.get('recruiter-1').roles).toEqual({ 'co-b': 'recruiter' });
    });
});

describe('a membership written for a deactivated company', () => {
    it("leaves that company's role out of the token, and keeps a super admin's", async () => {
        mockCompanies.set('co-a', { isActive: false });
        await onMembershipWrite({ data: { before: { data: () => undefined }, after: { data: () => mockMemberships[0] } } });
        await onMembershipWrite({ data: { before: { data: () => undefined }, after: { data: () => mockMemberships[3] } } });

        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-b': 'recruiter' }, companyTeamIds: ['co-b'] });
        expect(mockClaims.get('owner-1')).toEqual(OWNER_CLAIMS);
    });
});

describe('re-activating a company', () => {
    it('puts the roles back and ends no session', async () => {
        mockCompanies.set('co-a', { isActive: false });
        await change('co-a', { isActive: false }, { isActive: true });

        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-a': 'recruiter', 'co-b': 'recruiter' }, companyTeamIds: ['co-a', 'co-b'] });
        expect(mockClaims.get('admin-1')).toEqual({ roles: { 'co-a': 'company_admin' }, companyTeamIds: ['co-a'] });
        expect(mockRevoked).toEqual([]);
    });
});

describe('any other change to the company', () => {
    it('leaves every token alone', async () => {
        await change('co-a', { isActive: true, teamMembers: [] }, { isActive: true, teamMembers: [{ userId: 'admin-1' }] });
        await change('co-a', { companyName: 'A' }, { companyName: 'A Freight' });

        expect(mockClaims.size).toBe(0);
        expect(mockRevoked).toEqual([]);
    });
});
