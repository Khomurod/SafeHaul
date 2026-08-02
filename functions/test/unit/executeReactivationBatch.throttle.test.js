// A3 coverage: executeReactivationBatch must throttle repeated campaigns
// (fail-closed) after RBAC and after the per-call size cap, AND (durability half)
// it must enqueue a bulk session via the Cloud Tasks worker rather than sending
// SMS in-process.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts, fn) => fn,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

const mockSendSMS = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../../integrations/factory', () => ({
  getAdapter: jest.fn(),
  getAdapterForUser: jest.fn().mockResolvedValue({ sendSMS: mockSendSMS, config: {} }),
  getAdapterForNumber: jest.fn(),
}));

jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAdminStrict: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

// Worker rail: mock the session factory so the callable's job is just to delegate.
const mockCreateAndStart = jest.fn().mockResolvedValue({ sessionId: 'sess123', targetCount: 2 });
jest.mock('../../bulkActions/helpers/sessionFactory', () => ({
  createAndStartBulkSession: (...args) => mockCreateAndStart(...args),
}));

const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAdminStrict } = require('../../shared/companyAccess');
const { executeReactivationBatch } = require('../../integrations/services/smsService');

const baseRequest = () => ({
  auth: { uid: 'admin1' },
  data: { companyId: 'co1', leadIds: ['l1', 'l2'], messageText: 'Hello [Driver Name]' },
});

describe('executeReactivationBatch throttle (A3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAdminStrict.mockResolvedValue(undefined);
    mockCreateAndStart.mockResolvedValue({ sessionId: 'sess123', targetCount: 2 });
  });

  it('throttles with resource-exhausted when the campaign limit is exceeded', async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    await expect(executeReactivationBatch(baseRequest())).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockCreateAndStart).not.toHaveBeenCalled();
  });

  it('uses a per-company-per-user key with closed fail behavior', async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    await executeReactivationBatch(baseRequest()).catch(() => {});
    expect(checkRateLimit).toHaveBeenCalledWith('reactivation_batch_co1_admin1', 5, 300, 'closed');
  });

  it('only throttles after RBAC passes', async () => {
    assertCompanyAdminStrict.mockRejectedValueOnce(new Error('denied'));
    await executeReactivationBatch(baseRequest()).catch(() => {});
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('rejects oversized batches before throttling (existing cap preserved)', async () => {
    const req = baseRequest();
    req.data.leadIds = Array.from({ length: 51 }, (_, i) => `l${i}`);
    await expect(executeReactivationBatch(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(assertCompanyAdminStrict).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    await expect(executeReactivationBatch({ data: { companyId: 'co1', leadIds: ['l1'] } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  // --- Durability half: delegate to the bulk Cloud Tasks worker ---

  it('enqueues a bulk session instead of sending SMS in-process', async () => {
    const res = await executeReactivationBatch(baseRequest());
    // No in-process sends: the worker does the actual sending.
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockCreateAndStart).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, sessionId: 'sess123', queued: 2 });
  });

  it('passes the leads, sender, sms config and applications source to the session factory', async () => {
    await executeReactivationBatch(baseRequest());
    expect(mockCreateAndStart).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'co1',
      createdBy: 'admin1',
      targetIds: ['l1', 'l2'],
      leadSourceType: 'applications',
      config: { method: 'sms', message: 'Hello [Driver Name]' },
    }));
  });

  it('enqueues only after RBAC and throttle have passed', async () => {
    assertCompanyAdminStrict.mockRejectedValueOnce(new Error('denied'));
    await executeReactivationBatch(baseRequest()).catch(() => {});
    expect(mockCreateAndStart).not.toHaveBeenCalled();
  });

  it('surfaces an internal error if enqueue fails', async () => {
    mockCreateAndStart.mockRejectedValueOnce(new Error('queue down'));
    await expect(executeReactivationBatch(baseRequest())).rejects.toMatchObject({ code: 'internal' });
  });

  it('returns a friendly no-op for an empty lead list (no session created)', async () => {
    const req = baseRequest();
    req.data.leadIds = [];
    const res = await executeReactivationBatch(req);
    expect(res).toMatchObject({ success: false });
    expect(mockCreateAndStart).not.toHaveBeenCalled();
  });
});
