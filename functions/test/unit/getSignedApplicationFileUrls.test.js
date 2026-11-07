/**
 * `getSignedApplicationFileUrls`: a record's driver uploads signed in one call,
 * each one exactly as `getSignedApplicationFileUrl` signs it. A file the single
 * call refuses is refused alone, with the single call's code and message; the
 * caller's access is checked for each company named, never widened; links last
 * an hour; neither call writes anything.
 *
 * All ids and paths below are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

const mockAssertCompanyAccessForRequest = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
}));

const mockExists = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockCollection = jest.fn();

jest.mock('../../firebaseAdmin', () => ({
  storage: { bucket: jest.fn() },
  db: { collection: (...args) => mockCollection(...args) },
}));

const { HttpsError } = require('firebase-functions/v2/https');
const { getSignedApplicationFileUrl, getSignedApplicationFileUrls } = require('../../getSignedApplicationFileUrl');
const { storage } = require('../../firebaseAdmin');

const CDL = 'companies/co-1/applications/guest_uploads/abc_cdl-front.jpg';
const MED = 'companies/co-1/applications/guest_uploads/abc_medical.pdf';
const OTHER_COMPANY = 'companies/co-2/applications/guest_uploads/xyz_cdl-front.jpg';
const AUTH = { uid: 'u1' };

const signedUrlFor = (path) => `https://signed.safehaul.test/${path}`;

/** What the single call answers for a path: `{ url }` or `{ error: { code, message } }`. */
async function singleAnswer(storagePath) {
  try {
    const { url } = await getSignedApplicationFileUrl({ auth: AUTH, data: { storagePath } });
    return { url };
  } catch (err) {
    return { error: { code: err.code, message: err.message } };
  }
}

describe('getSignedApplicationFileUrls', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    storage.bucket.mockImplementation(() => ({
      file: jest.fn((path) => ({
        exists: () => mockExists(path),
        getSignedUrl: (opts) => mockGetSignedUrl(path, opts),
      })),
    }));
    mockExists.mockResolvedValue([true]);
    mockGetSignedUrl.mockImplementation(async (path) => [signedUrlFor(path)]);
    mockAssertCompanyAccessForRequest.mockResolvedValue(undefined);
  });

  it('requires authentication', async () => {
    await expect(
      getSignedApplicationFileUrls({ data: { storagePaths: [CDL] } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockAssertCompanyAccessForRequest).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['no list', {}],
    ['an empty list', { storagePaths: [] }],
    ['a list that is not an array', { storagePaths: CDL }],
    ['a path that is not a string', { storagePaths: [CDL, { path: MED }] }],
    ['an empty path', { storagePaths: [CDL, ''] }],
    ['more than eight files', { storagePaths: Array.from({ length: 9 }, (_, i) => `${CDL}-${i}`) }],
  ])('refuses %s before checking anything', async (_name, data) => {
    await expect(getSignedApplicationFileUrls({ auth: AUTH, data })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockAssertCompanyAccessForRequest).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("signs a record's files in one call, each a one-hour link, checking the company once", async () => {
    const res = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL, MED] } });

    expect(res).toEqual({
      success: true,
      results: { [CDL]: { url: signedUrlFor(CDL) }, [MED]: { url: signedUrlFor(MED) } },
    });
    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledTimes(1);
    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ auth: AUTH }),
      'co-1',
      'getSignedApplicationFileUrls',
    );
    expect(mockExists).toHaveBeenCalledTimes(2);
    for (const [, opts] of mockGetSignedUrl.mock.calls) {
      expect(opts).toMatchObject({ version: 'v4', action: 'read' });
      expect(opts.expires).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
      expect(opts.expires).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    }
  });

  it('signs a path named twice once', async () => {
    const res = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL, CDL] } });

    expect(Object.keys(res.results)).toEqual([CDL]);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('refuses every file of a company the caller may not access, and signs none', async () => {
    mockAssertCompanyAccessForRequest.mockRejectedValue(new HttpsError('permission-denied', 'You do not have access to this company.'));

    const res = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL, MED] } });

    const denied = { error: { code: 'permission-denied', message: 'You do not have access to this company.' } };
    expect(res.results).toEqual({ [CDL]: denied, [MED]: denied });
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses another company's file alone, and still signs the caller's own", async () => {
    mockAssertCompanyAccessForRequest.mockImplementation(async (_request, companyId) => {
      if (companyId !== 'co-1') throw new HttpsError('permission-denied', 'You do not have access to this company.');
    });

    const res = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL, OTHER_COMPANY] } });

    expect(res.results[CDL]).toEqual({ url: signedUrlFor(CDL) });
    expect(res.results[OTHER_COMPANY]).toEqual({
      error: { code: 'permission-denied', message: 'You do not have access to this company.' },
    });
    expect(mockAssertCompanyAccessForRequest.mock.calls.map(([, companyId]) => companyId).sort()).toEqual(['co-1', 'co-2']);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledWith(CDL, expect.anything());
  });

  it('answers each file as the single call answers it', async () => {
    const BAD_FORMAT = 'companies/co-1/leads/guest_uploads/x.jpg';
    const TOO_SHORT = 'companies/co-1/applications/guest_uploads';
    const GONE = 'companies/co-1/applications/guest_uploads/abc_gone.jpg';
    const BROKEN = 'companies/co-1/applications/guest_uploads/abc_broken.jpg';
    const DENIED = 'companies/co-3/autofill/guest_uploads/abc_cdl.jpg';
    const UNVERIFIED = 'companies/co-4/applications/guest_uploads/abc_cdl.jpg';
    mockExists.mockImplementation(async (path) => [path !== GONE]);
    mockGetSignedUrl.mockImplementation(async (path) => {
      if (path === BROKEN) throw new Error('signing service down');
      return [signedUrlFor(path)];
    });
    mockAssertCompanyAccessForRequest.mockImplementation(async (_request, companyId) => {
      if (companyId === 'co-3') throw new HttpsError('permission-denied', 'You do not have access to this company.');
      if (companyId === 'co-4') throw new HttpsError('internal', 'Unable to verify company access.');
    });
    const paths = [CDL, BAD_FORMAT, TOO_SHORT, GONE, BROKEN, DENIED, UNVERIFIED];

    const singles = {};
    for (const path of paths) singles[path] = await singleAnswer(path);
    const { results } = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: paths } });

    expect(results).toEqual(singles);
    expect(results[CDL]).toEqual({ url: signedUrlFor(CDL) });
    expect(results[BAD_FORMAT].error.code).toBe('invalid-argument');
    expect(results[TOO_SHORT].error.code).toBe('invalid-argument');
    expect(results[GONE].error.code).toBe('not-found');
    expect(results[BROKEN].error).toEqual({ code: 'internal', message: 'Failed to generate download URL.' });
    expect(results[DENIED].error.code).toBe('permission-denied');
    expect(results[UNVERIFIED].error.code).toBe('internal');
  });

  it('answers an unexpected failure as internal, without its message', async () => {
    mockAssertCompanyAccessForRequest.mockRejectedValue(new Error('raw detail'));

    const { results } = await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL] } });

    expect(results[CDL]).toEqual({ error: { code: 'internal', message: 'INTERNAL' } });
  });

  it('writes no record, as the single call writes none', async () => {
    await getSignedApplicationFileUrls({ auth: AUTH, data: { storagePaths: [CDL, MED] } });
    await getSignedApplicationFileUrl({ auth: AUTH, data: { storagePath: CDL } });

    expect(mockCollection).not.toHaveBeenCalled();
  });
});
