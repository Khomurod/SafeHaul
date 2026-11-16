/**
 * `enforceFeatureSchedules` (every 15 minutes) switches off each feature whose
 * scheduled switch-off has passed and clears that schedule. It reads only the
 * companies' `featureSchedules`, never the whole company documents. All
 * companies are artificial.
 */
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, handler) => handler }));

const mockState = { companies: [], selects: [], fullReads: 0, updates: [], commits: 0 };
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name) => {
            if (name !== 'companies') throw new Error(`unexpected collection ${name}`);
            const answer = (fields) => ({
                docs: mockState.companies.map(({ id, ...data }) => ({
                    id,
                    ref: { path: `companies/${id}` },
                    data: () => (fields ? Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]])) : data),
                })),
            });
            return {
                select: (...fields) => {
                    mockState.selects.push(fields);
                    return { get: async () => answer(fields) };
                },
                get: async () => {
                    mockState.fullReads += 1;
                    return answer(null);
                },
            };
        },
        batch: () => ({
            update: (ref, data) => { mockState.updates.push([ref.path, data]); },
            commit: async () => { mockState.commits += 1; },
        }),
    }),
}));

const { enforceFeatureSchedules } = require('../../featureScheduler');

const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    Object.assign(mockState, { companies: [], selects: [], fullReads: 0, updates: [], commits: 0 });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('enforceFeatureSchedules', () => {
    it('reads only the feature schedules of the companies', async () => {
        mockState.companies = [{ id: 'co-1', companyName: 'Artificial Freight', teamMembers: [], featureSchedules: { pev: FUTURE } }];

        await enforceFeatureSchedules();

        expect(mockState.selects).toEqual([['featureSchedules']]);
        expect(mockState.fullReads).toBe(0);
    });

    it('switches off each feature whose time has passed and clears its schedule, leaving the rest', async () => {
        mockState.companies = [
            { id: 'co-1', featureSchedules: { pev: PAST, eDocs: FUTURE, importLeads: null } },
            { id: 'co-2', featureSchedules: { campaignsEnabled: PAST } },
            { id: 'co-3' },
        ];

        await enforceFeatureSchedules();

        expect(mockState.updates).toEqual([
            ['companies/co-1', { 'features.pev': false, 'featureSchedules.pev': null }],
            ['companies/co-2', { 'features.campaignsEnabled': false, 'featureSchedules.campaignsEnabled': null }],
        ]);
        expect(mockState.commits).toBe(1);
    });

    it('writes nothing when no switch-off is due', async () => {
        mockState.companies = [{ id: 'co-1', featureSchedules: { pev: FUTURE } }, { id: 'co-2' }];

        await enforceFeatureSchedules();

        expect(mockState.updates).toEqual([]);
        expect(mockState.commits).toBe(0);
    });
});
