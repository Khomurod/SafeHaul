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
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, handler) => handler }));

const mockMemberships = [];
const mockCompanies = new Map();
const mockClaims = new Map();
const mockRevoked = [];
const mockGetUserFailures = new Map(); // uid -> tries that fail before one succeeds
const mockRevokeFailures = new Map(); // uid -> revocations that fail before one succeeds
const mockOnClaimsWrite = { fn: null };
const mockClaimsWriteFailures = new Set(); // uids whose claims can never be written
const mockJobs = new Map();
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
                // Only what the hourly pass asks: chosen fields, in id order, from a cursor, a page at a time.
                const query = ({ fields, from = () => true, max = Infinity }) => ({
                    orderBy: (field) => {
                        if (field !== '__name__') throw new Error(`unexpected order ${field}`);
                        return query({ fields, from, max });
                    },
                    startAt: (cursor) => query({ fields, from: (id) => id >= cursor, max }),
                    startAfter: (cursor) => query({ fields, from: (id) => id > cursor, max }),
                    limit: (n) => query({ fields, from, max: n }),
                    get: async () => {
                        const docs = [...mockCompanies.keys()].sort()
                            .filter(from)
                            .slice(0, max)
                            .map((id) => {
                                const data = mockCompanies.get(id);
                                return { id, data: () => Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]])) };
                            });
                        return { docs, size: docs.length, empty: docs.length === 0 };
                    },
                });
                return {
                    select: (...fields) => query({ fields }),
                    doc: (id) => ({
                        get: async () => ({ exists: mockCompanies.has(id), data: () => mockCompanies.get(id) }),
                        update: async () => {},
                    }),
                };
            }
            if (name === 'system_jobs') {
                return {
                    doc: (id) => ({
                        get: async () => ({ exists: mockJobs.has(id), data: () => mockJobs.get(id) }),
                        set: async (data, opts) => { mockJobs.set(id, opts?.merge ? { ...mockJobs.get(id), ...data } : data); },
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
            getUser: async (uid) => {
                const failures = mockGetUserFailures.get(uid) || 0;
                if (failures > 0) {
                    mockGetUserFailures.set(uid, failures - 1);
                    throw Object.assign(new Error('auth unavailable'), { code: 'auth/internal-error' });
                }
                return { uid, customClaims: mockClaims.get(uid) };
            },
            getUsers: async (identifiers) => {
                if (identifiers.length > 100) throw new Error('at most 100 identifiers');
                return { users: identifiers.map(({ uid }) => ({ uid, customClaims: mockClaims.get(uid) })), notFound: [] };
            },
            setCustomUserClaims: async (uid, claims) => {
                if (mockClaimsWriteFailures.has(uid)) throw Object.assign(new Error('claims too large'), { code: 'auth/claims-too-large' });
                mockClaims.set(uid, claims);
                if (mockOnClaimsWrite.fn) mockOnClaimsWrite.fn(uid);
            },
            revokeRefreshTokens: async (uid) => {
                const failures = mockRevokeFailures.get(uid) || 0;
                if (failures > 0) {
                    mockRevokeFailures.set(uid, failures - 1);
                    throw Object.assign(new Error('auth unavailable'), { code: 'auth/internal-error' });
                }
                mockRevoked.push(uid);
            },
        },
    };
});

const { onMembershipWrite, onCompanyActivationChange, reconcileCompanyClaims } = require('../../hrAdmin');
const { __test: { timing } } = require('../../hrAdmin/companyActivation');

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
    mockGetUserFailures.clear();
    mockRevokeFailures.clear();
    mockOnClaimsWrite.fn = null;
    mockClaimsWriteFailures.clear();
    mockJobs.clear();
    timing.wait = async () => {};
    timing.now = () => 0;
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

describe('a change racing the claims write', () => {
    it('rewrites the claims when the company changed after they were worked out', async () => {
        mockCompanies.set('co-a', { isActive: true });
        mockOnClaimsWrite.fn = (uid) => {
            if (uid === 'recruiter-1') { mockOnClaimsWrite.fn = null; mockCompanies.set('co-a', { isActive: false }); }
        };
        await onCompanyActivationChange({
            params: { companyId: 'co-a' },
            data: { before: { data: () => ({ isActive: false }) }, after: { data: () => ({ isActive: true }) } },
        });

        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-b': 'recruiter' }, companyTeamIds: ['co-b'] });
        expect(mockRevoked).toContain('recruiter-1');
    });

    it('still ends the session when that revocation failed and the next try finds nothing to change', async () => {
        mockCompanies.set('co-a', { isActive: true });
        mockOnClaimsWrite.fn = (uid) => {
            if (uid === 'recruiter-1') { mockOnClaimsWrite.fn = null; mockCompanies.set('co-a', { isActive: false }); }
        };
        mockRevokeFailures.set('recruiter-1', 1);
        await onCompanyActivationChange({
            params: { companyId: 'co-a' },
            data: { before: { data: () => ({ isActive: false }) }, after: { data: () => ({ isActive: true }) } },
        });

        expect(mockClaims.get('recruiter-1').roles).toEqual({ 'co-b': 'recruiter' });
        expect(mockRevoked).toContain('recruiter-1');
    });

    it('still ends the session when the claims kept changing until a try gave up, and the next try is quiet', async () => {
        mockCompanies.set('co-a', { isActive: true });
        // co-a is turned off, on and off again by recruiter-1's first three writes.
        let writes = 0;
        mockOnClaimsWrite.fn = (uid) => {
            if (uid !== 'recruiter-1' || writes === 3) return;
            writes += 1;
            mockCompanies.set('co-a', { isActive: writes === 2 });
        };
        await onCompanyActivationChange({
            params: { companyId: 'co-a' },
            data: { before: { data: () => ({ isActive: false }) }, after: { data: () => ({ isActive: true }) } },
        });

        expect(writes).toBe(3);
        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-b': 'recruiter' }, companyTeamIds: ['co-b'] });
        expect(mockRevoked).toEqual(['recruiter-1']);
    });
});

describe('a member whose claims cannot be written at once', () => {
    it('is tried again in the same run', async () => {
        mockGetUserFailures.set('admin-1', 2);
        await change('co-a', { isActive: true }, { isActive: false });

        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });
        expect(mockRevoked).toContain('admin-1');
    });

    it('is fixed by the hourly pass when every try failed', async () => {
        mockGetUserFailures.set('admin-1', 3);
        mockClaims.set('admin-1', { roles: { 'co-a': 'company_admin' }, companyTeamIds: ['co-a'] });
        await change('co-a', { isActive: true }, { isActive: false });
        expect(mockClaims.get('admin-1').roles).toEqual({ 'co-a': 'company_admin' });

        mockRevoked.length = 0;
        await reconcileCompanyClaims();

        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });
        expect(mockRevoked).toEqual(['admin-1']);
    });
});

describe('the hourly pass', () => {
    it("removes a deactivated company's role still in a token, and leaves super admins and clean tokens alone", async () => {
        // Deactivated before the trigger existed: recruiter-1 still carries co-a.
        mockCompanies.set('co-a', { isActive: false });
        mockClaims.set('recruiter-1', { roles: { 'co-a': 'recruiter', 'co-b': 'recruiter' }, companyTeamIds: ['co-a', 'co-b'] });
        mockClaims.set('admin-1', { roles: {} });
        mockClaims.set('owner-1', OWNER_CLAIMS);

        await reconcileCompanyClaims();

        expect(mockClaims.get('recruiter-1')).toEqual({ roles: { 'co-b': 'recruiter' }, companyTeamIds: ['co-b'] });
        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });
        expect(mockClaims.get('owner-1')).toEqual(OWNER_CLAIMS);
        expect(mockRevoked).toEqual(['recruiter-1']);
    });
});

describe('the hourly pass, for an active company', () => {
    it('puts back a role a re-activation could not restore, and ends no session', async () => {
        mockCompanies.set('co-a', { isActive: true });
        mockClaims.set('admin-1', { roles: {} });
        // Every try of the re-activation fails for admin-1.
        mockGetUserFailures.set('admin-1', 3);
        await onCompanyActivationChange({
            params: { companyId: 'co-a' },
            data: { before: { data: () => ({ isActive: false }) }, after: { data: () => ({ isActive: true }) } },
        });
        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });

        await reconcileCompanyClaims();

        expect(mockClaims.get('admin-1')).toEqual({ roles: { 'co-a': 'company_admin' }, companyTeamIds: ['co-a'] });
        expect(mockRevoked).toEqual([]);
    });
});

describe('the hourly pass, for a company deactivated by its status', () => {
    it('finds it as the trigger does, without isActive', async () => {
        mockCompanies.set('co-a', { status: 'Suspended' });
        mockClaims.set('admin-1', { roles: { 'co-a': 'company_admin' }, companyTeamIds: ['co-a'] });

        await reconcileCompanyClaims();

        expect(mockClaims.get('admin-1')).toEqual({ roles: {} });
        expect(mockRevoked).toEqual(['admin-1']);
    });
});

describe('the hourly pass, out of time', () => {
    const stale = (companyId) => ({ roles: { [companyId]: 'hr_user' }, companyTeamIds: [companyId] });

    it('continues the next run where the last one stopped, then starts again from the first company', async () => {
        mockMemberships.push(
            { userId: 'hr-3', companyId: 'co-c', role: 'hr_user' },
            { userId: 'hr-4', companyId: 'co-d', role: 'hr_user' },
        );
        mockCompanies.set('co-c', { isActive: false });
        mockCompanies.set('co-d', { isActive: false });
        mockClaims.set('hr-3', stale('co-c'));
        mockClaims.set('hr-4', stale('co-d'));
        // The run's time runs out while co-c's member is re-synced.
        let clock = 0;
        timing.now = () => clock;
        mockOnClaimsWrite.fn = (uid) => { if (uid === 'hr-3') clock = Number.POSITIVE_INFINITY; };

        await reconcileCompanyClaims();

        expect(mockRevoked).toEqual(['hr-3']);
        expect(mockClaims.get('hr-4')).toEqual(stale('co-d'));
        expect(mockJobs.get('companyClaims')).toMatchObject({ resumeCompanyId: 'co-d', resumeAfterUserId: null });

        // co-c's role back in hr-3's token: a run that starts at co-d leaves it there.
        mockOnClaimsWrite.fn = null;
        clock = 0;
        mockClaims.set('hr-3', stale('co-c'));
        await reconcileCompanyClaims();

        expect(mockClaims.get('hr-4')).toEqual({ roles: {} });
        expect(mockClaims.get('hr-3')).toEqual(stale('co-c'));
        expect(mockJobs.get('companyClaims')).toMatchObject({ resumeCompanyId: null, resumeAfterUserId: null });

        // That walk was complete, so the next run starts again from the first company.
        await reconcileCompanyClaims();

        expect(mockClaims.get('hr-3')).toEqual({ roles: {} });
        expect(mockRevoked).toEqual(['hr-3', 'hr-4', 'hr-3']);
    });

    it('never lets a company whose members keep failing hold back the later ones', async () => {
        // 40 members of co-c whose claims cannot be written: each spends its tries' 8 s of waits.
        const failing = Array.from({ length: 40 }, (_, i) => `hr-c${String(i + 1).padStart(2, '0')}`);
        failing.forEach((userId) => {
            mockMemberships.push({ userId, companyId: 'co-c', role: 'hr_user' });
            mockClaims.set(userId, stale('co-c'));
            mockClaimsWriteFailures.add(userId);
        });
        mockMemberships.push({ userId: 'hr-4', companyId: 'co-d', role: 'hr_user' });
        mockCompanies.set('co-c', { isActive: false });
        mockCompanies.set('co-d', { isActive: false });
        mockClaims.set('hr-4', stale('co-d'));
        let clock = 0;
        timing.now = () => clock;
        timing.wait = async (ms) => { clock += ms; };

        await reconcileCompanyClaims();

        // 240 s of waits: 30 members, then the run stops inside co-c.
        expect(mockJobs.get('companyClaims')).toMatchObject({ resumeCompanyId: 'co-c', resumeAfterUserId: 'hr-c30' });
        expect(mockClaims.get('hr-4')).toEqual(stale('co-d'));

        await reconcileCompanyClaims();

        expect(mockClaims.get('hr-4')).toEqual({ roles: {} });
        expect(mockRevoked).toEqual(['hr-4']);
        expect(mockJobs.get('companyClaims')).toMatchObject({ resumeCompanyId: null, resumeAfterUserId: null });
    });

    it('reads every page of companies', async () => {
        for (let i = 0; i < 250; i += 1) mockCompanies.set(`co-p${String(i).padStart(3, '0')}`, { isActive: true });
        mockCompanies.set('co-z', { isActive: false });
        mockMemberships.push({ userId: 'hr-z', companyId: 'co-z', role: 'hr_user' });
        mockClaims.set('hr-z', stale('co-z'));

        await reconcileCompanyClaims();

        expect(mockClaims.get('hr-z')).toEqual({ roles: {} });
        expect(mockJobs.get('companyClaims')).toMatchObject({ resumeCompanyId: null, resumeAfterUserId: null });
    });
});
