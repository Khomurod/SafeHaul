/**
 * The company-wording callables: who may read, who may publish, and that
 * publishing only ever adds a version.
 */
jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

const mockDb = { company: { companyName: 'Blue Line Freight' }, wording: {} };

jest.mock('../../firebaseAdmin', () => ({
  db: {
    // The callables publish and revert inside a transaction; the fake runs the
    // body once against the same in-memory documents.
    async runTransaction(body) {
      return body({
        get: (ref) => ref.get(),
        set: (ref, value) => ref.set(value),
      });
    },
    collection: () => ({
      doc: () => ({
        async get() { return { exists: true, data: () => mockDb.company }; },
        collection: () => ({
          async get() {
            return { docs: Object.entries(mockDb.wording).map(([id, data]) => ({ id, data: () => data })) };
          },
          doc: (agreementId) => ({
            async get() {
              const data = mockDb.wording[agreementId];
              return { exists: Boolean(data), data: () => data };
            },
            async set(next) { mockDb.wording[agreementId] = next; },
          }),
        }),
      }),
    }),
  },
}));

const mockAdminStrict = jest.fn(async () => {});
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAdminStrict: (...args) => mockAdminStrict(...args),
}));

const {
  listCompanyAgreementWording,
  publishCompanyAgreementWording,
  revertCompanyAgreementWording,
} = require('../../companyAgreements');

const superAdmin = { auth: { uid: 'sa-1', token: { globalRole: 'super_admin' } } };
const companyAdmin = { auth: { uid: 'admin-1', token: { roles: { co1: 'company_admin' } } } };
const anonymous = {};
const BODY = 'I authorize {{companyName}} to obtain my motor vehicle record from every state where I held a licence.';

beforeEach(() => {
  mockDb.wording = {};
  mockAdminStrict.mockClear();
});

describe('listCompanyAgreementWording', () => {
  it('describes every agreement with its platform text and the company state', async () => {
    const result = await listCompanyAgreementWording({ companyId: 'co1' }, superAdmin);
    expect(result.agreements.map((a) => a.id)).toEqual(['mvrAuthorization', 'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent']);
    const mvr = result.agreements[0];
    expect(mvr.platformVersion).toBe('v1');
    expect(mvr.platformBody).toContain('Blue Line Freight');
    expect(mvr.currentVersion).toBeNull();
    expect(mvr.versions).toEqual([]);
  });

  it('lets a company admin read, through the strict admin check', async () => {
    await listCompanyAgreementWording({ companyId: 'co1' }, companyAdmin);
    expect(mockAdminStrict).toHaveBeenCalledWith('admin-1', 'co1');
  });

  it('refuses anonymous callers and a missing company id', async () => {
    await expect(listCompanyAgreementWording({ companyId: 'co1' }, anonymous)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(listCompanyAgreementWording({}, superAdmin)).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('publishCompanyAgreementWording', () => {
  it('is super-admin only — a company admin cannot change legal wording', async () => {
    await expect(publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'mvrAuthorization', body: BODY }, companyAdmin))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockDb.wording).toEqual({});
  });

  it('publishes a content-addressed version and reports the new state', async () => {
    const result = await publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'mvrAuthorization', body: BODY, note: 'Counsel review' }, superAdmin);
    expect(result.currentVersion).toMatch(/^c-[0-9a-f]{12}$/);
    const stored = mockDb.wording.mvrAuthorization;
    expect(stored.currentVersion).toBe(result.currentVersion);
    expect(stored.versions[result.currentVersion]).toMatchObject({ body: BODY, createdBy: 'sa-1', note: 'Counsel review' });
    const described = result.agreements.find((a) => a.id === 'mvrAuthorization');
    expect(described.currentBody).toBe(BODY);
    expect(described.versions).toHaveLength(1);
  });

  it('a second publish adds a version and never rewrites the first', async () => {
    const first = await publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'mvrAuthorization', body: BODY }, superAdmin);
    const second = await publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'mvrAuthorization', body: `${BODY} Revised for 2027.` }, superAdmin);
    const stored = mockDb.wording.mvrAuthorization;
    expect(Object.keys(stored.versions)).toHaveLength(2);
    expect(stored.versions[first.currentVersion].body).toBe(BODY);
    expect(stored.currentVersion).toBe(second.currentVersion);
  });

  it('refuses unusable text and unknown agreements as invalid arguments', async () => {
    await expect(publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'mvrAuthorization', body: 'too short' }, superAdmin))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'nope', body: BODY }, superAdmin))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('revertCompanyAgreementWording', () => {
  it('returns the company to the platform wording while keeping its history', async () => {
    const published = await publishCompanyAgreementWording({ companyId: 'co1', agreementId: 'fcraDisclosure', body: BODY }, superAdmin);
    const result = await revertCompanyAgreementWording({ companyId: 'co1', agreementId: 'fcraDisclosure' }, superAdmin);
    expect(result.currentVersion).toBeNull();
    expect(mockDb.wording.fcraDisclosure.currentVersion).toBeNull();
    expect(mockDb.wording.fcraDisclosure.versions[published.currentVersion].body).toBe(BODY);
    expect(result.agreements.find((a) => a.id === 'fcraDisclosure').currentVersion).toBeNull();
  });

  it('is super-admin only', async () => {
    await expect(revertCompanyAgreementWording({ companyId: 'co1', agreementId: 'fcraDisclosure' }, companyAdmin))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});
