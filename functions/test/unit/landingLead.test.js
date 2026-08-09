/**
 * Public landing-lead endpoint.
 *
 * The stores and the Telegram transport are injected, so every branch runs
 * without Firestore and without a network call. Two properties matter most and
 * are asserted directly rather than inferred:
 *
 *  - **a lead is written before delivery is attempted**, so a Telegram outage
 *    cannot destroy it — this is the failure the two-step rework exists to fix;
 *  - **step two is not an oracle**: a wrong, expired or replayed reference is
 *    answered exactly like a valid one.
 */

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

/** An in-memory stand-in for functions/landing/leads.js. */
function makeLeadStore(overrides = {}) {
    const store = {
        created: [],
        completed: [],
        deliveries: [],
        DELIVERY_STATUS: { PENDING: 'pending', DELIVERED: 'delivered', FAILED: 'failed', DISABLED: 'disabled' },
        LEAD_STAGES: { CONTACT: 'contact', QUALIFIED: 'qualified' },
        createLead: jest.fn(async (contact, context) => {
            store.created.push({ contact, context });
            return { leadId: 'lead-1', reference: 'lead-1.secret' };
        }),
        completeLead: jest.fn(async (reference, qualification) => {
            store.completed.push({ reference, qualification });
            return {
                ok: true,
                reason: null,
                leadId: 'lead-1',
                lead: { fullName: 'Jane Driver', workEmail: 'jane@example.com', ...qualification },
            };
        }),
        recordDelivery: jest.fn(async (leadId, status, code) => {
            store.deliveries.push({ leadId, status, code });
        }),
        ...overrides,
    };
    return store;
}

function makeConfigStore(overrides = {}) {
    return {
        readTelegramConfig: jest.fn(async () => ({
            enabled: true, botToken: 'NOT_A_REAL_TOKEN', chatId: 'NOT_A_REAL_CHAT', source: 'firestore',
        })),
        recordDeliveryOutcome: jest.fn(async () => {}),
        ...overrides,
    };
}

function makeTransport(overrides = {}) {
    return {
        sendMessage: jest.fn(async () => ({ ok: true, code: null })),
        buildNewLeadMessage: jest.fn(() => 'new lead'),
        buildQualifiedLeadMessage: jest.fn(() => 'qualified lead'),
        ...overrides,
    };
}

function dependencies(overrides = {}) {
    return {
        token: 'NOT_A_REAL_TOKEN',
        chatId: 'NOT_A_REAL_CHAT',
        checkRateLimit: jest.fn().mockResolvedValue(true),
        leads: makeLeadStore(),
        config: makeConfigStore(),
        transport: makeTransport(),
        ...overrides,
    };
}

describe('landing lead endpoint — transport guards', () => {
    it('rejects origins outside the approved hosting domains', async () => {
        const req = makeRequest({ headers: { origin: 'https://evil.example' } });
        const res = makeResponse();
        const deps = dependencies();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(403);
        expect(deps.leads.createLead).not.toHaveBeenCalled();
        expect(deps.transport.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects non-POST methods', async () => {
        const req = makeRequest({ method: 'GET' });
        const res = makeResponse();
        await _test.handleLandingLead(req, res, dependencies());
        expect(res.statusCode).toBe(405);
    });

    it('requires a JSON content type', async () => {
        const req = makeRequest({ headers: { 'content-type': 'text/plain' } });
        const res = makeResponse();
        await _test.handleLandingLead(req, res, dependencies());
        expect(res.statusCode).toBe(415);
    });
});

describe('landing lead endpoint — step one', () => {
    it('stores the lead before attempting delivery', async () => {
        const order = [];
        const deps = dependencies({
            leads: makeLeadStore({
                createLead: jest.fn(async () => {
                    order.push('store');
                    return { leadId: 'lead-1', reference: 'lead-1.secret' };
                }),
            }),
            transport: makeTransport({
                sendMessage: jest.fn(async () => {
                    order.push('deliver');
                    return { ok: true, code: null };
                }),
            }),
        });

        const req = makeRequest({ body: { step: 1 } });
        const res = makeResponse();
        await _test.handleLandingLead(req, res, deps);

        expect(order).toEqual(['store', 'deliver']);
        expect(res.statusCode).toBe(200);
        expect(res.payload.reference).toBe('lead-1.secret');
    });

    it('keeps the lead and still reports success when Telegram fails', async () => {
        const deps = dependencies({
            transport: makeTransport({
                sendMessage: jest.fn(async () => ({ ok: false, code: 'telegram-unavailable' })),
            }),
        });

        const req = makeRequest({ body: { step: 1 } });
        const res = makeResponse();
        await _test.handleLandingLead(req, res, deps);

        // The visitor is not shown someone else's outage, and the lead survives
        // it with a recorded failure the settings screen can retry.
        expect(res.statusCode).toBe(200);
        expect(res.payload.ok).toBe(true);
        expect(deps.leads.deliveries).toEqual([
            { leadId: 'lead-1', status: 'failed', code: 'telegram-unavailable' },
        ]);
    });

    it('records a disabled delivery when Telegram is not configured', async () => {
        const deps = dependencies({
            config: makeConfigStore({
                readTelegramConfig: jest.fn(async () => ({
                    enabled: false, botToken: null, chatId: null, source: 'none',
                })),
            }),
        });

        const req = makeRequest({ body: { step: 1 } });
        const res = makeResponse();
        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(deps.leads.deliveries[0].status).toBe('disabled');
        expect(deps.transport.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a malformed email before touching the store', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { step: 1, workEmail: 'not-an-email' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(400);
        expect(deps.leads.createLead).not.toHaveBeenCalled();
    });

    it('answers a honeypot submission indistinguishably from a real one', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { step: 1, website: 'http://spam.example' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(res.payload.ok).toBe(true);
        // The response carries a reference of the same shape, so a scripted
        // submitter cannot tell it was filtered.
        expect(res.payload.reference).toMatch(/^[a-f0-9]+\.[a-f0-9]{64}$/);
        expect(deps.leads.createLead).not.toHaveBeenCalled();
        expect(deps.transport.sendMessage).not.toHaveBeenCalled();
    });

    it('fails closed when the rate limit is exhausted', async () => {
        const deps = dependencies({ checkRateLimit: jest.fn().mockResolvedValue(false) });
        const req = makeRequest({ body: { step: 1 } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(429);
        expect(deps.leads.createLead).not.toHaveBeenCalled();
    });

    it('reports a storage failure rather than pretending to have captured the lead', async () => {
        const deps = dependencies({
            leads: makeLeadStore({
                createLead: jest.fn(async () => { throw new Error('firestore unavailable'); }),
            }),
        });
        const req = makeRequest({ body: { step: 1 } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(503);
        expect(res.payload.ok).toBe(false);
    });

    it('captures attribution without storing a raw address', async () => {
        const deps = dependencies();
        const req = makeRequest({
            body: { step: 1, sourcePage: '/pricing', utmSource: 'linkedin', utmCampaign: 'q3' },
        });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        const { context } = deps.leads.created[0];
        expect(context.sourcePage).toBe('/pricing');
        expect(context.utmSource).toBe('linkedin');
        expect(context.utmCampaign).toBe('q3');
        expect(context.sourceAddressHash).toMatch(/^[a-f0-9]{48}$/);
        expect(JSON.stringify(context)).not.toContain('203.0.113.10');
    });
});

describe('landing lead endpoint — step two', () => {
    it('completes the lead and sends the enrichment message', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { step: 2, reference: 'lead-1.secret' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(deps.leads.completed[0].qualification).toEqual({
            companyName: 'Example Logistics',
            companySize: '11-50',
            phone: '+1 555 0100',
            primaryGoal: 'Compliance',
        });
        expect(deps.transport.buildQualifiedLeadMessage).toHaveBeenCalled();
    });

    it('validates the qualification enums', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { step: 2, reference: 'lead-1.secret', companySize: '900' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(400);
        expect(deps.leads.completeLead).not.toHaveBeenCalled();
    });

    for (const reason of ['token-mismatch', 'expired', 'already-completed', 'not-found']) {
        it(`answers "${reason}" exactly like a success, so the endpoint is not an oracle`, async () => {
            const deps = dependencies({
                leads: makeLeadStore({
                    completeLead: jest.fn(async () => ({ ok: false, reason, lead: null, leadId: null })),
                }),
            });
            const req = makeRequest({ body: { step: 2, reference: 'lead-1.wrong' } });
            const res = makeResponse();

            await _test.handleLandingLead(req, res, deps);

            expect(res.statusCode).toBe(200);
            expect(res.payload).toEqual({ ok: true });
            expect(deps.transport.sendMessage).not.toHaveBeenCalled();
        });
    }
});

describe('landing lead endpoint — original single-shot payload', () => {
    it('still works, so a cached copy of the page keeps converting', async () => {
        const deps = dependencies();
        const req = makeRequest();
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ ok: true });
        expect(deps.leads.createLead).toHaveBeenCalled();
        expect(deps.leads.completeLead).toHaveBeenCalled();
        expect(deps.transport.buildQualifiedLeadMessage).toHaveBeenCalled();
    });

    it('rejects malformed lead data before delivery', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { companySize: 'enormous' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(400);
        expect(deps.transport.sendMessage).not.toHaveBeenCalled();
    });

    it('quietly accepts honeypot submissions without sending them', async () => {
        const deps = dependencies();
        const req = makeRequest({ body: { website: 'http://spam.example' } });
        const res = makeResponse();

        await _test.handleLandingLead(req, res, deps);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ ok: true });
        expect(deps.transport.sendMessage).not.toHaveBeenCalled();
    });
});

describe('landing lead endpoint — input hygiene', () => {
    it('strips control characters and clamps length', () => {
        expect(_test.cleanText('Jane \tDriver', 100)).toBe('Jane Driver');
        expect(_test.cleanText('x'.repeat(300), 10)).toHaveLength(10);
        expect(_test.cleanText(42, 10)).toBe('');
    });

    it('lowercases the work email so duplicates collapse', () => {
        const result = _test.validateContact({ fullName: 'A B', workEmail: 'MiXeD@Example.COM' });
        expect(result.contact.workEmail).toBe('mixed@example.com');
    });

    it('pins the accepted enum sets', () => {
        expect([..._test.COMPANY_SIZES]).toEqual(['1-10', '11-50', '51-200', '201+']);
        expect([..._test.PRIMARY_GOALS]).toEqual(['ATS', 'Compliance', 'E-Docs', 'PEV', 'Other']);
    });
});
