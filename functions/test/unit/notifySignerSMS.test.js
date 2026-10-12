/**
 * A signing request created with `sendSms: true` is texted once.
 *
 * Firestore delivers an event at least once, so the trigger can run twice for
 * one request; the screens no longer text the link themselves, so a repeated
 * run must not text it again. All names and numbers are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
}));

const mockRequest = { fields: {}, updates: [] };
jest.mock('../../firebaseAdmin', () => {
    const requestRef = {
        collection: () => ({
            doc: () => ({ get: async () => ({ exists: true, data: () => ({ accessToken: 'token-1' }) }) }),
        }),
        update: async (data) => {
            mockRequest.updates.push(data);
            Object.assign(mockRequest.fields, data);
        },
    };
    const db = {
        collection: () => ({ doc: () => ({ collection: () => ({ doc: () => requestRef }) }) }),
        runTransaction: async (fn) => fn({
            get: async () => ({ get: (field) => mockRequest.fields[field] }),
            update: (_ref, data) => Object.assign(mockRequest.fields, data),
        }),
    };
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
    return { admin: { firestore } };
});
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { notifySignerSMS } = require('../../notifySignerSMS');

const REQUEST = {
    sendSms: true,
    recipientPhone: '+15555550100',
    senderId: 'user-1',
    senderName: 'Rita Recruiter',
    title: 'Offer Letter',
    appBaseUrl: 'https://app.example.test',
};

const created = (data = REQUEST, id = 'event-1') => notifySignerSMS({
    id,
    params: { companyId: 'co-1', requestId: 'req-1' },
    data: { data: () => data },
});

beforeEach(() => {
    jest.resetAllMocks();
    mockSendSms.mockResolvedValue(undefined);
    mockRequest.fields = {};
    mockRequest.updates = [];
});

it('texts the link once and records it', async () => {
    await created();

    expect(mockSendSms).toHaveBeenCalledWith(
        '+15555550100',
        '📄 Rita Recruiter sent you "Offer Letter" to sign. Sign here: https://app.example.test/sign/co-1/req-1?token=token-1',
        'user-1',
    );
    expect(mockRequest.fields).toMatchObject({ smsDeliveryId: 'event-1', smsStatus: 'sent' });
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
