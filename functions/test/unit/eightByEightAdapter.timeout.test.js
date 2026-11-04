/**
 * What the 8x8 adapter does when 8x8 stops answering. Every request gives up
 * after 20 seconds. A send that timed out, or that 8x8 accepted (2xx) before its
 * answer stalled or broke off, may have gone out, so it says so and is sent
 * once; a connection check that timed out is a failure, not a working
 * connection. Every other answer is handled as before.
 *
 * axios is mocked. The last block hands the adapter's own calls to the real
 * axios against servers on 127.0.0.1 that never answer, stall or break off, so
 * an axios upgrade that changed those errors must fail here. Nothing reaches
 * 8x8; all data is artificial.
 */

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const http = require('http');
const axios = require('axios');
const EightByEightAdapter = require('../../integrations/adapters/eightbyeight');

const CONFIG = { apiKey: 'artificial-key', subAccountId: 'artificial-sub', phoneNumber: '+15550000001' };
const MESSAGES_URL = 'https://sms.8x8.com/api/v1/subaccounts/artificial-sub/messages';
const SUBACCOUNT_URL = 'https://sms.8x8.com/api/v1/subaccounts/artificial-sub';
const HEADERS = { Authorization: 'Bearer artificial-key', 'Content-Type': 'application/json' };
const UNCONFIRMED = '8x8 did not answer within 20 seconds, so SafeHaul cannot tell whether this text went out. It was not sent again.';
const NO_ANSWER = '8x8 did not answer within 20 seconds. Try again later.';

/** axios's error when nothing came back within `timeout` (`ETIMEDOUT` with `clarifyTimeoutError`). */
const timedOut = (code = 'ECONNABORTED') => Object.assign(new Error('timeout of 20000ms exceeded'), { code });
const answered = (status, message) => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: message ? { message } : {} },
});
/** axios's errors when the answer's body stalls (the socket's idle limit) or the connection resets mid-body. */
const brokeOffAfter = (status, code = 'ERR_BAD_RESPONSE', message = 'stream has been aborted') => Object.assign(
    new Error(message), { code, response: { status, headers: {} } },
);

const adapter = () => new EightByEightAdapter(CONFIG);

beforeEach(() => {
    jest.resetAllMocks();
    axios.post.mockResolvedValue({ status: 202, data: { umid: 'artificial-umid' } });
    axios.get.mockResolvedValue({ status: 200, data: {} });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('sendSMS', () => {
    it('gives the send a 20-second limit and changes nothing else in it', async () => {
        await expect(adapter().sendSMS('+15558675309', 'hi'))
            .resolves.toEqual({ success: true, responseData: { umid: 'artificial-umid' }, statusCode: 202 });

        expect(axios.post.mock.calls).toEqual([[
            MESSAGES_URL,
            { source: '15550000001', destination: '+15558675309', text: 'hi' },
            { headers: HEADERS, timeout: 20000 },
        ]]);
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT'])('reports a send 8x8 never answered (%s) as unconfirmed, and sends it once', async (code) => {
        axios.post.mockRejectedValue(timedOut(code));

        await expect(adapter().sendSMS('+15558675309', 'hi'))
            .rejects.toMatchObject({ code: 'sms-send-unconfirmed', message: UNCONFIRMED });
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['stalls (202)', brokeOffAfter(202)],
        ['breaks off with a reset (200)', brokeOffAfter(200, 'ECONNRESET', 'aborted')],
    ])('reports a send 8x8 accepted but whose answer %s as unconfirmed, and sends it once', async (_case, error) => {
        axios.post.mockRejectedValue(error);

        await expect(adapter().sendSMS('+15558675309', 'hi'))
            .rejects.toMatchObject({ code: 'sms-send-unconfirmed', message: UNCONFIRMED });
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('keeps any other failure as it was, without the unconfirmed code', async () => {
        axios.post.mockRejectedValue(answered(400, 'Invalid destination'));

        const error = await adapter().sendSMS('+15558675309', 'hi').catch((e) => e);

        expect(error.message).toBe('8x8 Error: Invalid destination');
        expect(error.code).toBeUndefined();
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});

describe('verifyConnection', () => {
    it('gives the check a 20-second limit and changes nothing else in it', async () => {
        await expect(adapter().verifyConnection()).resolves.toMatchObject({ success: true, identity: '8x8 SubAccount: artificial-sub' });

        expect(axios.get.mock.calls).toEqual([[SUBACCOUNT_URL, { headers: HEADERS, timeout: 20000 }]]);
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT'])('fails a check 8x8 never answered (%s)', async (code) => {
        axios.get.mockRejectedValue(timedOut(code));

        await expect(adapter().verifyConnection()).rejects.toThrow(NO_ANSWER);
    });

    it('still counts a 404 answer as a working key', async () => {
        axios.get.mockRejectedValue(answered(404));

        await expect(adapter().verifyConnection()).resolves.toMatchObject({ success: true, identity: '8x8 SubAccount: artificial-sub' });
    });

    it.each([401, 403])('still refuses a key 8x8 answers %i to', async (status) => {
        axios.get.mockRejectedValue(answered(status, 'Unauthorized'));

        await expect(adapter().verifyConnection()).rejects.toThrow('8x8 API Key is invalid or unauthorized: Unauthorized');
    });
});

describe('with the real axios against a local server', () => {
    const realAxios = jest.requireActual('axios');
    const LIMIT_MS = 200;
    let server;
    let base;
    // How the server answers: 'silent' never answers; 'stall' and 'reset' send a
    // 202 and part of the body, then stop, or close the connection.
    let answer = 'silent';

    /** Sends the adapter's own call to the local server, with a 200 ms limit in place of its 20 s. */
    const toLocalServer = (config) => {
        expect(config.timeout).toBe(20000);
        return { ...config, timeout: LIMIT_MS, proxy: false };
    };
    const local = (url) => `${base}${new URL(url).pathname}`;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (answer === 'silent') return;
            // The request is read in full first, so closing the socket sends a FIN, not a reset that could drop the 202.
            req.resume();
            req.on('end', () => {
                res.writeHead(202, { 'Content-Type': 'application/json', 'Content-Length': '100' });
                res.write('{"umid":', () => {
                    if (answer === 'reset') setTimeout(() => res.socket.destroy(), 20);
                });
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    beforeEach(() => {
        answer = 'silent';
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });

    it.each([
        ['never answers', 'silent'],
        ['accepts it and then stalls the answer', 'stall'],
        ['accepts it and then closes the connection mid-answer', 'reset'],
    ])('a send to a server that %s is reported as unconfirmed, within the limit', async (_case, how) => {
        answer = how;
        axios.post.mockImplementation((url, body, config) => realAxios.post(local(url), body, toLocalServer(config)));
        const startedAt = Date.now();

        await expect(adapter().sendSMS('+15558675309', 'hi'))
            .rejects.toMatchObject({ code: 'sms-send-unconfirmed', message: UNCONFIRMED });
        expect(Date.now() - startedAt).toBeLessThan(3000);
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('a check gives up at the limit and fails', async () => {
        axios.get.mockImplementation((url, config) => realAxios.get(local(url), toLocalServer(config)));
        const startedAt = Date.now();

        await expect(adapter().verifyConnection()).rejects.toThrow(NO_ANSWER);
        expect(Date.now() - startedAt).toBeLessThan(3000);
    });
});
