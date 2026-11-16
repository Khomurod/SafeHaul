// Resume and Continue (`resumeBulkSession`, `controllers/session/resumeSession.js`):
//  - a paused campaign resumes, and one that stopped with an error part-way
//    continues, from `progress.currentPointer`: no one already tried is sent to again;
//  - any other campaign (running, waiting to start, finished, cancelled) is refused
//    and left exactly as it was, so no direct call starts a second worker or
//    restarts a finished campaign;
//  - a campaign with no one left becomes completed instead of staying active
//    with no worker;
//  - the worker it starts carries a new generation, so a worker still holding
//    the old one stops.
// All data is artificial.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, fn) => fn,
  onRequest: (_opts, fn) => fn,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

// In-memory sessions and their recipient lists (`meta/targets`).
const mockSessions = {};
const mockTargets = {};

function mockTargetsRef(sessionId) {
  return {
    async get() {
      const ids = mockTargets[sessionId];
      return { exists: ids !== undefined, data: () => ({ ids }) };
    },
  };
}

function mockSessionRef(sessionId) {
  return {
    id: sessionId,
    async get() {
      const data = mockSessions[sessionId];
      return { exists: !!data, data: () => data };
    },
    async update(payload) {
      Object.assign(mockSessions[sessionId], payload);
    },
    collection: () => ({ doc: () => mockTargetsRef(sessionId) }),
  };
}

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'srv-ts',
        increment: (n) => ({ __increment: n }),
      },
    },
  },
  db: {
    // Reads go straight through; writes land only once the callback succeeds.
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: (ref) => ref.get(),
        update: (ref, payload) => { writes.push([ref, payload]); },
      });
      for (const [ref, payload] of writes) await ref.update(payload);
      return result;
    },
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (sessionId) => mockSessionRef(sessionId),
        }),
      }),
    }),
  },
}));

const mockAssertCompanyAdmin = jest.fn();
jest.mock('../../bulkActions/helpers/auth', () => ({
  assertCompanyAdmin: (...args) => mockAssertCompanyAdmin(...args),
}));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => true }));

const mockEnqueueWorker = jest.fn();
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));

const { resumeBulkSession } = require('../../bulkActions/controllers/sessionController');

const resume = (overrides = {}) => resumeBulkSession({
  auth: { uid: 'admin-1' },
  data: { companyId: 'co-1', sessionId: 'session-1' },
  ...overrides,
});

/** A campaign of 406 that stopped after 250, as a provider refusal at a batch's start leaves it. */
function stoppedCampaign(overrides = {}) {
  return {
    status: 'failed',
    error: 'SMS adapter initialization failed: Request rate exceeded',
    failedAt: 'earlier',
    progress: { currentPointer: 250, processedCount: 250, totalCount: 406, successCount: 19, failedCount: 231 },
    workerGeneration: 3,
    ...overrides,
  };
}

const recipients = (count) => Array.from({ length: count }, (_, i) => `lead-${i + 1}`);

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertCompanyAdmin.mockResolvedValue(undefined);
  mockEnqueueWorker.mockResolvedValue(true);
  for (const key of Object.keys(mockSessions)) delete mockSessions[key];
  for (const key of Object.keys(mockTargets)) delete mockTargets[key];
  mockTargets['session-1'] = recipients(406);
});

describe('Continue a campaign that stopped with an error', () => {
  it('starts it again from where it stopped, with a new worker generation', async () => {
    mockSessions['session-1'] = stoppedCampaign();

    await expect(resume()).resolves.toEqual({ success: true });

    const session = mockSessions['session-1'];
    expect(session.status).toBe('active');
    expect(session.workerGeneration).toBe(4);
    expect(session.updatedBy).toBe('admin-1');
    expect(mockEnqueueWorker).toHaveBeenCalledTimes(1);
    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 4);
  });

  it('keeps where it stopped, its counts and why it failed', async () => {
    mockSessions['session-1'] = stoppedCampaign();

    await resume();

    const session = mockSessions['session-1'];
    // The worker carries on from 250: the 250 already tried are not sent to again.
    expect(session.progress).toEqual(stoppedCampaign().progress);
    expect(session.error).toBe('SMS adapter initialization failed: Request rate exceeded');
    expect(session.failedAt).toBe('earlier');
  });

  it('marks it completed, and starts no worker, when everyone was already tried', async () => {
    mockSessions['session-1'] = stoppedCampaign({
      progress: { currentPointer: 406, processedCount: 406, totalCount: 406, successCount: 300, failedCount: 106 },
    });

    await expect(resume()).resolves.toMatchObject({ success: true, message: expect.stringMatching(/already tried/) });

    expect(mockSessions['session-1'].status).toBe('completed');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('marks it completed when it has no recipients anywhere', async () => {
    mockSessions['session-1'] = stoppedCampaign({ progress: { currentPointer: 0 } });
    delete mockTargets['session-1'];

    await expect(resume()).resolves.toMatchObject({ success: true, message: expect.stringMatching(/No remaining targets/) });

    expect(mockSessions['session-1'].status).toBe('completed');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('starts from the first recipient when it failed before sending, as a queue that would not start leaves it', async () => {
    mockSessions['session-1'] = { status: 'failed', error: 'Failed to start queue.' };

    await expect(resume()).resolves.toEqual({ success: true });

    expect(mockSessions['session-1']).toMatchObject({ status: 'active', workerGeneration: 1 });
    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 1);
  });

  it('reads a list kept on the session itself, as older campaigns keep it', async () => {
    delete mockTargets['session-1'];
    mockSessions['session-1'] = stoppedCampaign({
      targetIds: recipients(3),
      progress: { currentPointer: 2, processedCount: 2, totalCount: 3 },
    });

    await expect(resume()).resolves.toEqual({ success: true });

    expect(mockSessions['session-1'].status).toBe('active');
    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 4);
  });
});

describe('Resume a paused campaign', () => {
  it('starts it again from where it paused', async () => {
    mockSessions['session-1'] = stoppedCampaign({ status: 'paused', error: undefined, failedAt: undefined });

    await expect(resume()).resolves.toEqual({ success: true });

    expect(mockSessions['session-1']).toMatchObject({ status: 'active', workerGeneration: 4 });
    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 4);
  });
});

describe('Refused', () => {
  it.each(['active', 'queued', 'scheduled', 'completed', 'cancelled'])(
    'a %s campaign is left exactly as it was, and no worker starts',
    async (status) => {
      mockSessions['session-1'] = stoppedCampaign({ status });
      const before = { ...mockSessions['session-1'] };

      await expect(resume()).rejects.toMatchObject({ code: 'failed-precondition' });

      expect(mockSessions['session-1']).toEqual(before);
      expect(mockEnqueueWorker).not.toHaveBeenCalled();
    },
  );

  it('a campaign that is gone', async () => {
    await expect(resume()).rejects.toMatchObject({ code: 'not-found' });
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('a caller who is not signed in', async () => {
    mockSessions['session-1'] = stoppedCampaign();

    await expect(resume({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(mockSessions['session-1'].status).toBe('failed');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it("a caller who is not the company's admin", async () => {
    mockSessions['session-1'] = stoppedCampaign();
    mockAssertCompanyAdmin.mockRejectedValue(Object.assign(new Error('Only company admins can do this.'), { code: 'permission-denied' }));

    await expect(resume()).rejects.toMatchObject({ code: 'permission-denied' });

    expect(mockAssertCompanyAdmin).toHaveBeenCalledWith('admin-1', 'co-1');
    expect(mockSessions['session-1'].status).toBe('failed');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('a second click: the first continues the campaign, the second is refused and starts no second worker', async () => {
    mockSessions['session-1'] = stoppedCampaign();

    await expect(resume()).resolves.toEqual({ success: true });
    await expect(resume()).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(mockSessions['session-1'].workerGeneration).toBe(4);
    expect(mockEnqueueWorker).toHaveBeenCalledTimes(1);
  });
});
