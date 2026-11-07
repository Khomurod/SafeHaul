/**
 * `syncPublicProfile` writes a company's public profile only when the
 * projection would change what the profile holds. A company write that changes
 * nothing it shows (the team list, a setting it does not carry) leaves the
 * profile and its `updatedAt` alone; the first profile, a change, an older
 * projection version and a profile that cannot be read are written as before.
 * All companies and values are artificial.
 */
jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    return { HttpsError, onCall: (opts, handler) => handler };
});
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (path, handler) => handler }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => handler }));

const mockDelete = { mockDeleteSentinel: true };
const mockProfiles = { stored: new Map(), readFails: false, sets: [], deletes: [], reads: [] };
jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts-now', delete: () => mockDelete } } },
    db: {
        collection: (name) => ({
            doc: (id) => ({
                get: async () => {
                    mockProfiles.reads.push(`${name}/${id}`);
                    if (mockProfiles.readFails) throw new Error('firestore unavailable');
                    const data = mockProfiles.stored.get(id);
                    return { exists: data !== undefined, data: () => data };
                },
                set: async (data, options) => { mockProfiles.sets.push({ path: `${name}/${id}`, data, options }); },
                delete: async () => { mockProfiles.deletes.push(`${name}/${id}`); },
            }),
        }),
    },
}));

const { syncPublicProfile } = require('../../companyAdmin');
const { buildPublicProfileDto } = require('../../shared/publicProfileDto');

const COMPANY = {
    companyName: 'Artificial Freight',
    appSlug: 'artificial-freight',
    applicationConfig: { ssn: 'required', dob: 'optional' },
    customQuestions: [{ id: 'q-1', label: 'Artificial question?' }],
    postApplicationTemplates: [{ templateId: 'tpl-1', title: 'W-9' }],
    teamMembers: [{ userId: 'u-1', role: 'recruiter', name: 'Ann Artificial', email: 'ann@example.test' }],
    features: { pev: false },
};

/** The profile as an earlier write stored it: no delete sentinels left, an older timestamp. */
const storedProfileOf = (company) => buildPublicProfileDto(company, { seconds: 1700000000 });

const fire = (after, before = COMPANY) => syncPublicProfile({
    params: { companyId: 'co-1' },
    data: {
        before: { exists: Boolean(before), data: () => before },
        after: { exists: Boolean(after), data: () => after },
    },
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(mockProfiles, { stored: new Map(), readFails: false, sets: [], deletes: [], reads: [] });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('syncPublicProfile', () => {
    it('writes the first profile of a company', async () => {
        await fire(COMPANY, null);

        expect(mockProfiles.sets).toHaveLength(1);
        expect(mockProfiles.sets[0]).toMatchObject({ path: 'public_profiles/co-1', options: { merge: true } });
        expect(mockProfiles.sets[0].data).toMatchObject({ companyName: 'Artificial Freight', updatedAt: 'ts-now' });
    });

    it('leaves the profile alone when the company changed only what the profile does not carry', async () => {
        mockProfiles.stored.set('co-1', storedProfileOf(COMPANY));

        await fire({ ...COMPANY, teamMembers: [], features: { pev: true } });

        expect(mockProfiles.reads).toEqual(['public_profiles/co-1']);
        expect(mockProfiles.sets).toEqual([]);
    });

    it('does not count a newer timestamp alone as a change', async () => {
        mockProfiles.stored.set('co-1', { ...storedProfileOf(COMPANY), updatedAt: { seconds: 1 } });

        await fire(COMPANY);

        expect(mockProfiles.sets).toEqual([]);
    });

    it('writes the profile when something it shows changed', async () => {
        mockProfiles.stored.set('co-1', storedProfileOf(COMPANY));

        await fire({ ...COMPANY, companyName: 'Renamed Artificial Freight' });

        expect(mockProfiles.sets).toHaveLength(1);
        expect(mockProfiles.sets[0].data.companyName).toBe('Renamed Artificial Freight');
    });

    it('writes the profile when a gate the profile still holds was turned off', async () => {
        mockProfiles.stored.set('co-1', storedProfileOf(COMPANY));

        await fire({ ...COMPANY, applicationConfig: { ssn: 'required' } });

        expect(mockProfiles.sets).toHaveLength(1);
        expect(mockProfiles.sets[0].data.applicationConfig.dob).toBe(mockDelete);
    });

    it('writes a profile of an older projection version', async () => {
        mockProfiles.stored.set('co-1', { ...storedProfileOf(COMPANY), dtoVersion: 1 });

        await fire(COMPANY);

        expect(mockProfiles.sets).toHaveLength(1);
    });

    it('writes the profile when it cannot be read first', async () => {
        mockProfiles.readFails = true;

        await fire(COMPANY);

        expect(mockProfiles.sets).toHaveLength(1);
    });

    it('deletes the profile of a deleted company, reading nothing', async () => {
        await fire(null);

        expect(mockProfiles.deletes).toEqual(['public_profiles/co-1']);
        expect(mockProfiles.reads).toEqual([]);
        expect(mockProfiles.sets).toEqual([]);
    });
});
