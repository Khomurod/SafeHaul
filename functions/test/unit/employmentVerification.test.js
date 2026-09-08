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
    HelveticaOblique: 'HelveticaOblique',
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
        signatureMethod: null,
      });
      expect(savedStoragePaths).toEqual([]);
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
    // Step J (2026-09-06): the signature arrives as a drawn PNG or a typed
    // name and is validated by employmentVerification/signature.js before
    // anything is stored. These three pin what submitVerificationResponse
    // does with each outcome; the normaliser's own rules live in
    // pevSignature.test.js.
    const ONE_PIXEL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    function seedSubmittableRequest(token, applicationId) {
      verificationDocs.set(token, {
        token,
        status: 'sent',
        companyId: 'co-1',
        collectionName: 'applications',
        applicationId,
        employerIndex: 0,
        employerName: 'Old Carrier',
        applicantName: 'Jane Driver',
        companyName: 'SafeHaul Carrier',
        expiresAt: createTs(Date.now() + 60000),
        createdAt: createTs(),
      });
      applicationDocs.set(appKey('co-1', 'applications', applicationId), {
        employers: [{ name: 'Old Carrier' }],
      });
    }

    function submit(token, signatureFields) {
      return submitVerificationResponse({
        data: {
          token,
          response: {
            wasEmployed: true,
            respondentName: 'HR Lead',
            respondentTitle: 'HR Manager',
            respondentPhone: '555-222-3333',
            ...signatureFields,
          },
        },
        rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
      });
    }

    it('stores a typed signature as text, records the method, and writes nothing to Storage', async () => {
      seedSubmittableRequest('pev-token-3', 'app-3');

      const result = await submit('pev-token-3', {
        signatureData: 'TEXT_SIGNATURE:  HR Lead ',
        signatureMethod: 'typed',
      });

      expect(result.success).toBe(true);
      const stored = responseDocs.get('pev-token-3/submission');
      expect(stored).toMatchObject({ signatureMethod: 'typed', signatureText: 'HR Lead' });
      expect(stored.signaturePath).toBeUndefined();
      expect(savedStoragePaths).toEqual([]);
      expect(verificationDocs.get('pev-token-3')).toMatchObject({ status: 'completed' });
    });

    it('stores a drawn signature as a PNG in Storage and records the path and the method', async () => {
      seedSubmittableRequest('pev-token-4', 'app-4');

      const result = await submit('pev-token-4', {
        signatureData: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
        signatureMethod: 'drawn',
      });

      expect(result.success).toBe(true);
      const stored = responseDocs.get('pev-token-4/submission');
      expect(stored).toMatchObject({
        signatureMethod: 'drawn',
        signaturePath: 'companies/co-1/pev_signatures/pev-token-4.png',
      });
      expect(stored.signatureText).toBeUndefined();
      expect(savedStoragePaths).toEqual(['companies/co-1/pev_signatures/pev-token-4.png']);
    });

    it('refuses a signature that is neither a PNG nor a typed name before anything is stored', async () => {
      seedSubmittableRequest('pev-token-5', 'app-5');

      await expect(
        submit('pev-token-5', {
          signatureData: 'data:image/svg+xml;base64,PHN2Zy8+',
          signatureMethod: 'drawn',
        }),
      ).rejects.toMatchObject({ code: 'invalid-argument' });

      expect(responseDocs.has('pev-token-5/submission')).toBe(false);
      expect(savedStoragePaths).toEqual([]);
      expect(verificationDocs.get('pev-token-5').status).not.toBe('completed');
      expect(applicationDocs.get(appKey('co-1', 'applications', 'app-5')).employers[0].verification).toBeUndefined();
    });

  });
});
