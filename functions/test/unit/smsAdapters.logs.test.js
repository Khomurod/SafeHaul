/**
 * A text's log names the company's own line, never the number it is sent to:
 * a Cloud Functions log is read by everyone who can read the project's logs.
 * axios and the RingCentral SDK are mocked; nothing is sent, and every number
 * is artificial.
 */
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('@ringcentral/sdk', () => {
    class SDK {}
    SDK.server = { sandbox: 'sandbox', production: 'production' };
    return { SDK };
});

const axios = require('axios');
const EightByEightAdapter = require('../../integrations/adapters/eightbyeight');
const RingCentralAdapter = require('../../integrations/adapters/ringcentral');

const DRIVER = '+15558675309';

const logged = () => [console.log, console.info, console.warn, console.error]
    .flatMap((spy) => spy.mock.calls.flat())
    .map(String)
    .join('\n');

beforeEach(() => {
    jest.resetAllMocks();
    axios.post.mockImplementation(async () => ({ status: 202, data: { umid: 'artificial-umid' } }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('8x8 logs a send without the number it goes to', async () => {
    const adapter = new EightByEightAdapter({ apiKey: 'artificial-key', subAccountId: 'artificial-sub', phoneNumber: '+15550000001' });

    await adapter.sendSMS(DRIVER, 'hello');

    expect(axios.post.mock.calls[0][1].destination).toBe(DRIVER);
    expect(logged()).toContain('[8x8] Sending SMS');
    expect(logged()).not.toContain('5558675309');
});

it('RingCentral logs a send without the number it goes to', async () => {
    const adapter = new RingCentralAdapter({ clientId: 'cid', clientSecret: 'secret', jwt: 'jwt', defaultPhoneNumber: '+15550000001' });
    const post = jest.fn(async () => ({ json: async () => ({ id: 7, messageStatus: 'Queued' }) }));
    adapter.rc = { post };
    adapter.ensureLoggedIn = jest.fn(async () => {});

    await adapter.sendSMSWithReceipt(DRIVER, 'hello');

    expect(post.mock.calls[0][1].to).toEqual([{ phoneNumber: DRIVER }]);
    expect(logged()).toContain('[RC Adapter] Sending SMS');
    expect(logged()).not.toContain('5558675309');
});
