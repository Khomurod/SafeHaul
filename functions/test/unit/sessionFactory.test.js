// A3: createAndStartBulkSession writes a worker-ready bulk_sessions doc and kicks
// off the recursive Cloud Tasks worker — the durable rail reactivation now rides.
//
// Note: shared mock vars are `mock`-prefixed so the jest.mock factories may
// reference them (babel-plugin-jest-hoist rule).

const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockSessionRef = {
  id: 'newsess',
  set: mockSet,
  update: mockUpdate,
  collection: jest.fn(),
};
const mockChain = {
  doc: jest.fn(),
  collection: jest.fn(),
};
// The session's recipients, written beside it (`helpers/sessionTargets.js`).
const mockTargetsRef = { id: 'targets' };
const mockTargetWrites = [];

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
  db: { collection: jest.fn(), batch: jest.fn() },
}));

const mockEnqueue = jest.fn();
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueue(...args),
}));

const { createAndStartBulkSession } = require('../../bulkActions/helpers/sessionFactory');
const { db } = require('../../firebaseAdmin');

const params = () => ({
  companyId: 'co1',
  createdBy: 'admin1',
  targetIds: ['l1', 'l2', 'l3'],
  config: { method: 'sms', message: 'Hi [Driver Name]' },
});

describe('createAndStartBulkSession (A3)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockSet.mockResolvedValue();
    mockUpdate.mockResolvedValue();
    mockSessionRef.collection.mockImplementation((name) => (name === 'meta' ? { doc: () => mockTargetsRef } : mockChain));
    mockChain.doc.mockImplementation(() => mockSessionRef);
    mockChain.collection.mockImplementation(() => mockChain);
    db.collection.mockImplementation(() => mockChain);
    mockTargetWrites.length = 0;
    db.batch.mockImplementation(() => ({
      set: (ref, data) => (ref === mockSessionRef ? mockSet(data) : mockTargetWrites.push({ ref, data })),
      commit: async () => {},
    }));
    mockEnqueue.mockResolvedValue();
  });

  it('writes a worker-ready session doc and returns its id + count', async () => {
    const res = await createAndStartBulkSession(params());
    expect(res).toEqual({ sessionId: 'newsess', targetCount: 3 });

    const doc = mockSet.mock.calls[0][0];
    expect(doc).toMatchObject({
      id: 'newsess',
      status: 'pending',
      createdBy: 'admin1',
      updatedBy: 'admin1',
      leadSourceType: 'applications',
      workerGeneration: 1,
      config: { method: 'sms', message: 'Hi [Driver Name]' },
      progress: { currentPointer: 0, totalCount: 3, processedCount: 0, successCount: 0, failedCount: 0 },
    });
    expect(doc).not.toHaveProperty('targetIds');
    expect(mockTargetWrites).toEqual([{ ref: mockTargetsRef, data: { ids: ['l1', 'l2', 'l3'] } }]);
  });

  it('activates the session then enqueues the first batch (gen 1, 1s delay)', async () => {
    await createAndStartBulkSession(params());
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'active' });
    expect(mockEnqueue).toHaveBeenCalledWith('co1', 'newsess', 1, 1);
  });

  it('marks the session failed and rethrows if enqueue fails', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue down'));
    await expect(createAndStartBulkSession(params())).rejects.toThrow('queue down');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('honours an explicit leadSourceType override', async () => {
    await createAndStartBulkSession({ ...params(), leadSourceType: 'leads' });
    expect(mockSet.mock.calls[0][0].leadSourceType).toBe('leads');
  });
});
