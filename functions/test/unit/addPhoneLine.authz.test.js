// Tough authorization + encryption-at-rest tests for company-admin self-service phone
// provisioning (addPhoneLine / removePhoneLine). These are the callables the new
// company-admin SMS settings UI drives. We verify:
//   - the full RBAC matrix (super admin, company admin, wrong company, non-admin, anon)
//   - required-field validation
//   - that the JWT and per-line client credentials are ENCRYPTED at rest (never stored
//     or echoed back as plaintext) -- i.e. the secure design holds even though admins can
//     now self-provision.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

// Avoid pulling real SDKs through the factory.
jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));
jest.mock('../../integrations/adapters/eightbyeight', () => class {});

// RingCentral adapter that "successfully" verifies the JWT (no network).
jest.mock('../../integrations/adapters/ringcentral', () => {
  return class RingCentralAdapterMock {
    constructor(cfg) {
      this.config = cfg;
      this.rc = {
        login: jest.fn().mockResolvedValue({}),
        get: jest.fn().mockResolvedValue({
          json: async () => ({ contact: { firstName: 'Test', lastName: 'Line' }, extensionNumber: '101' }),
        }),
      };
    }
  };
});

// Recording Firestore mock. Captures every .set()/.update() with its doc path so we can
// inspect what was actually persisted to the keychain / provider doc.
const mockWrites = [];
jest.mock('firebase-admin', () => {
  const writes = mockWrites;
  const makeDoc = (path) => ({
    _path: path,
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    set: jest.fn(async (data, opts) => { writes.push({ path, op: 'set', data, opts }); }),
    update: jest.fn(async (data) => { writes.push({ path, op: 'update', data }); }),
    collection: (name) => makeCol(`${path}/${name}`),
  });
  const makeCol = (path) => ({
    doc: (id) => makeDoc(`${path}/${id ?? 'auto'}`),
    where: () => ({ where: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    add: async () => ({ id: 'auto' }),
  });
  return {
    firestore: Object.assign(
      () => ({ collection: (name) => makeCol(name) }),
      { FieldValue: { serverTimestamp: () => '__ts' } },
    ),
  };
});

// REAL encryption (not mocked) so we can prove round-trip encryption at rest.
const VALID_KEY = '01234567890123456789012345678901'; // 32 chars
process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
const enc = require('../../integrations/encryption');

const { addPhoneLine, removePhoneLine } = require('../../integrations/controllers/configController');

const req = (data, token = { roles: {} }) => ({ auth: { uid: 'u1', token }, data });
const VALID = {
  companyId: 'co1',
  phoneNumber: '+15551234567',
  jwt: 'super-secret-jwt-token-value',
  clientId: 'my-client-id',
  clientSecret: 'my-client-secret',
  isSandbox: false,
  label: 'Main Number',
};

beforeEach(() => {
  mockWrites.length = 0;
  jest.clearAllMocks();
  process.env.SMS_ENCRYPTION_KEY = VALID_KEY;
  if (enc._resetEncryptionKeyForTesting) enc._resetEncryptionKeyForTesting();
});

describe('addPhoneLine — authorization matrix', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(addPhoneLine({ data: VALID })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects missing required fields (companyId/phoneNumber/jwt)', async () => {
    await expect(addPhoneLine(req({ companyId: 'co1', phoneNumber: '+15551234567' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(addPhoneLine(req({ companyId: 'co1', jwt: 'x' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockWrites).toHaveLength(0);
  });

  it('rejects a non-admin member of the company (e.g. recruiter)', async () => {
    await expect(addPhoneLine(req(VALID, { roles: { co1: 'recruiter' } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockWrites).toHaveLength(0);
  });

  it('rejects a company admin of a DIFFERENT company (cross-tenant)', async () => {
    await expect(addPhoneLine(req(VALID, { roles: { 'other-co': 'company_admin' } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockWrites).toHaveLength(0);
  });

  it('allows a company admin of the target company', async () => {
    const res = await addPhoneLine(req(VALID, { roles: { co1: 'company_admin' } }));
    expect(res.success).toBe(true);
    expect(res.phoneNumber).toBe('+15551234567');
  });

  it('allows a global super admin', async () => {
    const res = await addPhoneLine(req(VALID, { globalRole: 'super_admin', roles: {} }));
    expect(res.success).toBe(true);
  });
});

describe('addPhoneLine — credentials are encrypted at rest', () => {
  it('stores the JWT + client secret ENCRYPTED (never plaintext), and they round-trip', async () => {
    await addPhoneLine(req(VALID, { roles: { co1: 'company_admin' } }));

    const keychainWrite = mockWrites.find(w => w.path.includes('/keychain/'));
    expect(keychainWrite).toBeTruthy();
    const kc = keychainWrite.data;

    // Stored value must NOT equal the plaintext...
    expect(kc.jwt).not.toBe(VALID.jwt);
    expect(kc.clientSecret).not.toBe(VALID.clientSecret);
    expect(kc.clientId).not.toBe(VALID.clientId);
    // ...must look like our IV:ciphertext envelope...
    expect(kc.jwt).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
    // ...and must decrypt back to the original.
    expect(enc.decrypt(kc.jwt)).toBe(VALID.jwt);
    expect(enc.decrypt(kc.clientSecret)).toBe(VALID.clientSecret);
    expect(enc.decrypt(kc.clientId)).toBe(VALID.clientId);

    // The shared provider config write must also store the secret encrypted.
    const providerWrite = mockWrites.find(w => w.path.endsWith('/integrations/sms_provider') && w.data.config);
    expect(providerWrite).toBeTruthy();
    expect(providerWrite.data.config.clientSecret).not.toBe(VALID.clientSecret);
    expect(enc.decrypt(providerWrite.data.config.clientSecret)).toBe(VALID.clientSecret);

    // The plaintext secret must appear in NO persisted write.
    const serialized = JSON.stringify(mockWrites);
    expect(serialized).not.toContain(VALID.jwt);
    expect(serialized).not.toContain(VALID.clientSecret);
  });

  it('returns no plaintext secret in the callable response', async () => {
    const res = await addPhoneLine(req(VALID, { roles: { co1: 'company_admin' } }));
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(VALID.jwt);
    expect(serialized).not.toContain(VALID.clientSecret);
  });
});

describe('removePhoneLine — authorization matrix', () => {
  const RVALID = { companyId: 'co1', phoneNumber: '+15551234567' };

  it('rejects unauthenticated callers', async () => {
    await expect(removePhoneLine({ data: RVALID })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a company admin of a different company', async () => {
    await expect(removePhoneLine(req(RVALID, { roles: { 'other-co': 'company_admin' } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a non-admin of the company', async () => {
    await expect(removePhoneLine(req(RVALID, { roles: { co1: 'hr_user' } })))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});
