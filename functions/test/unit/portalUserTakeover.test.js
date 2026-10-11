/**
 * A company admin can manage their own team, never another person's login.
 *
 * Any company admin can attach an existing account to their company through
 * `createPortalUser` by email. That puts their company on the person's profile,
 * so a check of "is this user in my company" proves nothing about whose login it
 * is. These suites hold the two doors such an attachment used to open: changing
 * the person's login email (then resetting the password), and deleting the
 * person's account by "removing" them from the team.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: jest.fn(() => () => {}) }));

const mockUsers = new Map();
const mockMemberships = new Map();
const mockAuthUsers = new Map();
let mockAutoId = 0;

function mockMembershipQuery(filters) {
    return {
        where: (field, op, value) => mockMembershipQuery([...filters, [field, value]]),
        limit: () => mockMembershipQuery(filters),
        get: async () => {
            const docs = [...mockMemberships.entries()]
                .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
                .map(([id, data]) => ({ id, ref: { id, path: `memberships/${id}` }, data: () => ({ ...data }) }));
            return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb) => docs.forEach(cb) };
        },
    };
}

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts', delete: () => '__delete__' } } },
    db: {
        collection: (name) => {
            if (name === 'users') {
                return {
                    doc: (id) => ({
                        get: async () => ({ exists: mockUsers.has(id), data: () => ({ ...mockUsers.get(id) }) }),
                        set: async (data, opts) => mockUsers.set(id, { ...(opts?.merge ? mockUsers.get(id) : {}), ...data }),
                        update: async (data) => mockUsers.set(id, { ...mockUsers.get(id), ...data }),
                        delete: async () => mockUsers.delete(id),
                    }),
                };
            }
            if (name === 'memberships') {
                return {
                    ...mockMembershipQuery([]),
                    add: async (data) => {
                        mockAutoId += 1;
                        mockMemberships.set(`mem${mockAutoId}`, { ...data });
                        return { id: `mem${mockAutoId}` };
                    },
                };
            }
            // companies/{id}/integrations/sms_provider: no SMS lines in these tests.
            return {
                doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => null }) }) }) }),
            };
        },
        batch: () => {
            const deletes = [];
            return {
                delete: (ref) => deletes.push(ref.id),
                commit: async () => deletes.forEach((id) => mockMemberships.delete(id)),
            };
        },
    },
    auth: {
        getUserByEmail: async (email) => {
            const found = [...mockAuthUsers.values()].find((user) => user.email === email);
            if (!found) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
            return found;
        },
        createUser: async ({ email, displayName }) => {
            const uid = `new-${email}`;
            mockAuthUsers.set(uid, { uid, email, displayName });
            return { uid };
        },
        updateUser: jest.fn(async (uid, data) => mockAuthUsers.set(uid, { ...mockAuthUsers.get(uid), ...data })),
        deleteUser: jest.fn(async (uid) => mockAuthUsers.delete(uid)),
    },
}));

const { auth } = require('../../firebaseAdmin');
const { createPortalUser, deletePortalUser, updatePortalUser } = require('../../hrAdmin');

const req = (uid, roles, data) => ({ auth: { uid, token: { roles } }, data });
const ADMIN_OF_X = ['admin-x', { 'co-x': 'company_admin' }];
const OWNER = ['owner-uid', { globalRole: 'super_admin', 'co-home': 'super_admin' }];

beforeEach(() => {
    mockUsers.clear();
    mockMemberships.clear();
    mockAuthUsers.clear();
    mockAutoId = 0;
    auth.updateUser.mockClear();
    auth.deleteUser.mockClear();
    // The platform owner, and a driver who signed up elsewhere.
    mockAuthUsers.set('owner-uid', {
        uid: 'owner-uid', email: 'owner@safehaul.test', customClaims: { roles: { globalRole: 'super_admin', 'co-home': 'super_admin' } },
    });
    mockUsers.set('owner-uid', { name: 'Platform Owner', email: 'owner@safehaul.test', companyIds: ['co-home'] });
    mockMemberships.set('m-owner', { userId: 'owner-uid', companyId: 'co-home', role: 'super_admin' });
    mockAuthUsers.set('driver-uid', { uid: 'driver-uid', email: 'driver@example.test', customClaims: {} });
    mockUsers.set('driver-uid', { name: 'Dana Driver', email: 'driver@example.test' });
});

/** What `onMembershipWrite` does after a membership lands: the company joins the profile. */
function mirrorMembership(userId, companyId) {
    const profile = mockUsers.get(userId) || {};
    mockUsers.set(userId, { ...profile, companyIds: [...new Set([...(profile.companyIds || []), companyId])] });
}

describe('changing a login email', () => {
    it('is refused to a company admin, even for a person attached to their company', async () => {
        // The owner attached to carrier X, by whatever route.
        mockMemberships.set('m-attached', { userId: 'owner-uid', companyId: 'co-x', role: 'hr_user' });
        mirrorMembership('owner-uid', 'co-x');

        await expect(updatePortalUser(req(...ADMIN_OF_X, { userId: 'owner-uid', companyId: 'co-x', email: 'attacker@evil.test' })))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(auth.updateUser).not.toHaveBeenCalled();
        expect(mockAuthUsers.get('owner-uid').email).toBe('owner@safehaul.test');
    });

    it('is refused to a company admin for their own recruiter too: only the Super Admin edits logins', async () => {
        mockAuthUsers.set('rec-uid', { uid: 'rec-uid', email: 'rec@x.test' });
        mockUsers.set('rec-uid', { name: 'Rae', companyIds: ['co-x'] });
        await expect(updatePortalUser(req(...ADMIN_OF_X, { userId: 'rec-uid', companyId: 'co-x', name: 'Rae B.' })))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('still works for the Super Admin', async () => {
        mockAuthUsers.set('rec-uid', { uid: 'rec-uid', email: 'rec@x.test' });
        mockUsers.set('rec-uid', { name: 'Rae', companyIds: ['co-x'] });
        const res = await updatePortalUser(req(...OWNER, { userId: 'rec-uid', name: 'Rae B.', email: 'rae@x.test' }));
        expect(res.success).toBe(true);
        expect(auth.updateUser).toHaveBeenCalledWith('rec-uid', { displayName: 'Rae B.', email: 'rae@x.test' });
        expect(mockUsers.get('rec-uid')).toMatchObject({ name: 'Rae B.', email: 'rae@x.test' });
    });

    it('works for a Super Admin whose claim sits at the token root (legacy shape)', async () => {
        mockAuthUsers.set('rec-uid', { uid: 'rec-uid', email: 'rec@x.test' });
        mockUsers.set('rec-uid', { name: 'Rae' });
        const legacyOwner = { auth: { uid: 'owner-uid', token: { globalRole: 'super_admin' } }, data: { userId: 'rec-uid', name: 'Rae B.' } };
        await expect(updatePortalUser(legacyOwner)).resolves.toMatchObject({ success: true });
    });
});

describe('removing a person from a team', () => {
    it('never deletes their login or profile when a company admin removes them', async () => {
        // A driver attached to carrier X, who belongs to no other company.
        await createPortalUser(req(...ADMIN_OF_X, { email: 'driver@example.test', companyId: 'co-x', role: 'recruiter' }));
        mirrorMembership('driver-uid', 'co-x');

        const res = await deletePortalUser(req(...ADMIN_OF_X, { userId: 'driver-uid', companyId: 'co-x' }));

        expect(res.message).toMatch(/removed/i);
        expect(auth.deleteUser).not.toHaveBeenCalled();
        expect(mockAuthUsers.has('driver-uid')).toBe(true);
        expect(mockUsers.has('driver-uid')).toBe(true);
        expect([...mockMemberships.values()].some((m) => m.userId === 'driver-uid' && m.companyId === 'co-x')).toBe(false);
    });

    it('keeps the Super Admin removing someone from a company exactly as before: the last membership takes the login', async () => {
        mockAuthUsers.set('rec-uid', { uid: 'rec-uid', email: 'rec@x.test' });
        mockUsers.set('rec-uid', { name: 'Rae' });
        mockMemberships.set('m-rec', { userId: 'rec-uid', companyId: 'co-x', role: 'recruiter' });

        const res = await deletePortalUser(req(...OWNER, { userId: 'rec-uid', companyId: 'co-x' }));

        expect(res.message).toMatch(/account deleted/i);
        expect(auth.deleteUser).toHaveBeenCalledWith('rec-uid');
        expect(mockUsers.has('rec-uid')).toBe(false);
    });

    it('keeps the Super Admin force delete as before', async () => {
        mockAuthUsers.set('rec-uid', { uid: 'rec-uid', email: 'rec@x.test' });
        mockUsers.set('rec-uid', { name: 'Rae' });
        mockMemberships.set('m-rec', { userId: 'rec-uid', companyId: 'co-x', role: 'recruiter' });

        const res = await deletePortalUser(req(...OWNER, { userId: 'rec-uid' }));

        expect(res.message).toMatch(/completely deleted/i);
        expect(auth.deleteUser).toHaveBeenCalledWith('rec-uid');
        expect(mockMemberships.has('m-rec')).toBe(false);
    });
});

describe('adding an existing account to a team', () => {
    it('refuses a company admin who names a Super Admin', async () => {
        await expect(createPortalUser(req(...ADMIN_OF_X, { email: 'owner@safehaul.test', companyId: 'co-x', role: 'hr_user' })))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect([...mockMemberships.values()].some((m) => m.userId === 'owner-uid' && m.companyId === 'co-x')).toBe(false);
    });

    it('refuses a new Super Admin whose claims the membership trigger has not rebuilt yet', async () => {
        mockAuthUsers.set('fresh-uid', { uid: 'fresh-uid', email: 'fresh@safehaul.test', customClaims: {} });
        mockMemberships.set('m-fresh', { userId: 'fresh-uid', companyId: 'co-home', role: 'super_admin' });
        await expect(createPortalUser(req(...ADMIN_OF_X, { email: 'fresh@safehaul.test', companyId: 'co-x', role: 'hr_user' })))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect([...mockMemberships.values()].some((m) => m.userId === 'fresh-uid' && m.companyId === 'co-x')).toBe(false);
    });

    it('refuses a Super Admin whose claim sits at the token root (legacy shape) too', async () => {
        mockAuthUsers.set('legacy-owner', { uid: 'legacy-owner', email: 'legacy@safehaul.test', customClaims: { globalRole: 'super_admin' } });
        await expect(createPortalUser(req(...ADMIN_OF_X, { email: 'legacy@safehaul.test', companyId: 'co-x', role: 'hr_user' })))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('adds an existing account without handing back its user id, and says its password is unchanged', async () => {
        const res = await createPortalUser(req(...ADMIN_OF_X, {
            fullName: 'Dana Driver', email: 'driver@example.test', password: 'Typed-But-Ignored1', companyId: 'co-x', role: 'recruiter',
        }));
        expect(res.userId).toBeUndefined();
        expect(res.message).toMatch(/existing password/i);
        expect([...mockMemberships.values()]).toContainEqual(expect.objectContaining({ userId: 'driver-uid', companyId: 'co-x', role: 'recruiter' }));
    });

    it('still returns the new user id when it created the account', async () => {
        const res = await createPortalUser(req(...ADMIN_OF_X, {
            fullName: 'New Hire', email: 'new@x.test', password: 'Str0ng-Pass!', companyId: 'co-x', role: 'recruiter',
        }));
        expect(res.userId).toBe('new-new@x.test');
        expect(res.message).toBe('User created successfully.');
    });

    it('lets the Super Admin add another Super Admin to a company', async () => {
        const res = await createPortalUser(req(...OWNER, { email: 'owner@safehaul.test', companyId: 'co-x', role: 'company_admin' }));
        expect(res.status).toBe('success');
    });
});
