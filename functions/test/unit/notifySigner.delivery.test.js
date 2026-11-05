/**
 * The signing email goes once per event. Firestore delivers an event at least
 * once, so the creation trigger can run twice for one new request: the first run
 * claims the event on the request (`emailDeliveryId`), with the address in
 * `linkSentTo`, before anything is sent, and a repeated run sends nothing, as the
 * text trigger already does (`notifySignerSMS`). Names and addresses are
 * artificial.
 */
jest.mock('firebase-functions/v1', () => {
    const firestore = { document: () => ({ onCreate: (fn) => fn }) };
    return { firestore, runWith: () => ({ firestore }) };
});

const mockRequest = { fields: {}, failClaim: false };
jest.mock('../../firebaseAdmin', () => {
    const db = {
        runTransaction: async (fn) => {
            if (mockRequest.failClaim) throw new Error('aborted');
            const pending = {};
            const result = await fn({
                get: async () => ({ get: (field) => mockRequest.fields[field] }),
                update: (_ref, data) => Object.assign(pending, data),
            });
            Object.assign(mockRequest.fields, pending);
            return result;
        },
    };
    const firestore = () => db;
    firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
    return { admin: { firestore }, db };
});
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));

const { notifySigner } = require('../../notifySigner');

const REQUEST = {
    title: 'Offer Letter',
    recipientName: 'Dana Driver',
    recipientEmail: 'Dana@Example.test',
    sendEmail: true,
    senderName: 'Rita Recruiter',
    appBaseUrl: 'https://truckerapp-system.web.app',
};

const ref = {
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ accessToken: 'token-1' }) }) }) }),
    update: async (data) => { Object.assign(mockRequest.fields, data); },
};

const created = (eventId = 'event-1') => notifySigner(
    { data: () => REQUEST, ref },
    { eventId, params: { companyId: 'co-1', requestId: 'req-1' } },
);

beforeEach(() => {
    jest.resetAllMocks();
    mockSendEmail.mockResolvedValue(undefined);
    mockRequest.fields = {};
    mockRequest.failClaim = false;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('emails the link once when the same event is delivered twice', async () => {
    await created();
    await created();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockRequest.fields).toMatchObject({ emailDeliveryId: 'event-1', emailStatus: 'sent' });
});

it('claims the event, with the address it emails, before it sends', async () => {
    let atSend;
    mockSendEmail.mockImplementation(async () => { atSend = { ...mockRequest.fields }; });

    await created();

    expect(atSend).toMatchObject({ emailDeliveryId: 'event-1', 'linkSentTo.email': 'dana@example.test' });
});

it('sends nothing, and records why, when the claim cannot be made', async () => {
    mockRequest.failClaim = true;

    await created();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRequest.fields).toMatchObject({ emailStatus: 'failed' });
});
