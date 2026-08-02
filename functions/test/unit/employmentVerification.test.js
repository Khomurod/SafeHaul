jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: jest.fn((_schedule, fn) => fn),
}));

jest.mock('firebase-functions', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockSendDynamicEmail = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../emailService', () => ({
  sendDynamicEmail: (...args) => mockSendDynamicEmail(...args),
}));

const mockCheckRateLimit = jest.fn().mockResolvedValue(true);
jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: (...args) => mockCheckRateLimit(...args),
}));

const mockAssertCompanyAccessForRequest = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'pev-token-123456'),
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: jest.fn(async () => {
      throw new Error('skip-pdf-generation-in-test');
    }),
  },
  rgb: jest.fn(() => ({})),
  StandardFonts: {
    Helvetica: 'Helvetica',
    HelveticaBold: 'HelveticaBold',
  },
}));

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
            doc: jest.fn((applicationId) => ({
              get: jest.fn(async () => {
                const key = appKey(companyId, subcollection, applicationId);
                const data = applicationDocs.get(key);
                return {
                  exists: !!data,
                  data: () => data,
                };
              }),
              update: jest.fn(async (updates) => {
                const key = appKey(companyId, subcollection, applicationId);
                const current = applicationDocs.get(key) || {};
                applicationDocs.set(key, { ...current, ...updates });
              }),
            })),
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
  runTransaction: jest.fn(async (fn) => {
    const txn = {
      get: async (docRef) => docRef.get(),
      update: (docRef, updates) => docRef.update(updates),
    };
    return fn(txn);
  }),
};

jest.mock('../../firebaseAdmin', () => ({
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
}));

const {
  sendVerificationRequest,
  getVerificationRequest,
  submitVerificationResponse,
} = require('../../employmentVerification');

describe('employmentVerification callables', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verificationDocs.clear();
    applicationDocs.clear();
    responseDocs.clear();
    companyDocs.clear();
    savedStoragePaths.length = 0;

    companyDocs.set('co-1', {
      companyName: 'SafeHaul Carrier',
      appUrl: 'https://safehaul.test',
      adminEmail: 'ops@safehaul.test',
    });
  });

  describe('sendVerificationRequest', () => {
    it('rejects unauthenticated requests', async () => {
      await expect(
        sendVerificationRequest({
          data: { companyId: 'co-1', applicationId: 'app-1', employerIndex: 0, applicantName: 'John Driver' },
        }),
      ).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('creates verification request and sends email', async () => {
      const result = await sendVerificationRequest({
        auth: { uid: 'user-1' },
        data: {
          companyId: 'co-1',
          applicationId: 'app-1',
          employerIndex: 0,
          applicantName: 'John Driver',
          employerName: 'Old Carrier',
          employerEmail: 'hr@oldcarrier.com',
          employmentStartDate: '2021-01-01',
          employmentEndDate: '2024-01-01',
          deliveryMethod: 'email',
        },
      });

      expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { uid: 'user-1' } }),
        'co-1',
        'PEV/sendVerificationRequest',
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('pev-token-123456');
      expect(result.verificationUrl).toBe('https://safehaul.test/verify/pev-token-123456');
      expect(mockSendDynamicEmail).toHaveBeenCalledWith(
        'co-1',
        'hr@oldcarrier.com',
        expect.stringContaining('Previous Employment Verification Request'),
        expect.stringContaining('/verify/pev-token-123456'),
      );
      expect(verificationDocs.get('pev-token-123456')).toMatchObject({
        companyId: 'co-1',
        applicationId: 'app-1',
        status: 'sent',
        applicantName: 'John Driver',
      });
    });
  });

  describe('getVerificationRequest', () => {
    it('returns completed state when request is already completed', async () => {
      verificationDocs.set('done-token', {
        status: 'completed',
        completedAt: createTs(),
      });

      const result = await getVerificationRequest({ data: { token: 'done-token' } });
      expect(result.status).toBe('completed');
      expect(result.message).toMatch(/already been completed/i);
    });

    it('returns pending data and marks request as opened', async () => {
      verificationDocs.set('pending-token', {
        status: 'sent',
        applicantName: 'Jane Driver',
        employerName: 'Past Fleet',
        companyName: 'SafeHaul Carrier',
        employmentStartDate: '2022-01-01',
        employmentEndDate: '2023-01-01',
        createdAt: createTs(),
        expiresAt: createTs(Date.now() + 60000),
      });

      const result = await getVerificationRequest({ data: { token: 'pending-token' } });
      expect(mockCheckRateLimit).toHaveBeenCalledWith('pev_read_pending-token', 20, 60, 'closed');
      expect(result).toMatchObject({
        status: 'pending',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
      });
      expect(verificationDocs.get('pending-token')).toMatchObject({ status: 'opened' });
    });
  });

  describe('submitVerificationResponse', () => {
    it('rejects submissions missing required respondent details', async () => {
      verificationDocs.set('pev-token-1', {
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId: 'app-1',
        employerIndex: 0,
        expiresAt: createTs(Date.now() + 60000),
      });

      await expect(
        submitVerificationResponse({
          data: {
            token: 'pev-token-1',
            response: {
              respondentName: 'Responder',
              respondentTitle: '',
              respondentPhone: '',
            },
            rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('stores response, updates status, and updates employer verification record', async () => {
      verificationDocs.set('pev-token-2', {
        token: 'pev-token-2',
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId: 'app-9',
        employerIndex: 0,
        employerName: 'Old Carrier',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
        expiresAt: createTs(Date.now() + 60000),
        createdAt: createTs(),
      });
      applicationDocs.set(appKey('co-1', 'applications', 'app-9'), {
        employers: [{ name: 'Old Carrier' }],
      });

      const result = await submitVerificationResponse({
        data: {
          token: 'pev-token-2',
          response: {
            wasEmployed: true,
            confirmedStartDate: '2020-01-01',
            confirmedEndDate: '2022-01-01',
            positionHeld: 'Driver',
            reasonForLeaving: 'Resigned',
            respondentName: 'HR Lead',
            respondentTitle: 'HR Manager',
            respondentPhone: '555-222-3333',
            signatureData: null,
          },
        },
        rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
      });

      expect(result.success).toBe(true);
      expect(responseDocs.get('pev-token-2/submission')).toMatchObject({
        respondentName: 'HR Lead',
        respondentTitle: 'HR Manager',
      });
      expect(verificationDocs.get('pev-token-2')).toMatchObject({ status: 'completed' });
      expect(applicationDocs.get(appKey('co-1', 'applications', 'app-9')).employers[0].verification).toMatchObject({
        status: 'Completed',
        respondentName: 'HR Lead',
      });
      expect(mockSendDynamicEmail).toHaveBeenCalledWith(
        'co-1',
        'ops@safehaul.test',
        expect.stringContaining('PEV Complete'),
        expect.stringContaining('Employment Verification Completed'),
      );
    });
  });
});
