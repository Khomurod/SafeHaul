/**
 * A submission marks the uploads it files as a submitted application's, and one
 * whose uploads are no longer in Storage is sent back to upload them, before
 * anything is written (`shared/guestUploads.js`).
 *
 * The case it is for: a Company Admin deleted the unfinished application with
 * its files, and the copy on the driver's device was submitted anyway.
 */

jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __srv: true }) },
}));

const mockSet = jest.fn().mockResolvedValue(undefined);
const mockStored = new Set();
const mockMarked = [];
/** What every document read finds, or nothing. */
let mockDocData = null;

/** Any document: empty unless `mockDocData` says otherwise, and writable, with collections of its own. */
function mockRef() {
  return {
    set: mockSet,
    get: async () => ({ exists: mockDocData !== null, data: () => mockDocData }),
    delete: async () => undefined,
    collection: () => mockCollection(),
  };
}
function mockCollection() {
  return { doc: () => mockRef(), get: async () => ({ docs: [], empty: true }) };
}

jest.mock('../../firebaseAdmin', () => ({
  storage: {
    bucket: () => ({
      file: (path) => ({
        setMetadata: async ({ metadata }) => {
          if (!mockStored.has(path)) throw Object.assign(new Error('No such object'), { code: 404 });
          mockMarked.push([path, metadata]);
        },
        save: async () => undefined,
      }),
    }),
  },
  db: { collection: () => mockCollection() },
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({ companyName: 'Tenant Co', applicationConfig: {} }),
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { submitGuestApplication } = require('../../guestApplication');

const FRONT = 'companies/co1/applications/guest_uploads/1696_ab12cd3_front.jpg';
const BACK = 'companies/co1/applications/guest_uploads/1696_ab12cd4_back.jpg';
const MEDICAL = 'companies/co1/applications/guest_uploads/1696_ab12cd5_medical.jpg';

const submit = (fields = {}) => submitGuestApplication({
  ...fields,
  companyId: 'co1',
  email: 'a@b.com',
  phone: '5551234567',
  signature: 'data:image/png;base64,AAA',
  formData: {
    ssn: '123-45-6789',
    'cdl-front': { name: 'front.jpg', storagePath: FRONT },
    'cdl-back': { name: 'back.jpg', storagePath: BACK },
    'medical-card-upload': { name: 'medical.jpg', storagePath: MEDICAL },
  },
}, { rawRequest: { ip: '203.0.113.1' } });

beforeEach(() => {
  jest.clearAllMocks();
  mockStored.clear();
  mockMarked.length = 0;
  mockDocData = null;
});

it('files the application when its uploads are there, each marked as a submitted application\'s', async () => {
  [FRONT, BACK, MEDICAL].forEach((path) => mockStored.add(path));

  await expect(submit()).resolves.toMatchObject({ success: true });
  expect(mockMarked).toEqual([FRONT, BACK, MEDICAL].map((path) => [path, { safehaulSubmitted: 'true' }]));
});

it('sends the driver back to the licence page, writing nothing, when an upload is gone', async () => {
  mockStored.add(BACK);
  mockStored.add(MEDICAL);

  const refusal = await submit().catch((error) => error);

  expect(refusal).toMatchObject({
    code: 'invalid-argument',
    details: { issues: [{ code: 'upload-missing', semanticStep: 'license', fieldId: 'cdl-front' }] },
  });
  expect(mockSet).not.toHaveBeenCalled();
});

it('marks nothing when a check before the filing refuses it', async () => {
  [FRONT, BACK, MEDICAL].forEach((path) => mockStored.add(path));
  // The carrier edited the draft after this copy last loaded it.
  mockDocData = { companyRevision: 5 };

  const refusal = await submit({ seenRevision: 4 }).catch((error) => error);

  expect(refusal).toMatchObject({ code: 'failed-precondition', details: { issues: [{ code: 'carrier-updated' }] } });
  expect(mockMarked).toEqual([]);
  expect(mockSet).not.toHaveBeenCalled();
});
