// deleteSandboxApplication removes the test application's files as well as its
// record, and only files inside the sandbox's own Storage tree. Transferring a
// sandbox application to a real company must still leave its uploads in place,
// because the moved record keeps pointing at them, and takes its frozen
// submission, the rest of its subcollections and its preserved PDF with it.

jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn(),
}));

const mockDocs = new Map();
/** `company/application` -> { subcollection: { docId: data } } */
const mockSubDocs = new Map();
/** Stored object paths, for the preserved PDFs. */
const mockObjects = new Set();
/** What happened, in order, so a test can see nothing is deleted before it is copied. */
const mockEvents = [];
const mockRecursiveDelete = jest.fn(async (key) => { mockEvents.push(`recursiveDelete ${key}`); });
const mockSet = jest.fn(async (key) => { mockEvents.push(`set ${key}`); });
const mockSubSet = jest.fn();
const mockFileDelete = jest.fn(async (path) => { mockEvents.push(`delete ${path}`); });
const mockDeleteFiles = jest.fn(async () => {});
const mockCopy = jest.fn(async (from, to) => {
  if (mockObjects.has(to)) throw Object.assign(new Error('precondition failed'), { code: 412 });
  mockObjects.add(to);
  mockEvents.push(`copy ${from} -> ${to}`);
});

const mockRefFor = (companyId, applicationId) => {
  const key = `${companyId}/${applicationId}`;
  return {
    key,
    get: async () => (mockDocs.has(key)
      ? { exists: true, data: () => mockDocs.get(key) }
      : { exists: false, data: () => undefined }),
    set: (...a) => mockSet(key, ...a),
    collection: (sub) => ({
      get: async () => ({
        docs: Object.entries((mockSubDocs.get(key) || {})[sub] || {}).map(([docId, data]) => ({ id: docId, data: () => data })),
      }),
      doc: (docId) => ({ key: `${key}/${sub}/${docId}` }),
    }),
  };
};

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: () => ({
      doc: (companyId) => ({ collection: () => ({ doc: (applicationId) => mockRefFor(companyId, applicationId) }) }),
    }),
    batch: () => {
      const pending = [];
      return {
        set: (ref, data) => pending.push([ref.key, data]),
        commit: async () => pending.forEach(([key, data]) => { mockSubSet(key, data); mockEvents.push(`set ${key}`); }),
      };
    },
    recursiveDelete: (ref) => mockRecursiveDelete(ref.key),
  },
  storage: {
    bucket: () => ({
      file: (path) => ({
        name: path,
        delete: () => mockFileDelete(path),
        copy: (destination, options) => mockCopy(path, destination.name, options),
      }),
      getFiles: async ({ prefix }) => [[...mockObjects].filter((path) => path.startsWith(prefix)).map((path) => ({
        name: path,
        copy: (destination, options) => mockCopy(path, destination.name, options),
      }))],
      deleteFiles: (...a) => mockDeleteFiles(...a),
    }),
  },
}));

const { deleteSandboxApplication, transferSandboxApplication } = require('../../sandboxApplication');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');

const superAdmin = { auth: { token: { globalRole: 'super_admin' } } };
const upload = 'companies/SANDBOX/applications/guest_uploads/1_cdl.png';
const answerUpload = 'companies/SANDBOX/applications/guest_uploads/2_resume.pdf';
const realCompanyFile = 'companies/REAL/drivers/d1/dq_files/medical.pdf';

describe('deleteSandboxApplication', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDocs.clear();
    mockDocs.set('SANDBOX/app1', {
      companyId: 'SANDBOX',
      'cdl-front': { name: 'cdl.png', storagePath: upload },
      'cdl-back': { name: 'crafted.pdf', storagePath: realCompanyFile },
      customAnswers: { q1: { name: 'resume.pdf', storagePath: answerUpload } },
    });
  });

  it('is for super admins only', async () => {
    await expect(deleteSandboxApplication({ applicationId: 'app1' }, { auth: { token: {} } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
    expect(mockFileDelete).not.toHaveBeenCalled();
  });

  it('refuses a record that is not a sandbox application, touching nothing', async () => {
    mockDocs.set('SANDBOX/app2', { companyId: 'REAL', 'cdl-front': { storagePath: upload } });
    await expect(deleteSandboxApplication({ applicationId: 'app2' }, superAdmin))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mockFileDelete).not.toHaveBeenCalled();
    expect(mockDeleteFiles).not.toHaveBeenCalled();
  });

  it('removes the uploads, the application folder and the preserved PDF, then the record', async () => {
    await expect(deleteSandboxApplication({ applicationId: 'app1' }, superAdmin)).resolves.toEqual({ success: true });
    expect(mockFileDelete.mock.calls.map(([path]) => path).sort()).toEqual([answerUpload, upload].sort());
    expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'companies/SANDBOX/applications/app1/' });
    expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'application_originals/SANDBOX/app1/' });
    expect(mockRecursiveDelete).toHaveBeenCalledWith('SANDBOX/app1');
  });

  it("never deletes a path outside the sandbox's own tree", async () => {
    await deleteSandboxApplication({ applicationId: 'app1' }, superAdmin);
    expect(mockFileDelete).not.toHaveBeenCalledWith(realCompanyFile);
  });

  it('still deletes the record when the Storage cleanup fails', async () => {
    mockDeleteFiles.mockRejectedValue(new Error('storage down'));
    mockFileDelete.mockRejectedValue(new Error('not found'));
    await expect(deleteSandboxApplication({ applicationId: 'app1' }, superAdmin)).resolves.toEqual({ success: true });
    expect(mockRecursiveDelete).toHaveBeenCalledWith('SANDBOX/app1');
  });
});

describe('transferSandboxApplication', () => {
  const originalPdf = 'application_originals/SANDBOX/app1/v1.pdf';
  const movedPdf = 'application_originals/REAL/app1/v1.pdf';

  beforeEach(() => {
    // Jest's reset drops every implementation, so each one is set again here.
    jest.resetAllMocks();
    assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Real Co' });
    mockRecursiveDelete.mockImplementation(async (key) => { mockEvents.push(`recursiveDelete ${key}`); });
    mockSet.mockImplementation(async (key) => { mockEvents.push(`set ${key}`); });
    mockFileDelete.mockImplementation(async (path) => { mockEvents.push(`delete ${path}`); });
    mockCopy.mockImplementation(async (from, to) => {
      if (mockObjects.has(to)) throw Object.assign(new Error('precondition failed'), { code: 412 });
      mockObjects.add(to);
      mockEvents.push(`copy ${from} -> ${to}`);
    });
    mockDocs.clear();
    mockSubDocs.clear();
    mockObjects.clear();
    mockEvents.length = 0;
    mockDocs.set('SANDBOX/app1', { companyId: 'SANDBOX', 'cdl-front': { storagePath: upload } });
  });

  const transfer = () => transferSandboxApplication({ applicationId: 'app1', targetCompanyId: 'REAL' }, superAdmin);

  function seedSubmission() {
    mockSubDocs.set('SANDBOX/app1', {
      submission: { v1: { companyId: 'SANDBOX', sequence: 1, frozen: true } },
      submission_attempts: { a1: { snapshotId: 'v1', sequence: 1 } },
      dq_files: { 'application-pdf-v1': { companyId: 'SANDBOX', storagePath: originalPdf } },
      activity_logs: { l1: { action: 'callback_scheduled' } },
      activities: { c1: { type: 'call' } },
    });
    mockObjects.add(originalPdf);
  }

  it('takes the frozen submission, its attempt claims and DQ entries, pointed at the company, and not the history', async () => {
    seedSubmission();

    await transfer();

    // History created under the company would set off its call and callback
    // triggers, so it stays behind with the sandbox record.
    const written = Object.fromEntries(mockSubSet.mock.calls);
    expect(written).toEqual({
      'REAL/app1/submission/v1': { companyId: 'REAL', sequence: 1, frozen: true },
      'REAL/app1/submission_attempts/a1': { snapshotId: 'v1', sequence: 1 },
      'REAL/app1/dq_files/application-pdf-v1': { companyId: 'REAL', storagePath: movedPdf },
    });
  });

  it('copies the preserved PDF to the company, then removes the sandbox copy, then the record', async () => {
    seedSubmission();

    await transfer();

    expect(mockCopy).toHaveBeenCalledWith(originalPdf, movedPdf, { preconditionOpts: { ifGenerationMatch: 0 } });
    const at = (event) => mockEvents.indexOf(event);
    expect(at(`copy ${originalPdf} -> ${movedPdf}`)).toBeLessThan(at('set REAL/app1'));
    expect(at('set REAL/app1/submission/v1')).toBeLessThan(at('set REAL/app1'));
    expect(at('set REAL/app1')).toBeLessThan(at(`delete ${originalPdf}`));
    expect(at(`delete ${originalPdf}`)).toBeLessThan(at('recursiveDelete SANDBOX/app1'));
  });

  it('keeps the sandbox record and its PDF when the copy fails', async () => {
    seedSubmission();
    mockCopy.mockRejectedValue(new Error('storage down'));

    await expect(transfer()).rejects.toThrow('storage down');

    expect(mockRecursiveDelete).not.toHaveBeenCalled();
    expect(mockFileDelete).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('finishes a transfer run again after a PDF was already copied', async () => {
    seedSubmission();
    mockObjects.add(movedPdf);

    await expect(transfer()).resolves.toMatchObject({ success: true });

    expect(mockSubSet).toHaveBeenCalledWith('REAL/app1/dq_files/application-pdf-v1', expect.objectContaining({ storagePath: movedPdf }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith('SANDBOX/app1');
  });

  it('moves the record and leaves its files where the moved record points', async () => {
    await expect(transferSandboxApplication({ applicationId: 'app1', targetCompanyId: 'REAL' }, superAdmin))
      .resolves.toMatchObject({ success: true, companyId: 'REAL' });
    expect(mockSet).toHaveBeenCalledWith('REAL/app1', expect.objectContaining({
      companyId: 'REAL',
      'cdl-front': { storagePath: upload },
    }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith('SANDBOX/app1');
    expect(mockFileDelete).not.toHaveBeenCalled();
    expect(mockDeleteFiles).not.toHaveBeenCalled();
  });
});
