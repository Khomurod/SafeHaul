jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));

const mockAssertCompanyAdminStrict = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAdminStrict: (...a) => mockAssertCompanyAdminStrict(...a),
}));

const mockGet = jest.fn();
const mockRecursiveDelete = jest.fn().mockResolvedValue();
const mockFileDelete = jest.fn().mockResolvedValue();
const mockDeleteFiles = jest.fn().mockResolvedValue();
const mockRef = { id: 'app1' };

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => mockRef }) }) }),
    recursiveDelete: (...a) => mockRecursiveDelete(...a),
  },
  storage: {
    bucket: () => ({
      file: () => ({ delete: (...a) => mockFileDelete(...a) }),
      deleteFiles: (...a) => mockDeleteFiles(...a),
    }),
  },
}));

const { deleteApplication, collectStoragePaths } = require('../../deleteApplication');

const req = (data) => ({ auth: { uid: 'admin1' }, data });

describe('deleteApplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertCompanyAdminStrict.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({ exists: true, data: () => ({ 'cdl-front': { storagePath: 'companies/co1/applications/guest_uploads/x.jpg' } }) });
    mockRef.get = (...a) => mockGet(...a);
  });

  it('requires authentication', async () => {
    await expect(deleteApplication({ data: { companyId: 'co1', applicationId: 'app1' } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects missing ids', async () => {
    await expect(deleteApplication(req({ companyId: 'co1' }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an invalid collectionName', async () => {
    await expect(deleteApplication(req({ companyId: 'co1', applicationId: 'app1', collectionName: 'secrets' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('enforces company_admin RBAC before deleting', async () => {
    const denied = new Error('denied'); denied.code = 'permission-denied';
    mockAssertCompanyAdminStrict.mockRejectedValueOnce(denied);
    await expect(deleteApplication(req({ companyId: 'co1', applicationId: 'app1' })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('returns not-found when the application does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    await expect(deleteApplication(req({ companyId: 'co1', applicationId: 'nope' })))
      .rejects.toMatchObject({ code: 'not-found' });
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('cascade-deletes the doc and cleans up storage on success', async () => {
    const res = await deleteApplication(req({ companyId: 'co1', applicationId: 'app1' }));
    expect(res).toEqual({ success: true, applicationId: 'app1', collectionName: 'applications' });
    expect(mockAssertCompanyAdminStrict).toHaveBeenCalledWith('admin1', 'co1');
    expect(mockFileDelete).toHaveBeenCalledTimes(1); // the cdl-front storagePath
    expect(mockDeleteFiles).toHaveBeenCalledWith({ prefix: 'companies/co1/applications/app1/' });
    expect(mockRecursiveDelete).toHaveBeenCalledWith(mockRef);
  });

  it('still deletes the doc if storage cleanup throws', async () => {
    mockDeleteFiles.mockRejectedValueOnce(new Error('storage boom'));
    const res = await deleteApplication(req({ companyId: 'co1', applicationId: 'app1' }));
    expect(res).toMatchObject({ success: true });
    expect(mockRecursiveDelete).toHaveBeenCalled();
  });
});

describe('collectStoragePaths', () => {
  it('gathers storagePath from file-field objects only', () => {
    const paths = collectStoragePaths({
      firstName: 'John',
      'cdl-front': { storagePath: 'a/b.jpg', url: 'x' },
      'cdl-back': { name: 'no-path' },
      nested: { storagePath: 'c/d.pdf' },
    });
    expect(paths.sort()).toEqual(['a/b.jpg', 'c/d.pdf']);
  });
});
