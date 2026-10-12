// The numbers a RingCentral inventory sync reports are written by the keychain's
// own rule, so the merge in saveIntegrationConfig finds a line added by hand
// under the number the sync reports. All numbers are artificial.

jest.mock('@ringcentral/sdk', () => {
  class SDK {
    constructor() {}
  }
  SDK.server = { sandbox: 'sandbox', production: 'production' };
  return { SDK };
});

const RingCentralAdapter = require('../../integrations/adapters/ringcentral');
const { normalizePhoneForKeychain } = require('../../utils/phoneUtils');

const ACCOUNT_NUMBERS = [
  { phoneNumber: '+15551234567', type: 'VoiceFax', usageType: 'MainCompanyNumber' },
  { phoneNumber: '+1 (555) 765-4321', type: 'VoiceFax', usageType: 'DirectNumber' },
  { phoneNumber: '+15550000009', type: 'FaxOnly', usageType: 'DirectNumber' },
  { phoneNumber: '+', type: 'VoiceFax', usageType: 'DirectNumber' },
];
const EXTENSION_NUMBERS = [
  { phoneNumber: '+15551234567', type: 'VoiceFax', usageType: 'MainCompanyNumber' },
];

function adapterOverNumbers() {
  const adapter = new RingCentralAdapter({ clientId: 'cid', clientSecret: 'secret', jwt: 'jwt' });
  const answers = {
    '/restapi/v1.0/account/~/extension/~': { contact: { firstName: 'Artificial', lastName: 'Line' }, extensionNumber: '101' },
    '/restapi/v1.0/account/~/phone-number': { records: ACCOUNT_NUMBERS },
    '/restapi/v1.0/account/~/extension/~/phone-number': { records: EXTENSION_NUMBERS },
  };
  adapter.rc = {
    login: jest.fn().mockResolvedValue({}),
    get: jest.fn(async (path) => ({ json: async () => answers[path] })),
  };
  return adapter;
}

describe('RingCentralAdapter inventory sync', () => {
  it('reports each SMS-capable number once, in the keychain form', async () => {
    const inventory = await adapterOverNumbers().fetchAvailablePhoneNumbers();

    expect(inventory.map((line) => line.phoneNumber)).toEqual(['+15551234567', '+15557654321']);
    expect(inventory[0]).toMatchObject({ type: 'VoiceFax', usageType: 'MainCompanyNumber', status: 'available', assignedTo: null });
  });

  it('reports a line under the number it is keyed by when added as "(555) 123-4567"', async () => {
    const inventory = await adapterOverNumbers().fetchAvailablePhoneNumbers();

    expect(inventory.map((line) => line.phoneNumber)).toContain(normalizePhoneForKeychain('(555) 123-4567'));
  });
});
