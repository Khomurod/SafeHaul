/**
 * `deleteCompany`: only a signed-in super admin may call it, in either claim
 * shape. It deletes the company document with everything under it, the
 * company's memberships and no others, and the company's four Storage prefixes,
 * the preserved original application PDFs included. A failure is reported as
 * `internal` and leaves Storage alone. All data is artificial.
 */
jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    return { HttpsError, onCall: (opts, handler) => handler };
});
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (path, handler) => handler }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => handler }));

const mockState = {};
jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } },
        storage: () => ({
            bucket: () => ({
                deleteFiles: async ({ prefix }) => { mockState.events.push(['deleteFiles', prefix]); },
            }),
        }),
    },
    db: {
        collection: (name) => ({
            doc: (id) => ({ path: `${name}/${id}` }),
            where: (field, op, value) => ({
                get: async () => {
                    mockState.events.push(['query', name, field, op, value]);
                    const docs = mockState.memberships
                        .filter((entry) => op === '==' && entry[field] === value)
                        .map((entry) => ({ ref: { path: `${name}/${entry.id}` } }));
                    return { docs, forEach: (fn) => docs.forEach(fn) };
                },
            }),
        }),
        recursiveDelete: async (ref) => {
            mockState.events.push(['recursiveDelete', ref.path]);
            if (mockState.recursiveDeleteError) throw mockState.recursiveDeleteError;
        },
        batch: () => {
            const deletes = [];
            return {
                delete: (ref) => { deletes.push(ref.path); },
                commit: async () => { mockState.events.push(['batchDelete', ...deletes]); },
            };
        },
    },
}));

const { deleteCompany } = require('../../companyAdmin');

const SUPER_ROOT = { uid: 'owner-1', token: { globalRole: 'super_admin' } };
const SUPER_NESTED = { uid: 'owner-2', token: { roles: { globalRole: 'super_admin' } } };
const COMPANY_ADMIN = { uid: 'admin-1', token: { roles: { 'co-1': 'company_admin' } } };

const refusal = async (request) => {
    try {
        await deleteCompany(request);
    } catch (error) {
        return { code: error.code, message: error.message };
    }
    throw new Error('expected a refusal');
};

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockState.events = [];
    mockState.recursiveDeleteError = null;
    mockState.memberships = [
        { id: 'm-1', companyId: 'co-1', userId: 'u-1' },
        { id: 'm-2', companyId: 'co-1', userId: 'u-2' },
        { id: 'm-3', companyId: 'co-2', userId: 'u-1' },
    ];
});

afterEach(() => jest.restoreAllMocks());

describe('who may delete a company', () => {
    it('refuses a caller who is not signed in, and deletes nothing', async () => {
        expect(await refusal({ data: { companyId: 'co-1' } })).toEqual({
            code: 'unauthenticated', message: 'User must be logged in.',
        });
        expect(mockState.events).toEqual([]);
    });

    it("refuses the company's own admin, and deletes nothing", async () => {
        expect(await refusal({ auth: COMPANY_ADMIN, data: { companyId: 'co-1' } })).toEqual({
            code: 'permission-denied', message: 'Only Super Admins can delete companies.',
        });
        expect(mockState.events).toEqual([]);
    });

    it.each([
        [{}, '"companyId" is required'],
        [{ companyId: '' }, '"companyId" is not allowed to be empty'],
        [{ companyId: 'x'.repeat(101) }, '"companyId" length must be less than or equal to 100 characters long'],
        [{ companyId: 42 }, '"companyId" must be a string'],
    ])('refuses %j as an invalid argument, before asking who is calling', async (data, message) => {
        expect(await refusal({ auth: COMPANY_ADMIN, data })).toEqual({ code: 'invalid-argument', message });
        expect(mockState.events).toEqual([]);
    });
});

describe('what a super admin deletes', () => {
    it.each([['at the token root', SUPER_ROOT], ['inside roles', SUPER_NESTED]])(
        'deletes the company, its memberships and its files, for a super admin %s',
        async (_shape, auth) => {
            expect(await deleteCompany({ auth, data: { companyId: 'co-1' } })).toEqual({
                success: true, message: 'Company co-1 deleted.',
            });
            expect(mockState.events).toEqual([
                ['recursiveDelete', 'companies/co-1'],
                ['query', 'memberships', 'companyId', '==', 'co-1'],
                ['batchDelete', 'memberships/m-1', 'memberships/m-2'],
                ['deleteFiles', 'secure_documents/co-1/'],
                ['deleteFiles', 'company_assets/co-1/'],
                ['deleteFiles', 'companies/co-1/'],
                ['deleteFiles', 'application_originals/co-1/'],
            ]);
        },
    );

    it('reports a failed delete as internal and leaves Storage alone', async () => {
        mockState.recursiveDeleteError = new Error('deadline exceeded');

        expect(await refusal({ auth: SUPER_ROOT, data: { companyId: 'co-1' } })).toEqual({
            code: 'internal', message: 'Delete failed: deadline exceeded',
        });
        expect(mockState.events).toEqual([['recursiveDelete', 'companies/co-1']]);
    });
});
