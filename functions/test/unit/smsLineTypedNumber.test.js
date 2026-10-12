// A line added by typing its number without the country code. "(555) 123-4567"
// was keyed as +5551234567, a different number, while RingCentral reports the
// line as +15551234567: the next inventory sync kept both entries, and the one a
// recruiter could be given had no key to send with. The callables, the merge and
// the factory are real; Firestore is a map of document paths, RingCentral a
// double. All data is artificial.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));
jest.mock('../../integrations/adapters/eightbyeight', () => class {});

// The JWT logs in, and the account's numbers come back as RingCentral writes them.
jest.mock('../../integrations/adapters/ringcentral', () => class RingCentralDouble {
  constructor(config) {
    this.config = config;
    this.rc = {
      login: async () => ({}),
      get: async () => ({ json: async () => ({ contact: { firstName: 'Artificial', lastName: 'Line' }, extensionNumber: '101' }) }),
    };
  }

  async fetchAvailablePhoneNumbers() {
    return [{ phoneNumber: '+15551234567', type: 'VoiceFax', usageType: 'DirectNumber', status: 'available', assignedTo: null }];
  }
});

const mockDocs = new Map();
jest.mock('../../firebaseAdmin', () => {
  const doc = (path) => ({
    get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
    set: async (data, options) => {
      mockDocs.set(path, options?.merge ? { ...mockDocs.get(path), ...data } : data);
    },
    update: async (data) => { mockDocs.set(path, { ...mockDocs.get(path), ...data }); },
    delete: async () => { mockDocs.delete(path); },
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
const { addPhoneLine, saveIntegrationConfig } = require('../../integrations/controllers/configController');
const SMSAdapterFactory = require('../../integrations/factory');

const OWNER = { uid: 'owner-1', token: { globalRole: 'super_admin', roles: {} } };
const PROVIDER = 'companies/co-1/integrations/sms_provider';

const addTypedLine = (phoneNumber) => addPhoneLine({
  auth: OWNER,
  data: {
    companyId: 'co-1',
    phoneNumber,
    jwt: 'artificial-line-jwt',
    clientId: 'artificial-client',
    clientSecret: 'artificial-secret',
    label: 'Dispatch',
  },
});

const syncInventory = () => saveIntegrationConfig({
  auth: OWNER,
  data: {
    companyId: 'co-1',
    provider: 'ringcentral',
    config: { clientId: '__PRESERVE__', clientSecret: '__PRESERVE__', isSandbox: false },
  },
});

beforeEach(() => {
  mockDocs.clear();
});

describe('an SMS line typed without +1', () => {
  it('is stored as the number it is, +1 and the ten digits', async () => {
    const result = await addTypedLine('(555) 123-4567');

    expect(result.phoneNumber).toBe('+15551234567');
    expect(mockDocs.has(`${PROVIDER}/keychain/+15551234567`)).toBe(true);
    expect(mockDocs.get(PROVIDER).inventory.map((line) => line.phoneNumber)).toEqual(['+15551234567']);
    expect(mockDocs.get(PROVIDER).defaultPhoneNumber).toBe('+15551234567');
  });

  it('is one line after a sync with RingCentral, and every line in the inventory can send', async () => {
    await addTypedLine('(555) 123-4567');
    await syncInventory();

    const { inventory } = mockDocs.get(PROVIDER);
    expect(inventory.map((line) => line.phoneNumber)).toEqual(['+15551234567']);
    for (const line of inventory) {
      await expect(SMSAdapterFactory.getKeychainEntry('co-1', line.phoneNumber))
        .resolves.toMatchObject({ jwt: 'artificial-line-jwt' });
    }
  });

  it('keeps a number written with + as it was written', async () => {
    const result = await addTypedLine('+44 20 7946 0958');

    expect(result.phoneNumber).toBe('+442079460958');
    expect(mockDocs.has(`${PROVIDER}/keychain/+442079460958`)).toBe(true);
  });
});
