// B2: expiresAt stamping (trigger helper) + backfill core.

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      Timestamp: { fromMillis: (ms) => ({ __ms: ms, toMillis: () => ms }) },
    },
  },
  db: {},
}));

const {
  computeExpiresAt,
  stampExpiryOnCreate,
  backfillExpiry,
  ACTIVITY_LOG_RETENTION_DAYS,
  DAY_MS,
} = require('../../shared/retention');

const NINETY_D_MS = ACTIVITY_LOG_RETENTION_DAYS * DAY_MS;

function makeSnap({ data = {}, createTimeMs = 1000000 } = {}) {
  return {
    data: () => data,
    createTime: { toMillis: () => createTimeMs },
    ref: { set: jest.fn().mockResolvedValue() },
  };
}

describe('computeExpiresAt', () => {
  it('is creation time + 90 days', () => {
    expect(computeExpiresAt(1000000).__ms).toBe(1000000 + NINETY_D_MS);
  });
});

describe('stampExpiryOnCreate (B2 trigger helper)', () => {
  it('stamps expiresAt ~90d from the doc createTime when absent', async () => {
    const snap = makeSnap({ createTimeMs: 5000000 });
    await stampExpiryOnCreate({ data: snap });
    expect(snap.ref.set).toHaveBeenCalledWith(
      { expiresAt: expect.objectContaining({ __ms: 5000000 + NINETY_D_MS }) },
      { merge: true },
    );
  });

  it('is idempotent — skips docs that already carry expiresAt', async () => {
    const snap = makeSnap({ data: { expiresAt: { __ms: 1 } } });
    await stampExpiryOnCreate({ data: snap });
    expect(snap.ref.set).not.toHaveBeenCalled();
  });

  it('is a no-op when the event has no data (delete/empty)', async () => {
    await expect(stampExpiryOnCreate({})).resolves.toBeUndefined();
    await expect(stampExpiryOnCreate({ data: null })).resolves.toBeUndefined();
  });
});

// --- Backfill core ---

function makeDoc({ id, data = {}, createTimeMs = 2000000 }) {
  return {
    id,
    data: () => data,
    createTime: { toMillis: () => createTimeMs },
    ref: { id },
  };
}

function makeDb(docs) {
  const batchSet = jest.fn();
  const batchCommit = jest.fn().mockResolvedValue();
  const query = {
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs, empty: docs.length === 0, size: docs.length }),
  };
  return {
    collectionGroup: jest.fn(() => query),
    batch: jest.fn(() => ({ set: batchSet, commit: batchCommit })),
    _batchSet: batchSet,
    _batchCommit: batchCommit,
    _query: query,
  };
}

describe('backfillExpiry (B2 backfill)', () => {
  const docs = [
    makeDoc({ id: 'a' }), // missing -> stamp
    makeDoc({ id: 'b', data: { expiresAt: { __ms: 1 } } }), // already stamped -> skip
    makeDoc({ id: 'c' }), // missing -> stamp
  ];

  it('dry run counts what it WOULD stamp and writes nothing', async () => {
    const db = makeDb(docs);
    const res = await backfillExpiry({ db, collectionId: 'activity_logs' });
    expect(res).toMatchObject({
      collectionId: 'activity_logs',
      scanned: 3,
      stamped: 2,
      alreadyStamped: 1,
      committed: false,
    });
    expect(db.batch).not.toHaveBeenCalled();
    expect(db._batchSet).not.toHaveBeenCalled();
  });

  it('commit mode stamps only the missing docs and commits the batch', async () => {
    const db = makeDb(docs);
    const res = await backfillExpiry({ db, collectionId: 'activity_logs', commit: true });
    expect(res).toMatchObject({ scanned: 3, stamped: 2, alreadyStamped: 1, committed: true });
    expect(db._batchSet).toHaveBeenCalledTimes(2);
    expect(db._batchSet).toHaveBeenCalledWith(
      expect.anything(),
      { expiresAt: expect.objectContaining({ __ms: 2000000 + NINETY_D_MS }) },
      { merge: true },
    );
    expect(db._batchCommit).toHaveBeenCalledTimes(1);
  });

  it('handles an empty collection group', async () => {
    const db = makeDb([]);
    const res = await backfillExpiry({ db, collectionId: 'activities' });
    expect(res).toMatchObject({ scanned: 0, stamped: 0 });
    expect(db._batchCommit).not.toHaveBeenCalled();
  });
});
