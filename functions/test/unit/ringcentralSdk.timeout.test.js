/**
 * Every RingCentral request gives up after 20 seconds. Under Node the SDK sends
 * through node-fetch 2, which has no limit of its own, so a silent RingCentral
 * used to hold a send until the Cloud Function was killed.
 *
 * This file uses the real SDK on purpose (no `jest.mock('@ringcentral/sdk')`):
 * an SDK upgrade that stopped passing the limit to its requests must fail here.
 * The servers are local (127.0.0.1); nothing reaches RingCentral.
 */

const http = require('http');
const RingCentralAdapter = require('../../integrations/adapters/ringcentral');
const { createRingCentralSdk, isRingCentralTimeout } = require('../../integrations/adapters/ringcentralSdk');

const SMS_PATH = '/restapi/v1.0/account/~/extension/~/sms';
const LIMIT_MS = 200;

const servers = [];

/** A local server that handles each request with `onRequest`; resolves its base URL. */
function serve(onRequest) {
    const server = http.createServer(onRequest);
    servers.push(server);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
}

const sdkFor = (server) => createRingCentralSdk({ server, clientId: 'c', clientSecret: 's' }, LIMIT_MS);

afterAll(async () => {
    for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});

it("builds the adapter's requests with a 20-second limit", () => {
    const adapter = new RingCentralAdapter({ clientId: 'cid', clientSecret: 'secret', jwt: 'jwt' });
    const request = adapter.rc.client().createRequest({ url: `https://platform.ringcentral.com${SMS_PATH}`, method: 'POST', body: {} });

    expect(request.timeout).toBe(20000);
});

describe('against a server that never answers', () => {
    let silent;
    beforeAll(async () => {
        silent = await serve(() => {});
    });

    it('a send gives up at the limit', async () => {
        const startedAt = Date.now();
        const error = await sdkFor(silent).post(SMS_PATH, { text: 'x' }, null, { skipAuthCheck: true }).catch((e) => e);

        expect(isRingCentralTimeout(error)).toBe(true);
        expect(error).toMatchObject({ type: 'request-timeout', response: null });
        expect(Date.now() - startedAt).toBeLessThan(3000);
    });

    it('a log-in gives up at the limit', async () => {
        const startedAt = Date.now();
        const error = await sdkFor(silent).login({ jwt: 'j' }).catch((e) => e);

        expect(isRingCentralTimeout(error)).toBe(true);
        expect(error.type).toBe('request-timeout');
        expect(Date.now() - startedAt).toBeLessThan(3000);
    });
});

it('reading an answer that stalls gives up at the limit, after the send was accepted', async () => {
    const stalling = await serve((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"id":');
    });

    const response = await sdkFor(stalling).post(SMS_PATH, { text: 'x' }, null, { skipAuthCheck: true });
    const error = await response.json().catch((e) => e);

    expect(error.type).toBe('body-timeout');
    expect(isRingCentralTimeout(error)).toBe(true);
});

it('isRingCentralTimeout leaves other errors alone', () => {
    expect(isRingCentralTimeout(Object.assign(new Error('refused'), { type: 'system', code: 'ECONNREFUSED' }))).toBe(false);
    expect(isRingCentralTimeout(new Error('Request rate exceeded'))).toBe(false);
    expect(isRingCentralTimeout(undefined)).toBe(false);
});
