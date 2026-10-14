// Saving an SMS setup again, with its keys left blank. The form sends
// __PRESERVE__ for each, and the provider was checked with that marker as its
// key: the check failed, and the lines the failed sync did not read were
// dropped. The screen before this one also sent the stored SubAccount ID and
// sender number back as it read them, encrypted, and they were encrypted again.
// The callable, the encryption and the merge are real; Firestore is a map of
// document paths, the providers doubles. All data is artificial.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));

const mockCheckedWith = [];
// The shared settings hold no line's JWT, so RingCentral's sync cannot log in.
jest.mock('../../integrations/adapters/ringcentral', () => class RingCentralDouble {
  constructor(config) { this.config = config; mockCheckedWith.push(config); }

  async fetchAvailablePhoneNumbers() {
    throw new Error('Failed to fetch number inventory: no JWT to log in with');
  }
});
jest.mock('../../integrations/adapters/eightbyeight', () => class EightByEightDouble {
  constructor(config) { this.config = config; mockCheckedWith.push(config); }

  async fetchAvailablePhoneNumbers() {
    return [{ phoneNumber: '+15550001111', type: 'SMS', usageType: 'DirectNumber', status: 'available', assignedTo: null }];
  }
});

const mockDocs = new Map();
jest.mock('../../firebaseAdmin', () => {
  const doc = (path) => ({
    get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
    set: async (data, options) => {
      mockDocs.set(path, options?.merge ? { ...mockDocs.get(path), ...data } : data);
    },
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id}`),
    where: () => ({ where: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
  });
  return {
    admin: {
      firestore: Object.assign(() => ({ collection }), { FieldValue: { serverTimestamp: () => 'server-time' } }),
    },
  };
});

process.env.SMS_ENCRYPTION_KEY = '01234567890123456789012345678901';
const { encrypt, decrypt } = require('../../integrations/encryption');
const { saveIntegrationConfig } = require('../../integrations/controllers/configController');

const OWNER = { uid: 'owner-1', token: { globalRole: 'super_admin', roles: {} } };
const PROVIDER = 'companies/co-1/integrations/sms_provider';
const KEEP = '__PRESERVE__';

const save = (provider, config) => saveIntegrationConfig({ auth: OWNER, data: { companyId: 'co-1', provider, config } });

const storeEightByEight = () => {
  const stored = {
    apiKey: encrypt('artificial-key'),
    apiSecret: encrypt('artificial-secret'),
    subAccountId: encrypt('artificial_hq'),
    phoneNumber: encrypt('+15550001111'),
    isSandbox: 'false',
  };
  mockDocs.set(PROVIDER, {
    provider: '8x8',
    config: stored,
    inventory: [{ phoneNumber: '+15550001111', usageType: 'DirectNumber' }],
    defaultPhoneNumber: '+15550001111',
  });
  return stored;
};

beforeEach(() => {
  mockDocs.clear();
  mockCheckedWith.length = 0;
});

describe('an SMS setup saved again with its keys left blank', () => {
  it('is checked with the keys it stores, not the marker', async () => {
    storeEightByEight();

    await save('8x8', { apiKey: KEEP, apiSecret: KEEP, subAccountId: KEEP, phoneNumber: KEEP, isSandbox: 'false' });

    expect(mockCheckedWith).toHaveLength(1);
    expect(mockCheckedWith[0]).toMatchObject({
      apiKey: 'artificial-key',
      apiSecret: 'artificial-secret',
      subAccountId: 'artificial_hq',
      phoneNumber: '+15550001111',
    });
    const saved = mockDocs.get(PROVIDER);
    expect(saved.defaultPhoneNumber).toBe('+15550001111');
    expect(decrypt(saved.config.subAccountId)).toBe('artificial_hq');
  });

  it('keeps the SubAccount ID and sender number the older screen sends back as it read them', async () => {
    const stored = storeEightByEight();

    await save('8x8', {
      apiKey: KEEP,
      apiSecret: KEEP,
      subAccountId: stored.subAccountId,
      phoneNumber: stored.phoneNumber.replace(/[^\d+]/g, ''),
      isSandbox: 'false',
    });

    const saved = mockDocs.get(PROVIDER);
    expect(decrypt(saved.config.subAccountId)).toBe('artificial_hq');
    expect(decrypt(saved.config.phoneNumber)).toBe('+15550001111');
    expect(saved.defaultPhoneNumber).toBe('+15550001111');
  });

  it('keeps every stored line when the number sync cannot run, and says the check failed', async () => {
    mockDocs.set(PROVIDER, {
      provider: 'ringcentral',
      config: { clientId: encrypt('artificial-client'), clientSecret: encrypt('artificial-secret'), isSandbox: 'false' },
      inventory: [
        { phoneNumber: '+15550002222', usageType: 'MainCompanyNumber' },
        { phoneNumber: '+15550003333', usageType: 'DirectNumber' },
      ],
      defaultPhoneNumber: '+15550002222',
    });

    const result = await save('ringcentral', { clientId: KEEP, clientSecret: KEEP, isSandbox: 'false' });

    expect(mockCheckedWith[0]).toMatchObject({ clientId: 'artificial-client', clientSecret: 'artificial-secret' });
    expect(result.warning).toMatch(/verification failed/);
    const saved = mockDocs.get(PROVIDER);
    expect(saved.inventory.map((line) => line.phoneNumber)).toEqual(['+15550002222', '+15550003333']);
    expect(saved.defaultPhoneNumber).toBe('+15550002222');
  });
});
