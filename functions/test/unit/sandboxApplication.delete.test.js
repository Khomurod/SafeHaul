// deleteSandboxApplication removes the test application's files as well as its
// record, and only files inside the sandbox's own Storage tree. Transferring a
// sandbox application to a real company must still leave its files in place,
// because the moved record keeps pointing at them.

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
const mockRecursiveDelete = jest.fn(async () => {});
const mockSet = jest.fn(async () => {});
const mockFileDelete = jest.fn(async () => {});
const mockDeleteFiles = jest.fn(async () => {});

const mockRefFor = (companyId, applicationId) => {
  const key = `${companyId}/${applicationId}`;
  return {
    key,
    get: async () => (mockDocs.has(key)
      ? { exists: true, data: () => mockDocs.get(key) }
      : { exists: false, data: () => undefined }),
    set: (...a) => mockSet(key, ...a),
  };
};

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: () => ({
      doc: (companyId) => ({ collection: () => ({ doc: (applicationId) => mockRefFor(companyId, applicationId) }) }),
    }),
    recursiveDelete: (ref) => mockRecursiveDelete(ref.key),
  },
  storage: {
    bucket: () => ({
      file: (path) => ({ delete: () => mockFileDelete(path) }),
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
  beforeEach(() => {
    // Jest's reset drops every implementation, so the tenant check's answer is set again here.
    jest.resetAllMocks();
    assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Real Co' });
    mockDocs.clear();
    mockDocs.set('SANDBOX/app1', { companyId: 'SANDBOX', 'cdl-front': { storagePath: upload } });
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
