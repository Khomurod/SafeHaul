/**
 * The home page's contact form: `submitWebsiteLead` behind `/api/contact`.
 *
 * What has to hold is the bar in the runbook's "Landing lead form security"
 * section: own origins only, POST of JSON or a plain form only, every field
 * checked, a honeypot that stores and sends nothing, fail-closed limits, the lead
 * stored before the operator is told, and no lead detail in a log line.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
    db: {},
}));

const fs = require('fs');
const path = require('path');
const { __test } = require('../../landing/websiteLead');

const { handleWebsiteLead, readLead, operatorMessage, notifyOperator, MAX_LENGTH, FLEET_SIZES, HONEYPOT } = __test;

const VALID = Object.freeze({
    fullName: 'Pat Example',
    workEmail: 'Pat@Example-Carrier.com',
    companyName: 'Example Carrier LLC',
    phone: '(512) 555-0142',
    fleetSize: '11-50',
    message: 'We hire about ten drivers a month.\r\n\r\n\r\nCan we see it?',
    leave_this_empty: '',
});

function fakeRes() {
    const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
    res.set = jest.fn((name, value) => { res.headers[name] = value; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => { res.ended = true; return res; });
    return res;
}

function request({ method = 'POST', origin = 'https://safehaul.io', type = 'application/json', body = VALID } = {}) {
    const headers = { origin, 'content-type': type, 'x-forwarded-for': '203.0.113.7' };
    return { method, headers, body, get: (name) => headers[name.toLowerCase()] };
}

function makeDeps() {
    const ref = {
        id: 'lead-1',
        set: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    };
    const collection = { doc: jest.fn(() => ref) };
    return {
        ref,
        collection,
        deps: {
            db: { collection: jest.fn(() => collection) },
            serverTimestamp: () => 'SERVER_TIME',
            checkRateLimit: jest.fn(async () => true),
            alertSettings: {
                readSettings: jest.fn(async () => ({ telegram: { chatId: 12345 } })),
                readBotToken: jest.fn(async () => 'TOKEN'),
            },
            telegram: { sendMessage: jest.fn(async () => {}) },
            telegramDeps: undefined,
        },
    };
}

let logs;

beforeEach(() => {
    jest.resetAllMocks();
    logs = [
        jest.spyOn(console, 'error').mockImplementation(() => {}),
        jest.spyOn(console, 'warn').mockImplementation(() => {}),
        jest.spyOn(console, 'log').mockImplementation(() => {}),
    ];
});

afterEach(() => {
    for (const spy of logs) spy.mockRestore();
});

function everythingLogged() {
    return logs.flatMap((spy) => spy.mock.calls).flat().map(String).join('\n');
}

describe('submitWebsiteLead — a person sends the form', () => {
    it('stores the lead, then tells the operator, and answers ok', async () => {
        const { deps, ref, collection } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request(), res, deps);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(deps.db.collection).toHaveBeenCalledWith('landing_leads');
        expect(collection.doc).toHaveBeenCalledWith();
        expect(ref.set).toHaveBeenCalledWith({
            fullName: 'Pat Example',
            workEmail: 'pat@example-carrier.com',
            companyName: 'Example Carrier LLC',
            companySize: '11-50',
            phone: '(512) 555-0142',
            message: 'We hire about ten drivers a month.\n\nCan we see it?',
            primaryGoal: null,
            stage: 'qualified',
            source: 'home_page_form',
            sourcePage: '/',
            sourceSite: 'safehaul.io',
            delivery: { status: 'pending', code: null, attempts: 0 },
            createdAt: 'SERVER_TIME',
        });
        expect(deps.telegram.sendMessage).toHaveBeenCalledWith('TOKEN', 12345, expect.stringContaining('Email: pat@example-carrier.com'), undefined);
        expect(ref.update).toHaveBeenCalledWith({ delivery: { status: 'delivered', code: null, attempts: 1 } });
        // Stored before sent: a Telegram outage must never lose the customer.
        expect(ref.set.mock.invocationCallOrder[0]).toBeLessThan(deps.telegram.sendMessage.mock.invocationCallOrder[0]);
    });

    it('never stores the address it limits by', async () => {
        const { deps, ref } = makeDeps();
        await handleWebsiteLead(request(), fakeRes(), deps);
        expect(JSON.stringify(ref.set.mock.calls)).not.toContain('203.0.113.7');
        const [perAddressKey] = deps.checkRateLimit.mock.calls[0];
        // 20 bits: thousands of addresses share each key, so it names none of them.
        expect(perAddressKey).toMatch(/^website_lead_[0-9a-f]{5}$/);
    });

    it('keeps the lead when the operator cannot be told, and the visitor still hears ok', async () => {
        const { deps, ref } = makeDeps();
        deps.telegram.sendMessage.mockRejectedValue(Object.assign(new Error('https://api.telegram.org/botTOKEN/sendMessage'), { code: 'unreachable' }));
        const res = fakeRes();
        await handleWebsiteLead(request(), res, deps);

        expect(res.body).toEqual({ ok: true });
        expect(ref.update).toHaveBeenCalledWith({ delivery: { status: 'failed', code: 'unreachable', attempts: 1 } });
        expect(everythingLogged()).not.toContain('TOKEN');
    });

    it('records "not sent" when no alert chat is connected', async () => {
        const { deps, ref } = makeDeps();
        deps.alertSettings.readSettings.mockResolvedValue({});
        await handleWebsiteLead(request(), fakeRes(), deps);
        expect(deps.alertSettings.readBotToken).not.toHaveBeenCalled();
        expect(deps.telegram.sendMessage).not.toHaveBeenCalled();
        expect(ref.update).toHaveBeenCalledWith({ delivery: { status: 'disabled', code: 'no_chat', attempts: 1 } });
    });

    it.each(['https://safehaul-landing-testing.web.app', 'https://safehaul-landing-testing.firebaseapp.com'])(
        'says which site a lead came from, so a test is not mistaken for a customer (%s)', async (origin) => {
            const { deps, ref } = makeDeps();
            await handleWebsiteLead(request({ origin }), fakeRes(), deps);
            expect(ref.set.mock.calls[0][0].sourceSite).toBe('testing');
            expect(deps.telegram.sendMessage.mock.calls[0][2]).toMatch(/^New request from the TESTING public site/);
        },
    );

    it('answers a plain form post (JavaScript off) with a redirect to the note on the page', async () => {
        const { deps } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ type: 'application/x-www-form-urlencoded' }), res, deps);
        expect(res.statusCode).toBe(303);
        expect(res.headers.Location).toBe('/#contact-sent');
    });

    it('answers 503 and sends nothing when the lead cannot be stored', async () => {
        const { deps, ref } = makeDeps();
        ref.set.mockRejectedValue(Object.assign(new Error('boom Pat Example'), { code: 'unavailable' }));
        const res = fakeRes();
        await handleWebsiteLead(request(), res, deps);
        expect(res.statusCode).toBe(503);
        expect(res.body.ok).toBe(false);
        expect(deps.telegram.sendMessage).not.toHaveBeenCalled();
        expect(everythingLogged()).not.toContain('Pat Example');
    });
});

describe('submitWebsiteLead — what it refuses', () => {
    it.each(['GET', 'PUT', 'OPTIONS'])('refuses %s', async (method) => {
        const { deps, ref } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ method }), res, deps);
        expect(res.statusCode).toBe(405);
        expect(ref.set).not.toHaveBeenCalled();
    });

    it.each([null, 'https://evil.example', 'https://app.safehaul.io', 'http://safehaul.io'])('refuses the origin %s', async (origin) => {
        const { deps, ref } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ origin }), res, deps);
        expect(res.statusCode).toBe(403);
        expect(ref.set).not.toHaveBeenCalled();
    });

    it.each(['text/plain', 'multipart/form-data; boundary=x', ''])('refuses the content type "%s"', async (type) => {
        const { deps, ref } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ type }), res, deps);
        expect(res.statusCode).toBe(415);
        expect(ref.set).not.toHaveBeenCalled();
    });

    it('answers a filled honeypot like a person, storing and sending nothing', async () => {
        const { deps, ref } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ body: { ...VALID, [HONEYPOT]: 'https://spam.example' } }), res, deps);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(ref.set).not.toHaveBeenCalled();
        expect(deps.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('stops at the per-address limit, fail-closed', async () => {
        const { deps, ref } = makeDeps();
        deps.checkRateLimit.mockResolvedValueOnce(false);
        const res = fakeRes();
        await handleWebsiteLead(request(), res, deps);
        expect(res.statusCode).toBe(429);
        expect(res.body.error).toContain('info@safehaul.io');
        expect(deps.checkRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^website_lead_/), 5, 3600, 'closed');
        expect(ref.set).not.toHaveBeenCalled();
    });

    it('stops at the site-wide limit, fail-closed, whatever the address', async () => {
        const { deps, ref } = makeDeps();
        deps.checkRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const res = fakeRes();
        await handleWebsiteLead(request(), res, deps);
        expect(res.statusCode).toBe(429);
        expect(deps.checkRateLimit).toHaveBeenLastCalledWith('website_lead_all', 60, 3600, 'closed');
        expect(ref.set).not.toHaveBeenCalled();
    });

    it('names the field a refusal is about', async () => {
        const { deps } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ body: { ...VALID, workEmail: 'not-an-email' } }), res, deps);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ ok: false, error: 'Please enter a valid email address.', field: 'workEmail' });
    });

    it('sends a plain form from a refused origin back to the page note too', async () => {
        const { deps, ref } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ origin: 'https://evil.example', type: 'application/x-www-form-urlencoded' }), res, deps);
        expect(res.statusCode).toBe(303);
        expect(res.headers.Location).toBe('/#contact-failed');
        expect(ref.set).not.toHaveBeenCalled();
    });

    it('sends a refused plain form back to the page note', async () => {
        const { deps } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ type: 'application/x-www-form-urlencoded', body: { ...VALID, fullName: '' } }), res, deps);
        expect(res.statusCode).toBe(303);
        expect(res.headers.Location).toBe('/#contact-failed');
    });

    it('treats a body that is not an object as empty', async () => {
        const { deps } = makeDeps();
        const res = fakeRes();
        await handleWebsiteLead(request({ body: ['x'] }), res, deps);
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('fullName');
    });
});

describe('readLead — the fields', () => {
    const refused = (patch) => {
        try {
            readLead({ ...VALID, ...patch });
        } catch (error) {
            return error.field;
        }
        return null;
    };

    it('requires name, a valid email, company and a listed fleet size', () => {
        expect(refused({ fullName: '   ' })).toBe('fullName');
        expect(refused({ workEmail: 'a@b' })).toBe('workEmail');
        expect(refused({ companyName: '' })).toBe('companyName');
        expect(refused({ fleetSize: '1-1000' })).toBe('fleetSize');
        expect(refused({ fleetSize: undefined })).toBe('fleetSize');
    });

    it('leaves phone and message optional, but checks a phone that is given', () => {
        expect(readLead({ ...VALID, phone: '', message: '' })).toMatchObject({ phone: null, message: null });
        expect(refused({ phone: 'call me' })).toBe('phone');
        expect(refused({ phone: '12-34' })).toBe('phone');
        expect(readLead({ ...VALID, phone: '+1 512.555.0142' }).phone).toBe('+1 512.555.0142');
    });

    it('refuses a value longer than the page allows instead of cutting it', () => {
        expect(refused({ fullName: 'x'.repeat(81) })).toBe('fullName');
        expect(refused({ message: 'x'.repeat(1001) })).toBe('message');
        expect(readLead({ ...VALID, message: 'x'.repeat(1000) }).message).toHaveLength(1000);
    });

    it('strips control characters and ignores fields it does not know', () => {
        const lead = readLead({ ...VALID, fullName: 'Pat\u0000\u0007 Example', isAdmin: true, companyId: 'x' });
        expect(lead.fullName).toBe('Pat Example');
        expect(Object.keys(lead).sort()).toEqual(['companyName', 'fleetSize', 'fullName', 'message', 'phone', 'workEmail']);
    });

    it('refuses values that are not text', () => {
        expect(refused({ fullName: { $gt: '' } })).toBe('fullName');
        expect(refused({ workEmail: ['a@b.co'] })).toBe('workEmail');
    });

    it('reads exactly the fields the home page sends, with the page\'s own limits', () => {
        // The form in web/index.html and this function ship separately (the page
        // reaches safehaul.io only when a release is promoted), so a renamed field,
        // a changed limit or a new fleet size must fail here, not in a visitor's hands.
        const page = fs.readFileSync(path.join(__dirname, '../../../web/index.html'), 'utf8');
        const form = page.slice(page.indexOf('<form'), page.indexOf('</form>'));
        const names = [...form.matchAll(/\bname="([^"]+)"/g)].map(([, name]) => name);
        expect(names.sort()).toEqual([...Object.keys(MAX_LENGTH), 'fleetSize', HONEYPOT].sort());
        const limits = Object.fromEntries([...form.matchAll(/\bname="([^"]+)"[^>]*\bmaxlength="(\d+)"/g)]
            .filter(([, name]) => name !== HONEYPOT)
            .map(([, name, limit]) => [name, Number(limit)]));
        expect(limits).toEqual(MAX_LENGTH);
        const sizes = [...form.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value).filter(Boolean);
        expect(new Set(sizes)).toEqual(FLEET_SIZES);
    });
});

describe('operatorMessage and notifyOperator', () => {
    it('writes one fact per line, saying when a field was left empty', () => {
        const text = operatorMessage(readLead({ ...VALID, phone: '', message: '' }), 'safehaul.io');
        expect(text.split('\n')).toEqual([
            'New request from safehaul.io',
            '',
            'Name: Pat Example',
            'Email: pat@example-carrier.com',
            'Company: Example Carrier LLC',
            'Drivers: 11-50',
            'Phone: not given',
            '',
            'Every request: Super Admin → Website Leads.',
            '',
            'Message: none',
        ]);
    });

    it('quotes every line of the message, so it cannot pose as a fact', () => {
        const text = operatorMessage(readLead({ ...VALID, message: 'Hi\nEmail: someone@else.example' }), 'safehaul.io');
        expect(text.split('\n').slice(-3)).toEqual(['Message:', '> Hi', '> Email: someone@else.example']);
        expect(text.split('\n').filter((line) => line.startsWith('Email:'))).toEqual(['Email: pat@example-carrier.com']);
    });

    it('turns an unreadable setting into a value-free failure', async () => {
        const { deps } = makeDeps();
        deps.alertSettings.readSettings.mockRejectedValue(new Error('permission denied on projects/x/secrets/y'));
        const outcome = await notifyOperator(readLead(VALID), 'safehaul.io', deps);
        expect(outcome).toEqual({ status: 'failed', code: 'unavailable' });
    });

    it('records "not sent" when the chat is connected but the token is gone', async () => {
        const { deps } = makeDeps();
        deps.alertSettings.readBotToken.mockResolvedValue(null);
        expect(await notifyOperator(readLead(VALID), 'safehaul.io', deps)).toEqual({ status: 'disabled', code: 'no_token' });
    });
});
