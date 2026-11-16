'use strict';

/**
 * The dashboard counters are recounted every day: each company's applications,
 * leads and hired applications are counted on the server and set on
 * `internal_stats/dashboard` with `reconciledAt`, so a counter that drifted (one
 * that began after records existed, a trigger delivered twice) is put right
 * within a day. The browser trusts a counter only once it has been recounted.
 *
 * Every id below is artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_opts, handler) => handler }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, handler) => handler }));

const mockState = { companies: [], counts: {}, failCompany: null, writes: [] };
jest.mock('../../firebaseAdmin', () => {
  const countOf = (path) => ({
    count: () => ({
      get: async () => {
        const companyId = path.split('/')[1];
        if (companyId === mockState.failCompany) throw new Error('unavailable');
        return { data: () => ({ count: mockState.counts[path] ?? 0 }) };
      },
    }),
  });
  const collectionAt = (path) => ({
    ...countOf(path),
    where: (field, op, value) => countOf(`${path}?${field} ${op} ${JSON.stringify(value)}`),
    doc: (id) => docAt(`${path}/${id}`),
    select: () => ({ get: async () => ({ docs: mockState.companies.map((id) => ({ id })) }) }),
  });
  const docAt = (path) => ({
    collection: (name) => collectionAt(`${path}/${name}`),
    set: async (data, options) => { mockState.writes.push({ path, data, options }); },
  });
  return {
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', increment: (n) => ({ increment: n }) } } },
    db: { collection: (name) => collectionAt(name) },
  };
});

const { reconcileDashboardStatsDaily } = require('../../dashboardStatsRollup');

const HIRED = 'status in ["Hired","Approved"]';

beforeEach(() => {
  mockState.companies = ['c1', 'c2'];
  mockState.counts = {
    'companies/c1/applications': 112,
    'companies/c1/leads': 4210,
    [`companies/c1/applications?${HIRED}`]: 51,
    'companies/c2/applications': 3,
  };
  mockState.failCompany = null;
  mockState.writes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('the daily recount of the dashboard counters', () => {
  it("sets every company's counters from a count of its records, marked recounted", async () => {
    await reconcileDashboardStatsDaily();

    expect(mockState.writes).toEqual([
      {
        path: 'companies/c1/internal_stats/dashboard',
        data: {
          applicationsTotal: 112, leadsTotal: 4210, hiredTotal: 51,
          schemaVersion: 1, updatedAt: 'SERVER_TIMESTAMP', reconciledAt: 'SERVER_TIMESTAMP',
        },
        options: { merge: true },
      },
      {
        path: 'companies/c2/internal_stats/dashboard',
        data: {
          applicationsTotal: 3, leadsTotal: 0, hiredTotal: 0,
          schemaVersion: 1, updatedAt: 'SERVER_TIMESTAMP', reconciledAt: 'SERVER_TIMESTAMP',
        },
        options: { merge: true },
      },
    ]);
  });

  it('goes on with the other companies when one cannot be counted, and names it by id only', async () => {
    mockState.failCompany = 'c1';
    await reconcileDashboardStatsDaily();

    expect(mockState.writes.map((write) => write.path)).toEqual(['companies/c2/internal_stats/dashboard']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('c1'), 'unavailable');
  });

  it('recounts the companies after the first ten, past a failure among them', async () => {
    mockState.companies = Array.from({ length: 11 }, (_, i) => `c${i + 1}`);
    mockState.failCompany = 'c1';
    await reconcileDashboardStatsDaily();

    expect(mockState.writes).toHaveLength(10);
    expect(mockState.writes.map((write) => write.path)).toContain('companies/c11/internal_stats/dashboard');
  });
});
