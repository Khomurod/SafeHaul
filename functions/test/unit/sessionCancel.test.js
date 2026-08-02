// Campaign cancellation contract:
//  - cancelBulkSession is the supported way to stop a live session (never doc deletion);
//  - it only flips status ('cancelled') and audit fields — the record survives for reporting;
//  - repeated cancellation is harmless (idempotent);
//  - the batch worker recognizes a cancelled session and stops without sending.

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

// In-memory session store shared by controller + worker mocks.
const mockSessions = {};

function mockMakeSessionRef(sessionId) {
  return {
    async get() {
      const data = mockSessions[sessionId];
      return { exists: !!data, data: () => data };
    },
    async update(payload) {
      if (!mockSessions[sessionId]) {
        const err = new Error('NOT_FOUND');
        err.code = 5;
        throw err;
      }
      Object.assign(mockSessions[sessionId], payload);
    },
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
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (sessionId) => mockMakeSessionRef(sessionId),
        }),
      }),
    }),
  },
}));

jest.mock('../../bulkActions/helpers/auth', () => ({
  assertCompanyAdmin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bulkActions/helpers/queryBuilder', () => ({ buildLeadQueries: jest.fn() }));
jest.mock('../../bulkActions/helpers/phoneLedger', () => ({
  derivePhoneLedgerKeys: jest.fn(),
  buildSmsLedgerThreshold: jest.fn(),
  findRecentlyMessagedCanonicalPhones: jest.fn(),
}));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const mockEnqueueWorker = jest.fn();
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));

// Worker-only heavy deps.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../../blacklist', () => ({ isBlacklisted: jest.fn() }));
jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
jest.mock('../../integrations/encryption', () => ({ decrypt: jest.fn() }));
jest.mock('../../utils/phoneUtils', () => ({ normalizePhone: jest.fn((p) => p) }));

const { cancelBulkSession } = require('../../bulkActions/controllers/sessionController');
const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');

function callCancel(sessionId) {
  return cancelBulkSession({
    auth: { uid: 'admin-1' },
    data: { companyId: 'co1', sessionId },
  });
}

describe('cancelBulkSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockSessions)) delete mockSessions[key];
  });

  it.each(['queued', 'active'])('cancels a %s session in place without deleting it', async (status) => {
    mockSessions.sess1 = {
      status,
      name: 'Big Outreach',
      progress: { processedCount: 3, totalCount: 10 },
      targetIds: ['a', 'b'],
    };

    const result = await callCancel('sess1');

    expect(result).toEqual({ success: true });
    // Status flipped through the supported flow…
    expect(mockSessions.sess1.status).toBe('cancelled');
    expect(mockSessions.sess1.updatedBy).toBe('admin-1');
    // …audit/reporting fields are preserved, not wiped.
    expect(mockSessions.sess1.name).toBe('Big Outreach');
    expect(mockSessions.sess1.progress).toEqual({ processedCount: 3, totalCount: 10 });
    // Cancel never enqueues a worker.
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('is idempotent — cancelling an already-cancelled session succeeds harmlessly', async () => {
    mockSessions.sess1 = { status: 'active', targetIds: ['a'] };

    await callCancel('sess1');
    const second = await callCancel('sess1');

    expect(second).toEqual({ success: true });
    expect(mockSessions.sess1.status).toBe('cancelled');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });
});

describe('processBulkBatch on a cancelled session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockSessions)) delete mockSessions[key];
    process.env.BULK_WORKER_SECRET = 'test-secret';
  });

  function runWorker(sessionId) {
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; return this; },
    };
    return processBulkBatch(
      {
        headers: { 'x-safehaul-internal-auth': 'test-secret' },
        body: { companyId: 'co1', sessionId },
      },
      res,
    ).then(() => res);
  }

  it('stops immediately without sending when the session is cancelled', async () => {
    mockSessions.sess1 = { status: 'cancelled', config: { method: 'sms', message: 'x' }, targetIds: ['a'] };

    const res = await runWorker('sess1');

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('cancelled');
    expect(res.body).toContain('Stopping worker');
    // No follow-up worker was scheduled and the session was left untouched.
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
    expect(mockSessions.sess1.status).toBe('cancelled');
  });
});
