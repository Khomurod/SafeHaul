// B1 FIX coverage: the processing_status idempotency guard doc must carry an expiresAt
// timestamp so a Firestore native TTL policy can age it out.

jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts, fn) => fn,
  onDocumentUpdated: (_opts, fn) => fn,
}));

// `mock`-prefixed so the jest.mock factory may reference it (jest hoisting rule).
const mockCreatedPayloads = [];

jest.mock('../../firebaseAdmin', () => {
  // Recursive chainable Firestore doc/collection mocks (defined inside the factory
  // so they are in-scope for hoisting).
  function makeDocRef() {
    return {
      collection: jest.fn(() => makeColRef()),
      doc: jest.fn(() => makeDocRef()),
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
  }
  function makeColRef() {
    return {
      doc: jest.fn(() => makeDocRef()),
      where: jest.fn(function () { return this; }),
      limit: jest.fn(function () { return this; }),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      add: jest.fn().mockResolvedValue(undefined),
    };
  }
  return {
    admin: {
      firestore: {
        FieldValue: { serverTimestamp: () => 'srv' },
        Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) },
      },
    },
    db: {
      collection: jest.fn(() => makeColRef()),
      runTransaction: jest.fn(async (cb) => {
        const txn = {
          get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          create: jest.fn((ref, payload) => mockCreatedPayloads.push(payload)),
          update: jest.fn(),
        };
        return cb(txn);
      }),
    },
    auth: { getUserByEmail: jest.fn() },
  };
});

jest.mock('../../shared/constants', () => ({
  LIFECYCLE_STATUSES: { PROCESSING: 'processing', COMPLETE: 'complete', FAILED: 'failed' },
}));

// Phone-only / placeholder identity makes processDriverData return early — keeps this test
// focused on the idempotency-guard write.
jest.mock('../../shared/placeholderDomains', () => ({
  isPlaceholderEmail: jest.fn(() => true),
}));

jest.mock('../../integrations/encryption', () => ({ encrypt: jest.fn((v) => `enc(${v})`) }));

const { onApplicationSubmitted } = require('../../driverSync');

describe('onApplicationSubmitted processing_status TTL (B1)', () => {
  beforeEach(() => {
    mockCreatedPayloads.length = 0;
    jest.clearAllMocks();
  });

  it('stamps expiresAt ~30 days out on the processing_status guard doc', async () => {
    const before = Date.now();
    await onApplicationSubmitted({
      params: { companyId: 'co1', applicationId: 'app1' },
      data: {
        data: () => ({
          // valid drawn signature so the trigger does not reject the application
          signature: 'data:image/png;base64,' + 'A'.repeat(50),
          // no phone + placeholder email => processDriverData returns early
        }),
      },
    });

    expect(mockCreatedPayloads).toHaveLength(1);
    const payload = mockCreatedPayloads[0];
    expect(payload).toHaveProperty('expiresAt');

    const expiryMs = payload.expiresAt.toMillis();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Allow a generous window for execution time.
    expect(expiryMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 5000);
    expect(expiryMs).toBeLessThanOrEqual(Date.now() + thirtyDaysMs + 5000);
  });
});
