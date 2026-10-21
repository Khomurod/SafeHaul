/**
 * The Facebook lead webhook (`facebookWebhook`).
 *
 * GET answers Facebook's subscription check only with the verify token. A POST
 * must carry a valid `X-Hub-Signature` over the raw body before anything is
 * read: without one nothing reaches the Graph API and nothing is written. A
 * valid lead is written to the company the page is bound to in
 * `integrations_index`, never to one named in the payload. All ids, tokens and
 * people are artificial.
 */
const crypto = require('crypto');

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
const mockSecrets = {};
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ value: () => mockSecrets[name] }),
}));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn() }));

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: (...args) => mockAxiosGet(...args), post: jest.fn() }));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const { facebookWebhook } = require('../../integrations/facebook');

const APP_SECRET = 'artificial-app-secret';
const VERIFY_TOKEN = 'artificial-verify-token';
const PAGE_BINDING = { companyId: 'co-1', accessToken: 'page-token-1', platform: 'facebook' };

const leadgen = (value) => ({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value }] }] });
// Meta signs every event with HMAC-SHA256 in `X-Hub-Signature-256`.
const sign = (rawBody, secret = APP_SECRET, algorithm = 'sha256') => `${algorithm}=${crypto.createHmac(algorithm, secret).update(rawBody).digest('hex')}`;

function post(body, { signature } = {}) {
    const rawBody = Buffer.from(JSON.stringify(body));
    const headers = {};
    if (signature !== null) headers['x-hub-signature-256'] = signature === undefined ? sign(rawBody) : signature;
    return { method: 'POST', query: {}, headers, rawBody, body };
}

const get = (query) => ({ method: 'GET', query, headers: {} });

function response() {
    const res = {};
    res.status = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.sendStatus = jest.fn(() => res);
    return res;
}

const storedLeads = () => [...mock.docs.entries()].filter(([path]) => path.includes('/leads/'));

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(mockSecrets, { FACEBOOK_APP_SECRET: APP_SECRET, FACEBOOK_VERIFY_TOKEN: VERIFY_TOKEN });
    mock.reset({ 'integrations_index/page-1': PAGE_BINDING });
    mockAxiosGet.mockResolvedValue({
        data: {
            id: 'lead-1',
            created_time: '2026-10-01T12:00:00+0000',
            field_data: [
                { name: 'full_name', values: ['Alice Mae Driver'] },
                { name: 'email', values: ['alice@example.com'] },
                { name: 'phone_number', values: ['+15551234567'] },
            ],
        },
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe.each([
    ['facebookWebhook', facebookWebhook],
])('%s', (_name, handler) => {
    it("answers Facebook's subscription check with the challenge when the verify token matches", async () => {
        const res = response();
        await handler(get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('abc123');
    });

    it.each([
        ['another token', { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': 'abc123' }],
        ['another mode', { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' }],
    ])('refuses the check with %s', async (_case, query) => {
        const res = response();
        await handler(get(query), res);

        expect(res.sendStatus).toHaveBeenCalledWith(403);
        expect(res.send).not.toHaveBeenCalled();
    });

    it('answers a GET without the check fields as a method it does not serve', async () => {
        const res = response();
        await handler(get({}), res);

        expect(res.sendStatus).toHaveBeenCalledWith(405);
    });

    it('writes the lead to the company the page is bound to', async () => {
        const res = response();
        await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: 'page-1' })), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
        expect(mockAxiosGet).toHaveBeenCalledWith('https://graph.facebook.com/v19.0/lead-1', {
            params: { access_token: 'page-token-1' },
        });
        const leads = storedLeads();
        expect(leads).toHaveLength(1);
        const [path, lead] = leads[0];
        expect(path).toMatch(/^companies\/co-1\/leads\//);
        expect(lead).toEqual({
            companyId: 'co-1',
            firstName: 'Alice',
            lastName: 'Mae Driver',
            phone: '+15551234567',
            email: 'alice@example.com',
            source: 'Facebook Ads',
            status: 'New Lead',
            assignedTo: '',
            assignedToName: '',
            normalizedPhone: '5551234567',
            createdAt: expect.anything(),
            updatedAt: '__server_timestamp__',
            facebookLeadId: 'lead-1',
            pageId: 'page-1',
        });
        expect(lead.createdAt.toMillis()).toBe(Date.parse('2026-10-01T12:00:00Z'));
    });

    it('writes a lead the Unassigned filter and the import\'s duplicate check can find', async () => {
        for (const [phone, normalizedPhone] of [['(555) 123-4567', '5551234567'], ['1-555-123-4567', '5551234567'], [undefined, '']]) {
            mock.reset({ 'integrations_index/page-1': PAGE_BINDING });
            mockAxiosGet.mockResolvedValueOnce({
                data: { field_data: phone ? [{ name: 'phone_number', values: [phone] }] : [] },
            });

            await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: 'page-1' })), response());

            const [[, lead]] = storedLeads();
            expect(lead).toEqual(expect.objectContaining({ assignedTo: '', assignedToName: '', normalizedPhone }));
        }
    });

    it('ignores a company named in the payload', async () => {
        const res = response();
        await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: 'page-1', companyId: 'co-2', company_id: 'co-2' })), res);

        expect(storedLeads().map(([path]) => path.split('/')[1])).toEqual(['co-1']);
    });

    it('names a lead without a name "Facebook Lead", and takes first and last names as given', async () => {
        mockAxiosGet.mockResolvedValueOnce({ data: { field_data: [{ name: 'email', values: ['x@example.com'] }] } });
        mockAxiosGet.mockResolvedValueOnce({
            data: { field_data: [{ name: 'first_name', values: ['Bo'] }, { name: 'last_name', values: ['Hauler'] }] },
        });

        await handler(post(leadgen({ leadgen_id: 'lead-2', page_id: 'page-1' })), response());
        await handler(post(leadgen({ leadgen_id: 'lead-3', page_id: 'page-1' })), response());

        const names = storedLeads().map(([, lead]) => [lead.firstName, lead.lastName]);
        expect(names).toEqual([['', 'Facebook Lead'], ['Bo', 'Hauler']]);
    });

    it.each([
        ['without a signature', { signature: null }, 401],
        ['signed only the old SHA-1 way', { signature: null, sha1: true }, 401],
        ['with a signature made with another secret', { signature: 'wrong' }, 403],
        ['with a signature of another length', { signature: 'sha256=abc' }, 403],
        ['with a signature that names no algorithm', { signature: 'deadbeef' }, 403],
    ])('refuses a POST %s, before reading anything', async (_case, options, status) => {
        const body = leadgen({ leadgen_id: 'lead-1', page_id: 'page-1' });
        const request = post(body, options);
        if (options.signature === 'wrong') request.headers['x-hub-signature-256'] = sign(request.rawBody, 'another-secret');
        if (options.sha1) request.headers['x-hub-signature'] = sign(request.rawBody, APP_SECRET, 'sha1');
        const res = response();
        await handler(request, res);

        expect(res.sendStatus).toHaveBeenCalledWith(status);
        expect(mockAxiosGet).not.toHaveBeenCalled();
        expect(storedLeads()).toEqual([]);
    });

    it('refuses every POST while the app secret is missing', async () => {
        delete mockSecrets.FACEBOOK_APP_SECRET;
        const res = response();
        await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: 'page-1' })), res);

        expect(res.sendStatus).toHaveBeenCalledWith(500);
        expect(storedLeads()).toEqual([]);
    });

    it.each([
        ['no company is bound to', 'page-1'],
        ['bound without a token', 'page-2'],
    ])('acknowledges a lead for a page %s, and writes nothing', async (_case, pageId) => {
        mock.reset({ 'integrations_index/page-2': { companyId: 'co-1', claimPending: true } });
        const res = response();
        await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: pageId })), res);

        // Anything but 200 makes Facebook send the event again.
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(mockAxiosGet).not.toHaveBeenCalled();
        expect(storedLeads()).toEqual([]);
    });

    it('answers 404 for a signed event about something other than a page', async () => {
        const res = response();
        await handler(post({ object: 'user', entry: [] }), res);

        expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    it('answers 500 when the Graph API fails, and writes nothing', async () => {
        mockAxiosGet.mockRejectedValueOnce(new Error('Graph is down'));
        const res = response();
        await handler(post(leadgen({ leadgen_id: 'lead-1', page_id: 'page-1' })), res);

        expect(res.sendStatus).toHaveBeenCalledWith(500);
        expect(storedLeads()).toEqual([]);
    });
});

describe('without a verify token', () => {
    it('facebookWebhook throws, so the platform answers with an error', async () => {
        delete mockSecrets.FACEBOOK_VERIFY_TOKEN;

        await expect(facebookWebhook(get({}), response())).rejects.toThrow('FACEBOOK_VERIFY_TOKEN secret is not set in production.');
    });
});
