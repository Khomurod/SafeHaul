'use strict';

/**
 * The server records the hire date: when an application's status enters a hired
 * status (`Hired`, `Approved`) by any write, the application write trigger stamps
 * `hiredAt` with that write's time (the event's), so a hire made just before
 * midnight stays in its own month. A save while already hired does not move it,
 * leaving hired keeps it, and coming back sets it again. Its own write neither
 * re-stamps nor moves the dashboard counters, and a lead never gets one.
 *
 * Every id below is artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_opts, handler) => handler }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, handler) => handler }));
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, handler) => handler,
  HttpsError: class HttpsError extends Error {},
}));

const mockStore = { docs: {}, updates: [], sets: [], failTransaction: false };
jest.mock('../../firebaseAdmin', () => {
  const collectionAt = (path) => ({ doc: (id) => docAt(`${path}/${id}`) });
  const docAt = (path) => ({
    path,
    collection: (name) => collectionAt(`${path}/${name}`),
    set: async (data, options) => { mockStore.sets.push({ path, data, options }); },
  });
  return {
    admin: {
      firestore: {
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', increment: (n) => ({ increment: n }) },
        Timestamp: { fromMillis: (ms) => ({ writtenAt: ms }) },
      },
    },
    db: {
      collection: (name) => collectionAt(name),
      runTransaction: async (callback) => {
        if (mockStore.failTransaction) throw new Error('aborted');
        return callback({
          get: async (ref) => ({ exists: ref.path in mockStore.docs, data: () => mockStore.docs[ref.path] }),
          update: (ref, data) => { mockStore.updates.push({ path: ref.path, data }); },
        });
      },
    },
  };
});

const {
  onApplicationWrittenDashboardRollup,
  onLeadWrittenDashboardRollup,
} = require('../../dashboardStatsRollup');
const { entersHiredStatus } = require('../../shared/hireDate');

const APP_PATH = 'companies/c1/applications/a1';
const LEAD_PATH = 'companies/c1/leads/l1';
const STATS_PATH = 'companies/c1/internal_stats/dashboard';
const CHANGED_AT = '2026-11-06T15:00:00.000Z';
const at = (iso) => ({ toMillis: () => Date.parse(iso) });
/** The hire date written for a write made at `iso`: that write's own time. */
const HIRED_AT = (iso = CHANGED_AT) => ({ writtenAt: Date.parse(iso) });

const snap = (path, data) => ({ exists: data != null, data: () => data, ref: { path } });

/** One write of the application from `before` to `after` (null: absent), stored as `after`. */
function applicationWrite(before, after, time = CHANGED_AT) {
  if (after) mockStore.docs[APP_PATH] = after;
  return onApplicationWrittenDashboardRollup({
    data: { before: snap(APP_PATH, before), after: snap(APP_PATH, after) },
    params: { companyId: 'c1', applicationId: 'a1' },
    time,
  });
}

beforeEach(() => {
  Object.assign(mockStore, { docs: {}, updates: [], sets: [], failTransaction: false });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('the hire date', () => {
  it.each([
    ['New Application', 'Hired'],
    ['In Process', 'Approved'],
    ['Terminated', 'Hired'],
  ])('is stamped when the status moves from %s to %s, and the hired counter moves once', async (from, to) => {
    await applicationWrite({ status: from }, { status: to });

    expect(mockStore.updates).toEqual([{ path: APP_PATH, data: { hiredAt: HIRED_AT() } }]);
    expect(mockStore.sets).toEqual([
      expect.objectContaining({ path: STATS_PATH, data: expect.objectContaining({ hiredTotal: { increment: 1 } }) }),
    ]);
  });

  it('is the time of the write that hired, not when the trigger ran: a hire at 23:59:59 stays in its month', async () => {
    await applicationWrite({ status: 'In Process' }, { status: 'Hired' }, '2026-11-30T23:59:59.900Z');

    expect(mockStore.updates).toEqual([{ path: APP_PATH, data: { hiredAt: HIRED_AT('2026-11-30T23:59:59.900Z') } }]);
  });

  it("falls back to the server's time when the event carries no readable time", async () => {
    await applicationWrite({ status: 'In Process' }, { status: 'Hired' }, null);

    expect(mockStore.updates).toEqual([{ path: APP_PATH, data: { hiredAt: 'SERVER_TIMESTAMP' } }]);
  });

  it('is stamped for an application created hired', async () => {
    await applicationWrite(null, { status: 'Hired' });

    expect(mockStore.updates).toEqual([{ path: APP_PATH, data: { hiredAt: HIRED_AT() } }]);
  });

  it.each([
    ['a save while hired', { status: 'Hired', firstName: 'A' }, { status: 'Hired', firstName: 'B' }],
    ['one hired spelling to the other', { status: 'Approved' }, { status: 'Hired' }],
    ['a record hired before the date was recorded', { status: 'Hired' }, { status: 'Hired', phone: '5550100' }],
    ['a move that is not into hired', { status: 'New Application' }, { status: 'In Process' }],
  ])('is not stamped by %s', async (_name, before, after) => {
    await applicationWrite(before, after);

    expect(mockStore.updates).toEqual([]);
  });

  it('is kept, not removed, when the status leaves hired', async () => {
    const hiredAt = at('2026-11-02T10:00:00Z');
    await applicationWrite({ status: 'Hired', hiredAt }, { status: 'Terminated', hiredAt });

    expect(mockStore.updates).toEqual([]);
  });

  it("does not write again on its own write, or move the counters", async () => {
    const hiredAt = at('2026-11-06T15:00:02Z');
    await applicationWrite({ status: 'Hired' }, { status: 'Hired', hiredAt });

    expect(mockStore.updates).toEqual([]);
    expect(mockStore.sets).toEqual([]);
  });

  it('is not moved when the same event is delivered twice', async () => {
    // The first delivery stamped it a moment after the status change.
    await applicationWrite({ status: 'In Process' }, { status: 'Hired', hiredAt: at('2026-11-06T15:00:02Z') });

    expect(mockStore.updates).toEqual([]);
  });

  it('is set again when a driver comes back to hired, replacing the earlier one', async () => {
    await applicationWrite(
      { status: 'Terminated', hiredAt: at('2026-08-01T10:00:00Z') },
      { status: 'Hired', hiredAt: at('2026-08-01T10:00:00Z') },
    );

    expect(mockStore.updates).toEqual([{ path: APP_PATH, data: { hiredAt: HIRED_AT() } }]);
  });

  it('is not written for a record deleted before the trigger ran', async () => {
    await onApplicationWrittenDashboardRollup({
      data: { before: snap(APP_PATH, { status: 'In Process' }), after: snap(APP_PATH, { status: 'Hired' }) },
      params: { companyId: 'c1', applicationId: 'a1' },
      time: CHANGED_AT,
    });

    expect(mockStore.updates).toEqual([]);
  });

  it('that cannot be written is logged by id only, and the counters still move', async () => {
    mockStore.failTransaction = true;
    await applicationWrite({ status: 'In Process', firstName: 'Ann' }, { status: 'Hired', firstName: 'Ann' });

    expect(mockStore.updates).toEqual([]);
    expect(mockStore.sets).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('[dashboardRollup] hire date not recorded:', 'c1', 'a1', 'aborted');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('Ann');
  });

  it('is never written on a lead', async () => {
    mockStore.docs[LEAD_PATH] = { status: 'Hired' };
    await onLeadWrittenDashboardRollup({
      data: { before: snap(LEAD_PATH, { status: 'In Process' }), after: snap(LEAD_PATH, { status: 'Hired' }) },
      params: { companyId: 'c1', leadId: 'l1' },
      time: CHANGED_AT,
    });

    expect(mockStore.updates).toEqual([]);
  });
});

describe('entersHiredStatus', () => {
  it.each([
    [null, { status: 'Hired' }, true],
    [{ status: 'New' }, { status: 'Approved' }, true],
    [{ status: 'Hired' }, { status: 'Approved' }, false],
    [{ status: 'Hired' }, null, false],
    [{ status: 'Hired' }, { status: 'Terminated' }, false],
    [{ status: 'New' }, { status: 'hired' }, false], // stored values match exactly, as the Hired list's query does
  ])('from %o to %o is %s', (before, after, expected) => {
    expect(entersHiredStatus(before, after)).toBe(expected);
  });
});
