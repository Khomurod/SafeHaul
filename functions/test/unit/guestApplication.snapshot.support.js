/**
 * Shared harness for the `guestApplication.snapshot.*` suites.
 *
 * Wiring tests: submitting an application must freeze a submission snapshot, and
 * a snapshot failure must never lose an application the driver already sent.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory bodies live below.
 * `firestoreMock()` returns the same `mockState` every call, so the state a suite
 * imports from here is the state the writer walks.
 *
 * No suite here queues a `*Once` value and none calls `jest.resetModules()` (both
 * checked before the split), so `resetSnapshotState` keeps `clearAllMocks`.
 *
 * Two-space indentation throughout, matching the file this came from.
 */


// In-memory Firestore covering the full path the writer walks:
// companies/{id}/applications/{id}/submission/{seq}
const { assertStorableValue } = require('../helpers/firestoreValueRules');

const mockState = {
  applications: {},   // path -> data
  snapshots: {},      // path -> data
  dqFiles: {},        // path -> data
  storedPdfs: {},     // storage path -> { buffer, options }
  publicProfile: null,
  createShouldFail: null,
  attempts: {},
  txLock: null,
};

function mockApplicationDoc(companyId, applicationId) {
  const appPath = `companies/${companyId}/applications/${applicationId}`;
  return {
    async set(data) { mockState.applications[appPath] = { ...(mockState.applications[appPath] || {}), ...data }; },
    async get() {
      return appPath in mockState.applications
        ? { exists: true, data: () => mockState.applications[appPath] }
        : { exists: false, data: () => null };
    },
    collection: (name) => ({
      // Equality query over the subcollection, as used by the idempotency check.
      where: (field, op, value) => ({
        limit: (n) => ({
          async get() {
            const prefix = `${appPath}/${name}/`;
            const matches = Object.entries(mockState.snapshots)
              .filter(([path, data]) => path.startsWith(prefix) && op === '==' && data[field] === value)
              .slice(0, n)
              .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }));
            return { empty: matches.length === 0, docs: matches };
          },
        }),
      }),
      doc: (seq) => {
        const path = `${appPath}/${name}/${seq}`;
        if (name === 'submission_attempts') {
          return {
            path,
            async create(data) {
              if (path in mockState.attempts) {
                const err = new Error('6 ALREADY_EXISTS'); err.code = 6; throw err;
              }
              mockState.attempts[path] = data;
            },
            async get() {
              return path in mockState.attempts
                ? { exists: true, data: () => mockState.attempts[path] }
                : { exists: false, data: () => undefined };
            },
          };
        }
        if (name === 'dq_files') {
          return {
            async set(data, options) {
              const base = options && options.merge ? (mockState.dqFiles[path] || {}) : {};
              mockState.dqFiles[path] = { ...base, ...data };
            },
          };
        }
        return {
          path,
          async create(data) {
            if (mockState.createShouldFail) throw mockState.createShouldFail;
            // Real Firestore refuses an array nested in an array. Without this
            // the double accepted records production could never store, and a
            // driver's employment history silently cost them their record.
            assertStorableValue(data, path);
            if (path in mockState.snapshots) {
              const err = new Error('6 ALREADY_EXISTS'); err.code = 6; throw err;
            }
            mockState.snapshots[path] = data;
          },
          async get() {
            return path in mockState.snapshots
              ? { exists: true, data: () => mockState.snapshots[path] }
              : { exists: false, data: () => undefined };
          },
        };
      },
    }),
  };
}

const httpsMock = () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
};

const firestoreFieldValueMock = () => ({
  FieldValue: { serverTimestamp: () => ({ __srv: true }) },
});

const firebaseAdminMock = () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => ({ __srv: true }) } } },
  storage: {
    bucket: () => ({
      file: (path) => ({
        exists: async () => [path in mockState.storedPdfs],
        getMetadata: async () => [mockState.storedPdfs[path]?.options?.metadata || {}],
        save: async (buffer, options) => {
          if (options?.preconditionOpts?.ifGenerationMatch === 0 && path in mockState.storedPdfs) {
            const error = new Error('precondition failed'); error.code = 412; throw error;
          }
          mockState.storedPdfs[path] = { buffer, options };
        },
      }),
    }),
  },
  db: {
    // Serialised like Firestore's: the whole callback runs to completion before
    // another transaction starts, and its writes land atomically at the end.
    // That is what makes the attempt claim safe against a concurrent redelivery.
    runTransaction: async (fn) => {
      while (mockState.txLock) await mockState.txLock;
      let release;
      mockState.txLock = new Promise((resolve) => { release = resolve; });
      try {
        const writes = [];
        const tx = {
          get: (ref) => ref.get(),
          create: (ref, data) => { writes.push([ref, data]); },
        };
        const result = await fn(tx);
        for (const [ref, data] of writes) await ref.create(data);
        return result;
      } finally {
        mockState.txLock = null;
        release();
      }
    },
    collection: (col) => {
      if (col === 'public_profiles') {
        return { doc: () => ({ get: async () => (mockState.publicProfile
          ? { exists: true, data: () => mockState.publicProfile }
          : { exists: false }) }) };
      }
      if (col === 'companies') {
        return { doc: (companyId) => ({
          collection: () => ({ doc: (applicationId) => mockApplicationDoc(companyId, applicationId) }),
        }) };
      }
      return { doc: () => ({}) };
    },
  },
});

const companyTenantMock = () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({
    companyName: 'Artificial Freight Co',
    dotNumber: '1234567',
    address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
    contact: { email: 'hr@example.test', phone: '555-0100' },
    applicationConfig: {
      cdlUpload: { hidden: false, required: false },
      medCardUpload: { hidden: false, required: false },
    },
    customQuestions: [{ id: 'q-company', label: 'Company-doc question' }],
  }),
});

const rateLimiterMock = () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) });

const payload = (formData = {}) => ({
  companyId: 'co1',
  email: 'ann@example.test',
  phone: '5551234567',
  signature: 'data:image/png;base64,AAA',
  // `ssn` is present because a real submission carries it — the wizard requires it
  // on page one and only the *draft* copies strip it. The server refuses a
  // submission missing a required field the draft never carried.
  formData: { firstName: 'Ann', lastName: 'Adams', ssn: '123-45-6789', ...formData },
});
const ctx = { rawRequest: { ip: '203.0.113.1' } };

// The public profile REPLACES the company config, so a fixture that omits the
// upload gates would make CDL uploads required by default (correct behaviour,
// but not what these cases are exercising).
const NO_REQUIRED_UPLOADS = {
  cdlUpload: { hidden: false, required: false },
  medCardUpload: { hidden: false, required: false },
};

const storedSnapshots = () => Object.entries(mockState.snapshots);
const onlySnapshot = () => storedSnapshots()[0][1];

/** The original `beforeEach` body, unchanged. */
function resetSnapshotState() {
  jest.clearAllMocks();
  mockState.applications = {};
  mockState.snapshots = {};
  mockState.dqFiles = {};
  mockState.storedPdfs = {};
  mockState.publicProfile = null;
  mockState.createShouldFail = null;
  mockState.attempts = {};
  mockState.txLock = null;
}

module.exports = {
  httpsMock,
  firestoreFieldValueMock,
  firebaseAdminMock,
  companyTenantMock,
  rateLimiterMock,
  mockState,
  mockApplicationDoc,
  payload,
  ctx,
  NO_REQUIRED_UPLOADS,
  storedSnapshots,
  onlySnapshot,
  resetSnapshotState,
};
