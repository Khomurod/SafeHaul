const { _test } = require('../../landingLead');

function makeRequest(overrides = {}) {
    const headers = {
        origin: 'https://safehaul.io',
        'content-type': 'application/json',
        ...(overrides.headers || {}),
    };
    return {
        ...overrides,
        method: overrides.method || 'POST',
        ip: overrides.ip || '203.0.113.10',
        body: {
            fullName: 'Jane Driver',
            workEmail: 'jane@example.com',
            companyName: 'Example Logistics',
            companySize: '11-50',
            phone: '+1 555 0100',
            primaryGoal: 'Compliance',
            website: '',
            ...(overrides.body || {}),
        },
        get(name) {
            return headers[String(name).toLowerCase()];
        },
        headers,
    };
}

function makeResponse() {
    const response = {
        statusCode: 200,
        payload: null,
        set: jest.fn(() => response),
        status: jest.fn((code) => {
            response.statusCode = code;
            return response;
        }),
        json: jest.fn((payload) => {
            response.payload = payload;
            return response;
        }),
    };
    return response;
}

function dependencies(overrides = {}) {
    return {
        token: 'NOT_A_REAL_TOKEN',
        chatId: 'NOT_A_REAL_CHAT',
        checkRateLimit: jest.fn().mockResolvedValue(true),
        fetchImpl: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
        ...overrides,
    };
}

describe('landing lead endpoint', () => {
    it('validates, rate-limits, and delivers a plain-text Telegram message', async () => {
        const req = makeRequest();
        const res = makeResponse();
        const deps = dependencies();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ ok: true });
        expect(deps.checkRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^landing-lead:[a-f0-9]{48}$/), 5, 3600, 'closed');
        expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = deps.fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.telegram.org/botNOT_A_REAL_TOKEN/sendMessage');
        expect(JSON.parse(options.body)).toEqual(expect.objectContaining({
            chat_id: 'NOT_A_REAL_CHAT',
            text: expect.stringContaining('Jane Driver'),
        }));
        expect(options.body).not.toContain('parse_mode');
    });

    it('rejects origins outside the approved hosting domains', async () => {
        const req = makeRequest({ headers: { origin: 'https://attacker.example', 'content-type': 'application/json' } });
        const res = makeResponse();
        const deps = dependencies();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(403);
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects malformed lead data before delivery', async () => {
        const req = makeRequest({ body: { workEmail: 'not-an-email', companySize: 'millions' } });
        const res = makeResponse();
        const deps = dependencies();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(400);
        expect(deps.checkRateLimit).not.toHaveBeenCalled();
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    it('quietly accepts honeypot submissions without sending them', async () => {
        const req = makeRequest({ body: { website: 'https://spam.example' } });
        const res = makeResponse();
        const deps = dependencies();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(deps.checkRateLimit).not.toHaveBeenCalled();
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    it('fails closed when the rate limit is exhausted', async () => {
        const req = makeRequest();
        const res = makeResponse();
        const deps = dependencies({ checkRateLimit: jest.fn().mockResolvedValue(false) });

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(429);
        expect(deps.fetchImpl).not.toHaveBeenCalled();
    });

    it('returns a safe error without exposing Telegram response data', async () => {
        const req = makeRequest();
        const res = makeResponse();
        const deps = dependencies({ fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 500 }) });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(502);
        expect(res.payload).toEqual({ ok: false, error: 'Lead delivery failed.' });
        expect(errorSpy).toHaveBeenCalledWith('[submitLandingLead] Telegram returned HTTP 500.');
        errorSpy.mockRestore();
    });
});
