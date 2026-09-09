/**
 * Shared harness for the `employmentVerification.*` suites.
 *
 * Split out of the single 525-line file on 2026-09-09 for the source-size
 * standard, when the request suite grew the cases that pin employer identity —
 * a Previous Employment Verification must never be able to land on the wrong
 * employer, and proving that takes more than one case.
 *
 * ## Why the mocks are factories rather than `jest.mock` calls
 *
 * `jest.mock` is hoisted to the top of the file it appears in, so it cannot be
 * moved into a helper module and still register. Each suite therefore keeps its
 * own one-line `jest.mock(path, () => require('./employmentVerification.support').xMock())`
 * and the *bodies* live here — which is what stops two copies of this Firestore
 * double drifting apart. The same arrangement `applicationDrafts.support.js`
 * documents at length, and for the same reason.
 *
 * Jest gives every test file its own module registry, so each suite starts from
 * empty stores.
 *
 * ## The `Once` hazard, checked
 *
 * `AGENTS.md` records that `clearAllMocks` does not drain a `*Once` queue. Neither
 * suite queues one today, so `resetPevState` keeps `clearAllMocks` and
 * re-establishes the three implementations below afterwards. A suite that starts
 * queuing one must drain that double itself with `mockReset()`, as
 * `companyApplications.invite.expiry.test.js` shows.
 */

// --- in-memory Firestore, keyed by path ------------------------------------
const verificationDocs = new Map();
const applicationDocs = new Map();
const responseDocs = new Map();
const companyDocs = new Map();
const savedStoragePaths = [];

const createTs = (ms = Date.now()) => ({
  toMillis: () => ms,
  toDate: () => new Date(ms),
});

function appKey(companyId, collectionName, applicationId) {
  return `${companyId}/${collectionName}/${applicationId}`;
}

function verificationDocRef(token) {
  return {
    id: token,
    get: jest.fn(async () => {
      const data = verificationDocs.get(token);
      return {
        exists: !!data,
        data: () => data,
        ref: verificationDocRef(token),
      };
    }),
    set: jest.fn(async (data) => {
      verificationDocs.set(token, { ...data });
    }),
    update: jest.fn(async (updates) => {
      const current = verificationDocs.get(token) || {};
      verificationDocs.set(token, { ...current, ...updates });
    }),
    collection: jest.fn((subcollection) => {
      if (subcollection !== 'responses') {
        return { doc: jest.fn(() => ({ set: jest.fn() })) };
      }
      return {
        doc: jest.fn((id) => ({
          set: jest.fn(async (data) => {
            responseDocs.set(`${token}/${id}`, { ...data });
          }),
        })),
      };
    }),
  };
}

/**
 * How many times each document has been written, by any path. `runTransaction`
 * reads it to decide whether a callback's view is still current.
 */
const versions = new Map();
const bump = (key) => versions.set(key, (versions.get(key) || 0) + 1);

/**
 * Somebody else's write, landing at the one moment that matters.
 *
 * A lost update needs a competing commit to arrive AFTER a transaction has read
 * and BEFORE it writes, and racing two callables through `Promise.all` leaves that
 * to microtask ordering — which is how a suite ends up passing for reasons nobody
 * chose. So a suite can install one out-of-band write here instead: it fires once,
 * on the first transactional read, after the snapshot has been handed over.
 */
let interference = null;
const setTransactionInterference = (fn) => { interference = fn; };

/** A write from outside any transaction, as a competing request would make it. */
const writeApplicationOutOfBand = (key, data) => {
  applicationDocs.set(key, data);
  bump(key);
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'verification_requests') {
      return {
        doc: jest.fn((token) => verificationDocRef(token)),
        where: jest.fn(() => ({ get: jest.fn(async () => ({ empty: true, docs: [] })) })),
      };
    }

    if (name === 'companies') {
      return {
        doc: jest.fn((companyId) => ({
          get: jest.fn(async () => ({
            exists: companyDocs.has(companyId),
            data: () => companyDocs.get(companyId),
          })),
          collection: jest.fn((subcollection) => ({
            doc: jest.fn((applicationId) => {
              const key = appKey(companyId, subcollection, applicationId);
              return {
                // The document's identity, so `runTransaction` below can tell
                // whether what it read has since been written by somebody else.
                _key: key,
                get: jest.fn(async () => {
                  const data = applicationDocs.get(key);
                  return {
                    exists: !!data,
                    data: () => data,
                  };
                }),
                update: jest.fn(async (updates) => {
                  const current = applicationDocs.get(key) || {};
                  applicationDocs.set(key, { ...current, ...updates });
                  bump(key);
                }),
              };
            }),
          })),
        })),
      };
    }

    return {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false, data: () => null })),
      })),
    };
  }),
  /**
   * A transaction that can actually LOSE, which is the only kind worth mocking.
   *
   * The previous version handed the callback the plain document ref: reads went
   * straight to the map and `update` applied immediately, so two interleaved
   * callbacks both read the pre-write array and both committed — the exact race a
   * transaction exists to stop, reproduced identically whether or not the code
   * under test used one. A test written against it could not tell the fix from the
   * bug.
   *
   * So this keeps a write counter per document, records the counter for everything
   * a callback read, buffers its writes, and re-runs the whole callback when any of
   * those documents moved underneath it. Optimistic concurrency, which is what
   * Firestore does.
   */
  runTransaction: jest.fn(async (fn) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const readAt = new Map();
      const writes = [];
      const txn = {
        get: async (docRef) => {
          if (docRef?._key) readAt.set(docRef._key, versions.get(docRef._key) || 0);
          const snapshot = await docRef.get();
          if (interference) {
            const compete = interference;
            interference = null;
            await compete();
          }
          return snapshot;
        },
        update: (docRef, updates) => { writes.push([docRef, updates]); },
      };
      const result = await fn(txn);
      const stale = [...readAt].some(([key, seen]) => (versions.get(key) || 0) !== seen);
      if (stale) continue;
      for (const [docRef, updates] of writes) await docRef.update(updates);
      return result;
    }
    throw new Error('mock transaction gave up after 5 attempts');
  }),
};


// --- spies the suites assert on -------------------------------------------
const mockSendDynamicEmail = jest.fn();
const mockCheckRateLimit = jest.fn();
const mockAssertCompanyAccessForRequest = jest.fn();

// --- mock factory bodies, verbatim from the original registrations --------

const httpsV2Mock = () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
});

const schedulerMock = () => ({ onSchedule: jest.fn((_schedule, fn) => fn) });

const functionsMock = () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
});

const emailServiceMock = () => ({
  sendDynamicEmail: (...args) => mockSendDynamicEmail(...args),
});

const rateLimiterMock = () => ({
  checkRateLimit: (...args) => mockCheckRateLimit(...args),
});

const companyAccessMock = () => ({
  assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
});

const uuidMock = () => ({ v4: jest.fn(() => 'pev-token-123456') });

/** PDF generation is not what these suites are about, and it is not free. */
const pdfLibMock = () => ({
  PDFDocument: {
    create: jest.fn(async () => {
      throw new Error('skip-pdf-generation-in-test');
    }),
  },
  rgb: jest.fn(() => ({})),
  StandardFonts: {
    Helvetica: 'Helvetica',
    HelveticaBold: 'HelveticaBold',
    HelveticaOblique: 'HelveticaOblique',
  },
});

const firebaseAdminMock = () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: jest.fn(() => createTs(Date.now())),
        fromMillis: jest.fn((ms) => createTs(ms)),
      },
      FieldValue: {
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true })),
      },
    },
  },
  db: mockDb,
  storage: {
    bucket: jest.fn(() => ({
      file: jest.fn((path) => ({
        save: jest.fn(async () => {
          savedStoragePaths.push(path);
        }),
        download: jest.fn(async () => [Buffer.from('')]),
      })),
    })),
  },
});

/** The original `beforeEach` body, unchanged. */
function resetPevState() {
  jest.clearAllMocks();
  verificationDocs.clear();
  applicationDocs.clear();
  responseDocs.clear();
  companyDocs.clear();
  versions.clear();
  interference = null;
  savedStoragePaths.length = 0;
  mockSendDynamicEmail.mockResolvedValue({ success: true });
  mockCheckRateLimit.mockResolvedValue(true);
  mockAssertCompanyAccessForRequest.mockResolvedValue(undefined);

  companyDocs.set('co-1', {
    companyName: 'SafeHaul Carrier',
    appUrl: 'https://safehaul.test',
    adminEmail: 'ops@safehaul.test',
  });
}

module.exports = {
  appKey,
  createTs,
  applicationDocs,
  companyDocs,
  responseDocs,
  savedStoragePaths,
  verificationDocs,
  mockAssertCompanyAccessForRequest,
  mockCheckRateLimit,
  mockSendDynamicEmail,
  companyAccessMock,
  emailServiceMock,
  firebaseAdminMock,
  functionsMock,
  httpsV2Mock,
  pdfLibMock,
  rateLimiterMock,
  schedulerMock,
  uuidMock,
  resetPevState,
  setTransactionInterference,
  writeApplicationOutOfBand,
};
