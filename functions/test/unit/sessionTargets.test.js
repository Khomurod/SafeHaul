// Where a bulk session's recipients are read from. A session has kept them as
// `targetIds` on its own document, which every send rewrites; they are moving
// to `meta/targets` beside it (`helpers/sessionTargets.js`). Until every
// session is written that way, the worker and Resume read the session's own
// list first, then that document, so a session of either shape keeps sending.
// All data is artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const mockSendSMS = jest.fn();
const mockEnqueueWorker = jest.fn();
const mockState = {};

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

jest.mock('../../firebaseAdmin', () => {
  const targetsRef = { __type: 'targets', get: async () => mockSnap(mockState.targets) };
  const session = {
    __type: 'session',
    get: async () => mockSnap(mockState.session),
    update: async (payload) => { mockState.sessionUpdates.push(payload); },
    collection: (name) => (name === 'meta'
      ? { doc: (id) => (id === 'targets' ? targetsRef : { id, get: async () => mockSnap(undefined) }) }
      : { doc: (id) => ({ __type: 'log', id, get: async () => mockSnap(undefined), set: async () => {} }) }),
  };
  const companyCollections = {
    bulk_sessions: { doc: () => session },
    leads: {
      doc: (id) => ({
        get: async () => mockSnap({ firstName: `Artificial ${id}`, phone: `(555) 010-00${id.slice(-1)}0` }),
        update: async () => {},
      }),
    },
  };
  const db = {
    runTransaction: async (callback) => callback({
      get: async (ref) => {
        if (ref?.__type === 'session') return mockSnap(mockState.session);
        if (ref?.__type === 'targets') return mockSnap(mockState.targets);
        return mockSnap(undefined);
      },
      update: () => {},
      set: () => {},
    }),
    collection: (name) => {
      if (name === 'companies') {
        return {
          doc: () => ({
            get: async () => mockSnap({ companyName: 'Artificial Freight LLC' }),
            collection: (sub) => companyCollections[sub] || { doc: (id) => ({ id, set: async () => {} }) },
          }),
        };
      }
      if (name === 'users') return { doc: () => ({ get: async () => mockSnap({ name: 'Dana Recruiter' }) }) };
      return { doc: (id) => ({ id, get: async () => mockSnap(undefined), set: async () => {} }) };
    },
  };
  const admin = {
    firestore: { FieldValue: { serverTimestamp: () => 'server-time', increment: (n) => ({ increment: n }) } },
    auth: () => ({ getUser: async () => ({ displayName: null }) }),
  };
  return { admin, db };
});

jest.mock('firebase-functions/v2/https', () => ({
  onRequest: (opts, handler) => handler,
  onCall: (opts, handler) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('../../blacklist', () => ({ isBlacklisted: async () => false }));
jest.mock('../../integrations/factory', () => ({
  getAdapterForUser: async () => ({ ensureLoggedIn: async () => true, sendSMS: mockSendSMS }),
}));
jest.mock('../../integrations/encryption', () => ({ decrypt: (value) => value }));
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));
jest.mock('../../bulkActions/helpers/auth', () => ({ assertCompanyAdmin: async () => undefined }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => true }));
jest.mock('../../bulkActions/workers/sendPacing', () => ({
  ...jest.requireActual('../../bulkActions/workers/sendPacing'),
  pauseBeforeNextSend: async () => {},
}));

const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');
const { resumeBulkSession } = require('../../bulkActions/controllers/sessionController');

const session = (overrides) => ({
  status: 'active',
  config: { method: 'sms', message: 'Hi [Driver Name].' },
  leadSourceType: 'leads',
  createdBy: 'recruiter-1',
  progress: { currentPointer: 0, processedCount: 0, totalCount: 2 },
  workerGeneration: 1,
  ...overrides,
});

async function runBatch() {
  const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
  await processBulkBatch({
    headers: { 'x-safehaul-internal-auth': 'unit-test-secret', 'x-appengine-queuename': 'bulk-actions-queue' },
    body: { companyId: 'co-1', sessionId: 'session-1', workerGeneration: 1 },
  }, res);
  return res;
}

const sentTo = () => mockSendSMS.mock.calls.map(([phone]) => phone);
const completed = () => mockState.sessionUpdates.some((update) => update.status === 'completed');

beforeEach(() => {
  jest.resetAllMocks();
  mockSendSMS.mockResolvedValue(true);
  mockEnqueueWorker.mockResolvedValue(true);
  mockState.session = undefined;
  mockState.targets = undefined;
  mockState.sessionUpdates = [];
});

describe('the batch worker', () => {
  it('sends to the recipients a session keeps beside it', async () => {
    mockState.session = session({});
    mockState.targets = { ids: ['lead-1', 'lead-2'] };

    await runBatch();

    expect(sentTo()).toEqual(['(555) 010-0010', '(555) 010-0020']);
    expect(completed()).toBe(true);
  });

  it("takes the session's own list first", async () => {
    mockState.session = session({ targetIds: ['lead-1'], progress: { currentPointer: 0, processedCount: 0, totalCount: 1 } });
    mockState.targets = { ids: ['lead-2'] };

    await runBatch();

    expect(sentTo()).toEqual(['(555) 010-0010']);
  });

  it('completes a session with no list anywhere without sending', async () => {
    mockState.session = session({});

    await runBatch();

    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(completed()).toBe(true);
  });
});

describe('Resume', () => {
  const resume = () => resumeBulkSession({ auth: { uid: 'admin-1' }, data: { companyId: 'co-1', sessionId: 'session-1' } });

  it('restarts a paused session whose list is kept beside it', async () => {
    mockState.session = session({ status: 'paused', progress: { currentPointer: 1, processedCount: 1, totalCount: 2 } });
    mockState.targets = { ids: ['lead-1', 'lead-2'] };

    await expect(resume()).resolves.toEqual({ success: true });

    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 1);
    expect(completed()).toBe(false);
  });

  it('still marks a session with no list anywhere complete', async () => {
    mockState.session = session({ status: 'paused' });

    await expect(resume()).resolves.toMatchObject({ success: true, message: expect.stringMatching(/No remaining targets/) });

    expect(mockEnqueueWorker).not.toHaveBeenCalled();
    expect(completed()).toBe(true);
  });
});
