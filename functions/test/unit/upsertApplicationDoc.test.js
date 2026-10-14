const { upsertApplicationDoc } = require('../../shared/upsertApplicationDoc');

function createDbMock(existingQueue) {
  const set = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn(() => Promise.resolve(existingQueue.shift() || { exists: false, data: () => null }));
  const appDoc = jest.fn(() => ({ get, set }));
  const appCollection = jest.fn(() => ({ doc: appDoc }));
  const companyDoc = jest.fn(() => ({ collection: appCollection }));
  const collection = jest.fn(() => ({ doc: companyDoc }));
  const runTransaction = async (fn) => fn({
    get: (ref) => ref.get(),
    set: (ref, data, options) => ref.set(data, options),
  });
  return {
    db: { collection, runTransaction },
    set,
    get,
  };
}

/**
 * Records kept by id, with transactions that run one at a time and write when
 * they finish, as Firestore runs them on one document. Plain reads and writes
 * still interleave.
 */
function createStoreMock() {
  const records = new Map();
  let tail = Promise.resolve();
  const ref = (id) => ({
    get: async () => ({ exists: records.has(id), data: () => records.get(id) }),
    set: async (data) => { records.set(id, { ...(records.get(id) || {}), ...data }); },
  });
  const db = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: ref }) }) }),
    runTransaction: (fn) => {
      const run = tail.then(async () => {
        const writes = [];
        const result = await fn({
          get: (target) => target.get(),
          set: (target, data) => { writes.push(() => target.set(data)); },
        });
        for (const write of writes) await write();
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
  return { db, records };
}

const submission = (confirmationNumber) => ({
  applicationId: 'app1',
  applicantId: 'app1',
  status: 'New Application',
  confirmationNumber,
});

describe('upsertApplicationDoc', () => {
  it('reads the record once', async () => {
    const { db, get } = createDbMock([]);

    await upsertApplicationDoc({
      db, companyId: 'co1', applicationId: 'app1', applicantKeyFull: 'full',
      applicationDoc: submission('SAF-2026-NEW11'), now: { __srv: true }, logLabel: 'test',
    });

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('gives two submissions at once one record and one confirmation number', async () => {
    const { db, records } = createStoreMock();
    const upsert = (confirmationNumber) => upsertApplicationDoc({
      db, companyId: 'co1', applicationId: 'app1', applicantKeyFull: 'full',
      applicationDoc: submission(confirmationNumber), now: 'server-time', logLabel: 'test',
    });

    const [first, second] = await Promise.all([upsert('SAF-2026-AAAAA'), upsert('SAF-2026-BBBBB')]);

    expect(first.confirmationNumber).toBe('SAF-2026-AAAAA');
    expect(second.confirmationNumber).toBe('SAF-2026-AAAAA');
    expect([first.deduplicated, second.deduplicated]).toEqual([false, true]);
    expect(records.get('app1').confirmationNumber).toBe('SAF-2026-AAAAA');
  });

  it("leaves the caller's document as it was", async () => {
    const { db } = createDbMock([{ exists: true, data: () => ({ applicantKeyFull: 'other' }) }]);
    const applicationDoc = { ...submission('SAF-2026-NEW11'), lifecycle: { status: 'submitted' } };
    const before = JSON.parse(JSON.stringify(applicationDoc));

    await upsertApplicationDoc({
      db, companyId: 'co1', applicationId: 'app1', applicantKeyFull: 'full',
      applicationDoc, now: 'server-time', logLabel: 'test',
    });

    expect(applicationDoc).toEqual(before);
  });

  it('preserves progressed status and lifecycle on retry', async () => {
    const existing = {
      exists: true,
      data: () => ({
        confirmationNumber: 'SAF-2026-ORIG1',
        submittedAt: 'submitted',
        createdAt: 'created',
        status: 'Hired',
        lifecycle: { status: 'complete', submittedAt: 'submitted' },
      }),
    };
    const { db, set } = createDbMock([existing]);
    const applicationDoc = {
      applicationId: 'app1',
      applicantId: 'app1',
      status: 'New Application',
      confirmationNumber: 'SAF-2026-NEW11',
      lifecycle: { status: 'submitted', submittedAt: 'new' },
    };

    const result = await upsertApplicationDoc({
      db,
      companyId: 'co1',
      applicationId: 'app1',
      applicantKeyFull: 'full',
      applicationDoc,
      now: { __srv: true },
      logLabel: 'test',
    });

    expect(result.deduplicated).toBe(true);
    expect(result.confirmationNumber).toBe('SAF-2026-ORIG1');
    expect(set.mock.calls[0][0].status).toBeUndefined();
    expect(set.mock.calls[0][0].lifecycle.status).toBe('complete');
    expect(set.mock.calls[0][1]).toEqual({ merge: true });
  });

  it('uses a suffixed id on applicantKeyFull collision', async () => {
    const { db, set } = createDbMock([
      { exists: true, data: () => ({ applicantKeyFull: 'other' }) },
      { exists: false, data: () => null },
    ]);
    const applicationDoc = {
      applicationId: 'app1',
      applicantId: 'app1',
      driverId: 'app1',
      userId: 'app1',
      confirmationNumber: 'SAF-2026-NEW11',
    };
    const result = await upsertApplicationDoc({
      db,
      companyId: 'co1',
      applicationId: 'app1',
      applicantKeyFull: 'full',
      applicationDoc,
      now: { __srv: true },
      logLabel: 'test',
    });

    expect(result.applicationId).toBe('app1_2');
    expect(set.mock.calls[0][0].applicationId).toBe('app1_2');
  });

  it('recomputes applicationIdNormalized for the suffixed collision id', async () => {
    const { db, set } = createDbMock([
      { exists: true, data: () => ({ applicantKeyFull: 'other' }) },
      { exists: false, data: () => null },
    ]);
    const applicationDoc = {
      applicationId: 'app1',
      applicantId: 'app1',
      driverId: 'app1',
      userId: 'app1',
      confirmationNumber: 'SAF-2026-NEW11',
      applicationIdNormalized: 'app1',
    };
    await upsertApplicationDoc({
      db,
      companyId: 'co1',
      applicationId: 'app1',
      applicantKeyFull: 'full',
      applicationDoc,
      now: { __srv: true },
      logLabel: 'test',
    });

    expect(set.mock.calls[0][0].applicationIdNormalized).toBe('app1_2');
    expect(set.mock.calls[0][0].confirmationNumberNormalized).toBe('SAF-2026-NEW11');
  });

  it('keeps confirmationNumberNormalized in sync with a preserved confirmation on dedup', async () => {
    const existing = {
      exists: true,
      data: () => ({
        confirmationNumber: 'SAF-2026-ORIG1',
        submittedAt: 'submitted',
        createdAt: 'created',
      }),
    };
    const { db, set } = createDbMock([existing]);
    const applicationDoc = {
      applicationId: 'app1',
      applicantId: 'app1',
      confirmationNumber: 'SAF-2026-NEW11',
      confirmationNumberNormalized: 'SAF-2026-NEW11',
    };
    const result = await upsertApplicationDoc({
      db,
      companyId: 'co1',
      applicationId: 'app1',
      applicantKeyFull: 'full',
      applicationDoc,
      now: { __srv: true },
      logLabel: 'test',
    });

    expect(result.confirmationNumber).toBe('SAF-2026-ORIG1');
    expect(set.mock.calls[0][0].confirmationNumberNormalized).toBe('SAF-2026-ORIG1');
  });
});
