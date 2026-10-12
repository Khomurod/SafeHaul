/**
 * A signing request corrected to a new email or phone goes out again, with a
 * new link; the link sent before stops working.
 *
 * The creation triggers send a request once. Correct Document saved the new
 * contact and sent nothing, so the signer never got the link, while whoever
 * had the wrong address kept a working one. All names, addresses and numbers
 * are artificial.
 */
jest.mock('firebase-functions/v1', () => ({
    firestore: { document: () => ({ onCreate: (fn) => fn }) },
}));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));
jest.mock('../../firebaseAdmin', () => {
    const firestore = () => ({
        runTransaction: async (fn) => fn({
            get: async (ref) => ({ get: (field) => ref.fields[field] }),
            update: (ref, data) => Object.assign(ref.fields, data),
        }),
    });
    firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
    return { admin: { firestore } };
});
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { correctionDelivery, resendSignerOnCorrection } = require('../../resendSignerOnCorrection');
const { notifySigner } = require('../../notifySigner');

const SENT = {
    status: 'sent',
    title: 'Offer Letter',
    senderName: 'Rita Recruiter',
    senderId: 'user-1',
    recipientName: 'Dana Driver',
    recipientEmail: 'dana@wrong.example.test',
    recipientPhone: '+1 (555) 555-0100',
    sendEmail: true,
    sendSms: false,
    appBaseUrl: 'https://app.example.test',
};

function fakeRequest(storedToken = 'old-token') {
    const secret = { accessToken: storedToken };
    const updates = [];
    const ref = {
        updates,
        secret,
        fields: {},
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: Boolean(secret.accessToken), data: () => ({ ...secret }) }),
                set: async (data) => { secret.accessToken = data.accessToken; },
            }),
        }),
        update: async (data) => { updates.push(data); },
    };
    return ref;
}

function correct(before, after, ref = fakeRequest(), id = 'event-1') {
    return resendSignerOnCorrection({
        id,
        params: { companyId: 'co-1', requestId: 'req-1' },
        data: { before: { data: () => before }, after: { data: () => after, ref } },
    }).then(() => ref);
}

beforeEach(() => {
    jest.resetAllMocks();
    mockSendEmail.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
});

describe('correctionDelivery', () => {
    it('sends nothing when no contact or channel changed', () => {
        expect(correctionDelivery(SENT, { ...SENT, title: 'Offer Letter v2', smsStatus: 'sent' })).toBeNull();
        expect(correctionDelivery(SENT, { ...SENT, recipientEmail: ' DANA@wrong.example.test ', recipientPhone: '5555550100' })).toBeNull();
    });

    it('sends nothing once the request is signed', () => {
        expect(correctionDelivery(SENT, { ...SENT, status: 'signed', recipientEmail: 'dana@example.test' })).toBeNull();
    });

    it('replaces the link and sends it on every channel when the email or phone changed', () => {
        expect(correctionDelivery(SENT, { ...SENT, recipientEmail: 'dana@example.test' }))
            .toEqual({ newToken: true, email: true, sms: false });
        const both = { ...SENT, sendSms: true };
        expect(correctionDelivery(both, { ...both, recipientPhone: '+1 555 555 0199' }))
            .toEqual({ newToken: true, email: true, sms: true });
    });

    it('replaces the link and sends nothing when the correction also switches to Copy Link', () => {
        expect(correctionDelivery(SENT, { ...SENT, recipientEmail: 'dana@example.test', sendEmail: false, deliveryMethod: 'copy' }))
            .toEqual({ newToken: true, email: false, sms: false });
    });

    it('keeps the link of a Copy Link request, which the server never sent', () => {
        const copy = { ...SENT, sendEmail: false, deliveryMethod: 'copy' };
        expect(correctionDelivery(copy, { ...copy, recipientEmail: 'dana@example.test' })).toBeNull();
    });

    it('sends the current link on a channel the correction switched on', () => {
        expect(correctionDelivery(SENT, { ...SENT, sendSms: true, deliveryMethod: 'both' }))
            .toEqual({ newToken: false, email: false, sms: true });
    });

    it('keeps the emailed link when the phone it never went to changes', () => {
        const added = { ...SENT, recipientPhone: '+1 555 555 0199', sendSms: true, deliveryMethod: 'both' };
        expect(correctionDelivery(SENT, added)).toEqual({ newToken: false, email: false, sms: true });
        expect(correctionDelivery(SENT, { ...SENT, recipientPhone: '+1 555 555 0199' })).toBeNull();
    });
});

describe('resendSignerOnCorrection', () => {
    it('emails a new link to the corrected address, and the old link stops working', async () => {
        const ref = await correct(SENT, { ...SENT, recipientEmail: 'dana@example.test' });

        expect(ref.secret.accessToken).not.toBe('old-token');
        expect(ref.secret.accessToken).toMatch(/^[0-9a-f-]{36}$/);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const [companyId, to, , html] = mockSendEmail.mock.calls[0];
        expect([companyId, to]).toEqual(['co-1', 'dana@example.test']);
        expect(html).toContain(`https://app.example.test/sign/co-1/req-1?token=${ref.secret.accessToken}`);
        expect(html).not.toContain('old-token');
        expect(html).toContain('This link replaces the one sent to you earlier, which no longer works.');
        expect(ref.updates).toEqual([expect.objectContaining({ emailStatus: 'sent' })]);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('texts and emails the new link when the phone of an Email + SMS request is corrected', async () => {
        const both = { ...SENT, sendSms: true };
        const ref = await correct(both, { ...both, recipientPhone: '+1 555 555 0199' });

        const link = `https://app.example.test/sign/co-1/req-1?token=${ref.secret.accessToken}`;
        expect(mockSendSms).toHaveBeenCalledWith('+1 555 555 0199', `📄 Rita Recruiter sent you "Offer Letter" to sign. Sign here: ${link}`, 'user-1');
        expect(mockSendEmail.mock.calls[0][3]).toContain(link);
        expect(ref.updates).toEqual(expect.arrayContaining([
            expect.objectContaining({ emailStatus: 'sent' }),
            expect.objectContaining({ smsStatus: 'sent' }),
        ]));
    });

    it('texts the current link when a correction switches SMS on, keeping the link', async () => {
        const ref = await correct(SENT, { ...SENT, sendSms: true, deliveryMethod: 'both' });

        expect(ref.secret.accessToken).toBe('old-token');
        expect(mockSendSms.mock.calls[0][1]).toContain('?token=old-token');
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('replaces the link and sends it once when one correction is delivered twice', async () => {
        const ref = fakeRequest();
        const corrected = { ...SENT, recipientEmail: 'dana@example.test' };
        await correct(SENT, corrected, ref);
        const newToken = ref.secret.accessToken;
        await correct(SENT, corrected, ref);

        expect(ref.secret.accessToken).toBe(newToken);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(ref.fields.correctionDeliveryId).toBe('event-1');
    });

    it('sends nothing for an update that is not a correction', async () => {
        const ref = await correct(SENT, { ...SENT, emailStatus: 'sent', emailSentAt: '2026-10-12T00:00:00.000Z' });
        await correct(SENT, { ...SENT, status: 'signed', signedAt: 'now' });

        expect(ref.secret.accessToken).toBe('old-token');
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('records a failed text without stopping the email', async () => {
        mockSendSms.mockRejectedValue(new Error('line unavailable'));
        const both = { ...SENT, sendSms: true };
        const ref = await correct(both, { ...both, recipientEmail: 'dana@example.test' });

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(ref.updates).toEqual(expect.arrayContaining([{ smsStatus: 'failed', smsError: 'line unavailable' }]));
    });
});

describe('notifySigner', () => {
    it('shows the names and title in its email as text, never as markup', async () => {
        const ref = fakeRequest('token-1');
        await notifySigner(
            { data: () => ({ ...SENT, recipientName: '<a href="https://evil.example.test">Dana</a>', title: '<b>Offer</b>' }), ref },
            { params: { companyId: 'co-1', requestId: 'req-1' } },
        );

        const html = mockSendEmail.mock.calls[0][3];
        expect(html).toContain('&lt;a href=&quot;https://evil.example.test&quot;&gt;Dana&lt;/a&gt;');
        expect(html).toContain('&lt;b&gt;Offer&lt;/b&gt;');
        expect(html).not.toContain('<a href="https://evil.example.test">');
        expect(html).toContain('?token=token-1');
        expect(html).not.toContain('replaces the one sent to you earlier');
    });
});
