/**
 * A signing request created with `sendSms: true` is texted once.
 *
 * Firestore delivers an event at least once, so the trigger can run twice for
 * one request; the screens no longer text the link themselves, so a repeated
 * run must not text it again. A number on the company's or the global opt-out
 * list is not texted, and the request says why. All names and numbers are
 * artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
}));

const mockRequest = { fields: {}, updates: [] };
// The opt-out lists, by path: `companies/{id}/blacklist/{phone}` and `blacklist/{phone}`.
const mockOptOuts = new Set();
const mockListRef = (path) => ({
    get: async () => ({ exists: mockOptOuts.has(path) }),
    collection: (name) => ({ doc: (id) => mockListRef(`${path}/${name}/${id}`) }),
});
mockRequest.ref = {
    collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ accessToken: 'token-1' }) }) }),
    }),
    update: async (data) => {
        mockRequest.updates.push(data);
        Object.assign(mockRequest.fields, data);
    },
};
jest.mock('../../firebaseAdmin', () => {
    const db = {
        runTransaction: async (fn) => fn({
            get: async () => ({ get: (field) => mockRequest.fields[field] }),
            update: (_ref, data) => Object.assign(mockRequest.fields, data),
        }),
        collection: (name) => ({ doc: (id) => mockListRef(`${name}/${id}`) }),
    };
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
    return { admin: { firestore }, db };
});
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { notifySignerSMS } = require('../../notifySignerSMS');
const BaseAdapter = require('../../integrations/adapters/BaseAdapter');

const REQUEST = {
    sendSms: true,
    recipientPhone: '+15555550100',
    senderId: 'user-1',
    senderName: 'Rita Recruiter',
    title: 'Offer Letter',
    appBaseUrl: 'https://truckerapp-system.web.app',
};

const created = (data = REQUEST, id = 'event-1') => notifySignerSMS({
    id,
    params: { companyId: 'co-1', requestId: 'req-1' },
    data: { data: () => data, ref: mockRequest.ref },
});

beforeEach(() => {
    jest.resetAllMocks();
    mockSendSms.mockResolvedValue(undefined);
    mockRequest.fields = {};
    mockRequest.updates = [];
    mockOptOuts.clear();
});

it('texts the link once and records it', async () => {
    await created();

    expect(mockSendSms).toHaveBeenCalledWith(
        '+15555550100',
        '📄 Rita Recruiter sent you "Offer Letter" to sign. Sign here: https://truckerapp-system.web.app/sign/co-1/req-1?token=token-1',
        'user-1',
    );
    expect(mockRequest.fields).toMatchObject({ smsDeliveryId: 'event-1', smsStatus: 'sent' });
});

it('records the phone it texts with its claim, before the text is sent', async () => {
    let recordedWhenSent;
    mockSendSms.mockImplementation(async () => { recordedWhenSent = mockRequest.fields['linkSentTo.phone']; });
    await created();

    expect(recordedWhenSent).toBe('+15555550100');
});

it('texts nothing when the same event is delivered again', async () => {
    await created();
    await created();

    expect(mockSendSms).toHaveBeenCalledTimes(1);
});

it('texts nothing for a request without SMS delivery', async () => {
    await created({ ...REQUEST, sendSms: false });

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockRequest.fields).toEqual({});
});

it('records a failed text', async () => {
    mockSendSms.mockRejectedValue(new Error('line unavailable'));
    await created();

    expect(mockRequest.fields).toMatchObject({ smsStatus: 'failed', smsError: 'line unavailable' });
});

it('records a text RingCentral never answered as failed, saying it may have gone out', async () => {
    const unconfirmed = BaseAdapter.sendUnconfirmedError('RingCentral', 20);
    mockSendSms.mockRejectedValue(unconfirmed);
    await created();

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockRequest.fields).toMatchObject({ smsStatus: 'failed', smsError: unconfirmed.message });
    expect(mockRequest.fields.smsError).toBe(
        'RingCentral did not answer within 20 seconds, so SafeHaul cannot tell whether this text went out. It was not sent again.',
    );
});

it("texts nothing to a number that opted out, on the company's list or the global one, and records why", async () => {
    for (const list of ['companies/co-1/blacklist/+15555550100', 'blacklist/+15555550100']) {
        mockOptOuts.clear();
        mockRequest.fields = {};
        mockOptOuts.add(list);
        await created({ ...REQUEST, recipientPhone: '(555) 555-0100' });

        expect(mockRequest.fields).toMatchObject({ smsStatus: 'failed', smsError: 'Not texted: this number opted out of texts.' });
        expect(mockRequest.fields.smsSentAt).toBeUndefined();
    }
    expect(mockSendSms).not.toHaveBeenCalled();
});

describe('a number that opted out, on a request that also goes by email', () => {
    const EMAILED_TOO = { ...REQUEST, recipientEmail: 'dana@example.test', sendEmail: true, deliveryMethod: 'both' };

    beforeEach(() => mockOptOuts.add('companies/co-1/blacklist/+15555550100'));

    it('is not texted, and the text is recorded as skipped with why, not as failed', async () => {
        await created(EMAILED_TOO);

        expect(mockSendSms).not.toHaveBeenCalled();
        expect(mockRequest.fields).toMatchObject({ smsStatus: 'skipped', smsNote: 'Not texted: this number opted out of texts.' });
        expect(mockRequest.fields.smsError).toBeUndefined();
        expect(mockRequest.fields.smsSentAt).toBeUndefined();
    });

    it('is a failed send when the email is switched off or has no address: nothing reached the signer', async () => {
        for (const data of [{ ...EMAILED_TOO, sendEmail: false }, { ...EMAILED_TOO, recipientEmail: '  ' }]) {
            mockRequest.fields = {};
            await created(data);

            expect(mockRequest.fields).toMatchObject({ smsStatus: 'failed', smsError: 'Not texted: this number opted out of texts.' });
        }
    });
});

describe('the logs', () => {
    const logged = () => [console.log, console.warn, console.error]
        .flatMap((spy) => spy.mock.calls.flat())
        .map((value) => (value instanceof Error ? `${value.message} ${value.stack}` : String(value)))
        .join('\n');

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('name the request, never the number, whether the text went, failed or was skipped', async () => {
        await created();
        expect(console.log).toHaveBeenCalledWith('[NotifySignerSMS] SMS sent for request req-1');
        mockSendSms.mockRejectedValue(new Error('Invalid number +15555550100'));
        await created(REQUEST, 'event-2');
        expect(console.error).toHaveBeenCalledWith('[NotifySignerSMS] Failed to send SMS for req-1: Error');
        await created({ ...REQUEST, sendSms: false }, 'event-3');
        expect(console.log).toHaveBeenCalledWith('[NotifySignerSMS] Skipped: request req-1 asks for no text or has no number');

        expect(logged()).toContain('req-1');
        expect(logged()).not.toMatch(/5555550100/);
    });
});
