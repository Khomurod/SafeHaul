/**
 * A signing request corrected to a new email or phone goes out again, with a
 * new link; the link sent before stops working.
 *
 * The creation triggers send a request once. Correct Document saved the new
 * contact and sent nothing, so the signer never got the link, while whoever
 * had the wrong address kept a working one. Firestore delivers each change at
 * least once and in no set order, so the tests also deliver corrections twice
 * and out of order. All names, addresses and numbers are artificial.
 */
jest.mock('firebase-functions/v1', () => {
    const firestore = { document: () => ({ onCreate: (fn) => fn }) };
    return { firestore, runWith: () => ({ firestore }) };
});
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// A small document store: the request and its token, read and written by path.
const mockDocs = new Map();
function mockSnapshot(path) {
    const data = mockDocs.get(path);
    return { exists: data !== undefined, data: () => structuredClone(data), get: (field) => data?.[field] };
}
function mockUpdate(path, changes) {
    const doc = structuredClone(mockDocs.get(path) || {});
    for (const [key, value] of Object.entries(changes)) {
        const parts = key.split('.');
        const leaf = parts.pop();
        let target = doc;
        for (const part of parts) {
            target[part] = { ...target[part] };
            target = target[part];
        }
        target[leaf] = value;
    }
    mockDocs.set(path, doc);
}
jest.mock('../../firebaseAdmin', () => {
    const db = {
        runTransaction: async (fn) => fn({
            get: async (ref) => mockSnapshot(ref.path),
            set: (ref, data) => mockDocs.set(ref.path, structuredClone(data)),
            update: (ref, data) => mockUpdate(ref.path, data),
        }),
    };
    const firestore = Object.assign(() => db, {
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
        Timestamp: { fromMillis: (ms) => ({ ms }) },
    });
    return { admin: { firestore } };
});
const mockSendEmail = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...args) => mockSendEmail(...args) }));
const mockSendSms = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSms(...args) }),
}));

const { linkSentTo, linkWork } = require('../../shared/signingLink');
const { resendSignerOnCorrection } = require('../../resendSignerOnCorrection');
const { notifySigner } = require('../../notifySigner');

const REQUEST = 'companies/co-1/signing_requests/req-1';
const TOKEN = `${REQUEST}/secrets/token`;
const DAY_MS = 24 * 60 * 60 * 1000;
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
    expiresAt: { ms: 0 },
    linkSentTo: { email: 'dana@wrong.example.test' },
};
const BOTH = { ...SENT, sendSms: true, deliveryMethod: 'both', linkSentTo: { email: 'dana@wrong.example.test', phone: '+15555550100' } };
/** The request as saved before `linkSentTo` was recorded. */
const unrecorded = ({ linkSentTo: _recorded, ...request }) => request;

function refAt(path) {
    return {
        path,
        collection: (name) => ({ doc: (id) => refAt(`${path}/${name}/${id}`) }),
        get: async () => mockSnapshot(path),
        set: async (data) => mockDocs.set(path, structuredClone(data)),
        update: async (data) => mockUpdate(path, data),
    };
}
const current = () => mockDocs.get(REQUEST);
const token = () => mockDocs.get(TOKEN)?.accessToken;
const linkWith = (accessToken) => `https://app.example.test/sign/co-1/req-1?token=${accessToken}`;
const emailedTo = () => mockSendEmail.mock.calls.map(([, to]) => to);

function store(request, accessToken = 'old-token') {
    mockDocs.set(REQUEST, structuredClone(request));
    mockDocs.set(TOKEN, { accessToken });
}

/** Firestore's change event for one write: the request before it and after it. */
function changeEvent(before, after, id) {
    return {
        id,
        params: { companyId: 'co-1', requestId: 'req-1' },
        data: { before: { data: () => before }, after: { data: () => after, ref: refAt(REQUEST) } },
    };
}

/** Saves a correction of the stored request, as Correct Document does, and returns its event. */
function correction(changes, id = 'event-1') {
    const before = structuredClone(current());
    const after = { ...before, ...changes };
    mockDocs.set(REQUEST, structuredClone(after));
    return changeEvent(before, after, id);
}

beforeEach(() => {
    jest.resetAllMocks();
    mockDocs.clear();
    mockSendEmail.mockResolvedValue(undefined);
    mockSendSms.mockResolvedValue(undefined);
});

describe('where a link goes', () => {
    const work = (data) => linkWork(data, linkSentTo(data));

    it('sends nothing when the link already went where the request says', () => {
        expect(work({ ...SENT, title: 'Offer Letter v2' })).toEqual({ replace: false, email: false, sms: false });
        expect(work({ ...BOTH, recipientEmail: ' DANA@wrong.example.test ', recipientPhone: '5555550100' }))
            .toEqual({ replace: false, email: false, sms: false });
    });

    it('replaces the link and sends it on every channel when an email or phone it went to changed', () => {
        expect(work({ ...SENT, recipientEmail: 'dana@example.test' })).toEqual({ replace: true, email: true, sms: false });
        expect(work({ ...BOTH, recipientPhone: '+1 555 555 0199' })).toEqual({ replace: true, email: true, sms: true });
    });

    it('replaces the link and sends nothing when the correction also switches to Copy Link', () => {
        expect(work({ ...SENT, recipientEmail: 'dana@example.test', sendEmail: false, deliveryMethod: 'copy' }))
            .toEqual({ replace: true, email: false, sms: false });
    });

    it('keeps the link of a request the server never sent, and sends it where it is now asked to', () => {
        const copy = { ...SENT, sendEmail: false, deliveryMethod: 'copy', linkSentTo: {} };
        expect(work({ ...copy, recipientEmail: 'dana@example.test' })).toEqual({ replace: false, email: false, sms: false });
        expect(work({ ...copy, recipientEmail: 'dana@example.test', sendEmail: true, deliveryMethod: 'email' }))
            .toEqual({ replace: false, email: true, sms: false });
    });

    it('sends the link on a channel switched on, and to a phone it never went to', () => {
        expect(work({ ...SENT, sendSms: true, deliveryMethod: 'both' })).toEqual({ replace: false, email: false, sms: true });
        expect(work({ ...SENT, recipientPhone: '+1 555 555 0199' })).toEqual({ replace: false, email: false, sms: false });
    });

    it('reads where the link of a request saved before the record went from how it was sent', () => {
        const older = unrecorded(BOTH);
        expect(linkSentTo(older)).toEqual({ email: 'dana@wrong.example.test', phone: '+15555550100' });
        expect(linkSentTo({ ...older, sendSms: false })).toEqual({ email: 'dana@wrong.example.test' });
        expect(linkSentTo({ ...older, sendEmail: false, sendSms: false })).toEqual({});
        expect(linkSentTo({ ...older, recipientEmail: 'dana@example.test' }, older)).toEqual(linkSentTo(older));
    });
});

describe('resendSignerOnCorrection', () => {
    it('emails a new link to the corrected address: the old one stops working and the link has seven days', async () => {
        store(SENT);
        await resendSignerOnCorrection(correction({ recipientEmail: 'dana@example.test' }));

        expect(token()).toMatch(/^[0-9a-f-]{36}$/);
        expect(emailedTo()).toEqual(['dana@example.test']);
        const html = mockSendEmail.mock.calls[0][3];
        expect(html).toContain(linkWith(token()));
        expect(html).not.toContain('old-token');
        // The address is new to this request: it never had an earlier link.
        expect(html).not.toContain('replaces the one sent to you earlier');
        expect(current()).toMatchObject({ linkSentTo: { email: 'dana@example.test' }, emailStatus: 'sent' });
        expect(current().expiresAt.ms).toBeGreaterThan(Date.now() + 7 * DAY_MS - 60 * 1000);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('texts and emails the new link when the phone of an Email + SMS request is corrected', async () => {
        store(BOTH);
        await resendSignerOnCorrection(correction({ recipientPhone: '+1 555 555 0199' }));

        const link = linkWith(token());
        expect(mockSendSms).toHaveBeenCalledWith('+1 555 555 0199', `📄 Rita Recruiter sent you "Offer Letter" to sign. Sign here: ${link}`, 'user-1');
        expect(emailedTo()).toEqual(['dana@wrong.example.test']);
        // The address kept its place and had the link that no longer works.
        expect(mockSendEmail.mock.calls[0][3]).toContain(link);
        expect(mockSendEmail.mock.calls[0][3]).toContain('This link replaces the one sent to you earlier, which no longer works.');
        expect(current()).toMatchObject({
            linkSentTo: { email: 'dana@wrong.example.test', phone: '+15555550199' },
            emailStatus: 'sent',
            smsStatus: 'sent',
        });
    });

    it('texts the current link when a correction switches SMS on, keeping the link', async () => {
        store(SENT);
        await resendSignerOnCorrection(correction({ sendSms: true, deliveryMethod: 'both' }));

        expect(token()).toBe('old-token');
        expect(mockSendSms.mock.calls[0][1]).toContain('?token=old-token');
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(current().linkSentTo).toEqual({ email: 'dana@wrong.example.test', phone: '+15555550100' });
    });

    it('replaces the link and sends it once when one correction is delivered twice', async () => {
        store(SENT);
        const event = correction({ recipientEmail: 'dana@example.test' });
        await resendSignerOnCorrection(event);
        const replaced = token();
        await resendSignerOnCorrection(event);

        expect(token()).toBe(replaced);
        expect(emailedTo()).toEqual(['dana@example.test']);
    });

    it('leaves only the latest address with a working link when two corrections arrive in reverse order', async () => {
        store(SENT);
        const first = correction({ recipientEmail: 'dana@typo.example.test' }, 'event-1');
        const second = correction({ recipientEmail: 'dana@example.test' }, 'event-2');
        await resendSignerOnCorrection(second);
        await resendSignerOnCorrection(first);

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(linkWith(token()));
        expect(token()).not.toBe('old-token');
    });

    it('still replaces a link sent to a corrected address when a later correction that switches SMS on arrives first', async () => {
        store(SENT);
        const first = correction({ recipientEmail: 'dana@example.test' }, 'event-1');
        const second = correction({ sendSms: true, deliveryMethod: 'both' }, 'event-2');
        await resendSignerOnCorrection(second);
        await resendSignerOnCorrection(first);

        expect(token()).not.toBe('old-token');
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(linkWith(token()));
        expect(mockSendSms).toHaveBeenCalledTimes(1);
        expect(mockSendSms.mock.calls[0][1]).toContain(linkWith(token()));
    });

    it('sends the link that Copy Link already replaced, without replacing it again', async () => {
        store(SENT);
        const event = correction({ recipientEmail: 'dana@example.test' });
        // Copy Link ran first (`getSigningLink`): the new token has reached no one.
        mockUpdate(REQUEST, { linkSentTo: {} });
        mockDocs.set(TOKEN, { accessToken: 'copied-token' });
        await resendSignerOnCorrection(event);

        expect(token()).toBe('copied-token');
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(mockSendEmail.mock.calls[0][3]).toContain(linkWith('copied-token'));
    });

    it('settles a request saved before the record from how it was sent', async () => {
        store(unrecorded(SENT));
        await resendSignerOnCorrection(correction({ recipientEmail: 'dana@example.test' }));

        expect(token()).not.toBe('old-token');
        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(current().linkSentTo).toEqual({ email: 'dana@example.test' });
    });

    it('sends nothing for an update that is not a correction, or once the request is signed', async () => {
        store(SENT);
        await resendSignerOnCorrection(correction({ emailStatus: 'sent', emailSentAt: '2026-10-12T00:00:00.000Z' }));
        const late = correction({ recipientEmail: 'dana@example.test' });
        mockUpdate(REQUEST, { status: 'signed' });
        await resendSignerOnCorrection(late);

        expect(token()).toBe('old-token');
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('records a failed text without stopping the email', async () => {
        mockSendSms.mockRejectedValue(new Error('line unavailable'));
        store(BOTH);
        await resendSignerOnCorrection(correction({ recipientEmail: 'dana@example.test' }));

        expect(emailedTo()).toEqual(['dana@example.test']);
        expect(current()).toMatchObject({ smsStatus: 'failed', smsError: 'line unavailable' });
    });
});

describe('notifySigner', () => {
    const created = (data) => notifySigner({ data: () => data, ref: refAt(REQUEST) }, { params: { companyId: 'co-1', requestId: 'req-1' } });

    it('shows the names and title in its email as text, never as markup', async () => {
        const request = unrecorded(SENT);
        store(request, 'token-1');
        await created({ ...request, recipientName: '<a href="https://evil.example.test">Dana</a>', title: '<b>Offer</b>' });

        const html = mockSendEmail.mock.calls[0][3];
        expect(html).toContain('&lt;a href=&quot;https://evil.example.test&quot;&gt;Dana&lt;/a&gt;');
        expect(html).toContain('&lt;b&gt;Offer&lt;/b&gt;');
        expect(html).not.toContain('<a href="https://evil.example.test">');
        expect(html).toContain('?token=token-1');
        expect(html).not.toContain('replaces the one sent to you earlier');
    });

    it('records the address it emails before it sends, so a correction of it replaces the link', async () => {
        const request = unrecorded(SENT);
        store(request, 'token-1');
        let recordedWhenSent;
        mockSendEmail.mockImplementation(async () => { recordedWhenSent = current().linkSentTo; });
        await created({ ...request, recipientEmail: ' Dana@Wrong.example.test ' });

        expect(recordedWhenSent).toEqual({ email: 'dana@wrong.example.test' });
        expect(current().emailStatus).toBe('sent');
    });
});
