/**
 * What the RingCentral adapter does when RingCentral stops answering. A send
 * that timed out may still have gone out, so it is never sent again: no
 * rate-limit retry, no from-line fallback, no default-line fallback. A timeout
 * before any send says nothing was sent. All data is artificial.
 */

jest.mock('@ringcentral/sdk', () => {
    class SDK {
        constructor() {}
    }
    SDK.server = { sandbox: 'sandbox', production: 'production' };
    return { SDK };
});

const RingCentralAdapter = require('../../integrations/adapters/ringcentral');

const UNCONFIRMED = 'RingCentral did not answer within 20 seconds, so SafeHaul cannot tell whether this text went out. It was not sent again.';

/** node-fetch's error when nothing came back in time (`type: 'request-timeout'`). */
const requestTimeout = (url) => Object.assign(new Error(`network timeout at: ${url}`), { type: 'request-timeout', response: null });

let mockPost;
let mockEnsureLoggedIn;

function adapterWith() {
    const adapter = new RingCentralAdapter({
        clientId: 'cid',
        clientSecret: 'secret',
        jwt: 'jwt',
        defaultPhoneNumber: '+15550000001',
        assignments: { user1: '+15550000002' },
    });
    adapter.rc = { post: mockPost };
    adapter.ensureLoggedIn = mockEnsureLoggedIn;
    return adapter;
}

beforeEach(() => {
    jest.resetAllMocks();
    mockPost = jest.fn(async () => ({ json: async () => ({ id: 1, messageStatus: 'Queued' }) }));
    mockEnsureLoggedIn = jest.fn(async () => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

it('reports a send RingCentral never answered as unconfirmed, and sends it once', async () => {
    mockPost.mockRejectedValue(requestTimeout('https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms'));

    await expect(adapterWith().sendSMSWithReceipt('+15558675309', 'hi', 'user1'))
        .rejects.toMatchObject({ code: 'sms-send-unconfirmed', message: UNCONFIRMED });

    // The assigned line was tried once; neither the no-from retry nor the
    // default-line fallback ran.
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][1]).toMatchObject({ from: { phoneNumber: '+15550000002' } });
});

it('does not treat a timeout whose message says "rate" as a rate limit', async () => {
    // Without the guard this retries after 5, 10 and 20 s waits and the test times out.
    mockPost.mockRejectedValue(requestTimeout('https://example.test/rate'));

    await expect(adapterWith().sendSMSWithReceipt('+15558675309', 'hi', 'user1'))
        .rejects.toMatchObject({ code: 'sms-send-unconfirmed', message: UNCONFIRMED });
    expect(mockPost).toHaveBeenCalledTimes(1);
});

it('says nothing was sent when the log-in times out', async () => {
    mockEnsureLoggedIn.mockRejectedValue(requestTimeout('https://platform.ringcentral.com/restapi/oauth/token'));

    const error = await adapterWith().sendSMSWithReceipt('+15558675309', 'hi', 'user1').catch((e) => e);

    expect(error.message).toBe('RingCentral Error [Timeout]: RingCentral did not answer within 20 seconds. Nothing was sent; try again later.');
    expect(error.code).toBeUndefined();
    expect(mockPost).not.toHaveBeenCalled();
});

it('says nothing was sent when the log-in after a rate-limit wait times out', async () => {
    jest.useFakeTimers();
    mockPost.mockRejectedValue(Object.assign(new Error('Request rate exceeded'), { response: { status: 429, data: {} } }));
    // The first log-in works; the re-log-in that follows the 5 s wait times out.
    mockEnsureLoggedIn
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(requestTimeout('https://platform.ringcentral.com/restapi/oauth/token'));
    const outcome = adapterWith().sendSMSWithReceipt('+15558675309', 'hi', 'user1').catch((e) => e);

    await jest.advanceTimersByTimeAsync(5000);
    const error = await outcome;

    expect(error.message).toBe('RingCentral Error [Timeout]: RingCentral did not answer within 20 seconds. Nothing was sent; try again later.');
    expect(error.code).toBeUndefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
});

it('still counts a send whose answer stalls while being read as sent, without a receipt', async () => {
    mockPost.mockResolvedValue({
        json: () => Promise.reject(Object.assign(new Error('Response timeout'), { type: 'body-timeout' })),
    });

    await expect(adapterWith().sendSMSWithReceipt('+15558675309', 'hi', 'user1'))
        .resolves.toEqual({ providerMessageId: null, providerStatus: null });
    expect(mockPost).toHaveBeenCalledTimes(1);
});
