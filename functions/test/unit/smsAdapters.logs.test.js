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

// Every argument as a log viewer shows it: an object with its properties, an error with its message.
const shown = (value) => {
    if (value instanceof Error) return `${value.message} ${JSON.stringify(value)}`;
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value);
};
const logged = () => [console.log, console.info, console.warn, console.error]
    .flatMap((spy) => spy.mock.calls.flat())
    .map(shown)
    .join('\n');

/** An HTTP error from a provider whose answer repeats the number it was asked to text. */
const refusedWithNumber = (data, status = 400) => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
});

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

it('8x8 logs a refused send without the number its answer names, and still throws its reason', async () => {
    const adapter = new EightByEightAdapter({ apiKey: 'artificial-key', subAccountId: 'artificial-sub', phoneNumber: '+15550000001' });
    axios.post.mockImplementation(async () => {
        throw refusedWithNumber({ code: 1002, message: 'Invalid destination', errors: [{ field: 'destination', value: DRIVER }] });
    });

    await expect(adapter.sendSMS(DRIVER, 'hello')).rejects.toThrow('8x8 Error: Invalid destination');

    expect(logged()).toContain('8x8 Send Error');
    expect(logged()).not.toContain('5558675309');
    expect(logged()).toContain('400');
});

describe('RingCentral, when a send is refused', () => {
    // RingCentral's answer to a bad parameter names its value.
    const INVALID_TO = {
        errorCode: 'InvalidParameter',
        message: 'Parameter [to.phoneNumber] value is invalid',
        errors: [{ errorCode: 'CMN-101', message: 'Parameter [to.phoneNumber] value is invalid', parameterName: 'to.phoneNumber', parameterValue: DRIVER }],
    };
    const ringCentral = (post, config = {}) => {
        const adapter = new RingCentralAdapter({ clientId: 'cid', clientSecret: 'secret', jwt: 'jwt', defaultPhoneNumber: '+15550000001', ...config });
        adapter.rc = { post };
        adapter.ensureLoggedIn = jest.fn(async () => {});
        return adapter;
    };

    it('logs its code without the number, and still throws its reason', async () => {
        const adapter = ringCentral(jest.fn(async () => { throw refusedWithNumber(INVALID_TO); }));

        await expect(adapter.sendSMSWithReceipt(DRIVER, 'hello')).rejects.toThrow('RingCentral Error [InvalidParameter]');

        expect(logged()).toContain('InvalidParameter');
        expect(logged()).not.toContain('5558675309');
    });

    it('logs a fallback to the default line, and its failure, without the number', async () => {
        // The assigned line is refused (a permission error), then the default line is refused too.
        const post = jest.fn()
            .mockImplementationOnce(async () => {
                throw refusedWithNumber({ errorCode: 'FeatureNotAvailable', message: `SMS not available from this line to ${DRIVER}`, parameterValue: DRIVER });
            })
            .mockImplementationOnce(async () => { throw refusedWithNumber(INVALID_TO); });
        const adapter = ringCentral(post);

        await expect(adapter.sendSMSWithReceipt(DRIVER, 'hello', null, '+15550000002')).rejects.toThrow();

        expect(post).toHaveBeenCalledTimes(2);
        expect(logged()).toContain('Falling back to Default Line');
        expect(logged()).not.toContain('5558675309');
    });
});
