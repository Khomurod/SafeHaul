/**
 * The delivery check of an SMS campaign (`bulkActions/delivery/`): a text
 * RingCentral accepted and then did not deliver (a spam filter) becomes a
 * failed log with the reason, and the campaign's totals move it from sent to
 * failed, once; a delivered text keeps its sent entry; a campaign sent before
 * message ids were kept is matched by number and time; a line that cannot be
 * read says so. Then the queue, the scheduled run and the report's button.
 * All data is artificial.
 */

jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    return { onCall: (opts, handler) => handler, HttpsError };
});
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => handler }));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockGetAdapterForUser = jest.fn();
jest.mock('../../integrations/factory', () => ({ getAdapterForUser: (...args) => mockGetAdapterForUser(...args) }));
const mockAssertCompanyAdmin = jest.fn();
jest.mock('../../bulkActions/helpers/auth', () => ({ assertCompanyAdmin: (...args) => mockAssertCompanyAdmin(...args) }));
const mockCheckRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...args) => mockCheckRateLimit(...args) }));

const { checkSessionDelivery } = require('../../bulkActions/delivery/checkSessionDelivery');
const { queueDeliveryCheck } = require('../../bulkActions/delivery/deliveryQueue');
const { checkSmsDeliveries, checkCampaignDelivery } = require('../../bulkActions/delivery/deliveryCheck');

const SESSION = 'companies/co-1/bulk_sessions/s-1';
const QUEUE_ENTRY = 'system_jobs/smsDelivery/sessions/co-1__s-1';
const SENT_AT = Date.parse('2026-10-20T15:00:00Z');
const at = (ms) => ({ toMillis: () => ms });
const SENT = at(SENT_AT);

const sentLog = (phone, extra = {}) => ({
    recipientName: 'Test Driver',
    recipientIdentity: phone,
    status: 'delivered',
    error: null,
    timestamp: SENT,
    isSuccess: true,
    ...extra,
});
const rcRecord = (id, phone, status, errorCode) => ({
    id,
    creationTime: new Date(SENT_AT - 1000).toISOString(),
    messageStatus: status,
    to: [{ phoneNumber: phone, messageStatus: status, ...(errorCode ? { errorCode } : {}) }],
});

function seed(logs, session = {}) {
    mock.reset({
        [SESSION]: {
            config: { method: 'sms', message: 'Hello' },
            createdBy: 'recruiter-1',
            progress: { successCount: Object.keys(logs).length, failedCount: 0 },
            ...session,
        },
        ...Object.fromEntries(Object.entries(logs).map(([id, log]) => [`${SESSION}/logs/${id}`, log])),
    });
}

function lineListing(records, complete = true) {
    const adapter = { listSentSms: jest.fn().mockResolvedValue({ records, complete }) };
    mockGetAdapterForUser.mockResolvedValue(adapter);
    return adapter;
}

const doc = (path) => mock.docs.get(path);

beforeEach(() => {
    jest.resetAllMocks();
    mockCheckRateLimit.mockResolvedValue(true);
    mockAssertCompanyAdmin.mockResolvedValue(undefined);
});

describe('checkSessionDelivery', () => {
    it('marks a text RingCentral did not deliver as not sent, with the reason, and moves it between the totals', async () => {
        seed({
            'lead-1': sentLog('(555) 123-4567', { providerMessageId: '101', delivery: { state: 'pending', providerStatus: 'Queued' } }),
            'lead-2': sentLog('(555) 222-3333', { providerMessageId: '102', delivery: { state: 'pending', providerStatus: 'Queued' } }),
        });
        const line = lineListing([
            rcRecord(101, '+15551234567', 'DeliveryFailed', 'SMS-CAR-430'),
            rcRecord(102, '+15552223333', 'Delivered'),
        ]);

        const result = await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1', now: SENT_AT + 10 * 60000 });

        expect(result).toEqual({ status: 'checked', counts: { delivered: 1, failed: 1, pending: 0, unconfirmed: 0, unknown: 0 } });
        expect(mockGetAdapterForUser).toHaveBeenCalledWith('co-1', 'recruiter-1');
        expect(line.listSentSms).toHaveBeenCalledWith({
            dateFrom: new Date(SENT_AT - 10 * 60000).toISOString(),
            dateTo: new Date(SENT_AT + 10 * 60000).toISOString(),
        });
        expect(doc(`${SESSION}/logs/lead-1`)).toMatchObject({
            status: 'failed',
            isSuccess: false,
            error: 'Not delivered: RingCentral reported DeliveryFailed, code SMS-CAR-430.',
            delivery: { state: 'failed', providerStatus: 'DeliveryFailed', errorCode: 'SMS-CAR-430' },
        });
        expect(doc(`${SESSION}/logs/lead-2`)).toMatchObject({
            status: 'delivered',
            isSuccess: true,
            error: null,
            delivery: { state: 'delivered', providerStatus: 'Delivered' },
        });
        expect(doc(SESSION).progress).toEqual({ successCount: 1, failedCount: 1 });
        expect(doc(SESSION).deliveryCheckedAt).toBe('__server_timestamp__');
    });

    it('moves a failed text between the totals only once, however often it is checked', async () => {
        seed({ 'lead-1': sentLog('5551234567', { providerMessageId: '101' }) });
        lineListing([rcRecord(101, '+15551234567', 'SendingFailed')]);

        await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1', now: SENT_AT + 60000 });
        const again = await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1', now: SENT_AT + 120000 });

        expect(again.status).toBe('nothing_to_check');
        expect(doc(SESSION).progress).toEqual({ successCount: 0, failedCount: 1 });
    });

    it('checks a campaign sent before message ids were kept by number and time', async () => {
        seed({
            'lead-1': sentLog('(555) 123-4567'),
            'lead-2': sentLog('(555) 999-0000'),
        });
        lineListing([rcRecord(9001, '+15551234567', 'DeliveryFailed', 'SMS-CAR-430')]);

        const result = await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1', now: SENT_AT + 3 * 24 * 60 * 60000, everyLog: true });

        expect(result.counts).toEqual({ delivered: 0, failed: 1, pending: 0, unconfirmed: 0, unknown: 1 });
        expect(doc(`${SESSION}/logs/lead-1`)).toMatchObject({ status: 'failed', isSuccess: false });
        // No record of the second text: it stays sent, with its fate unknown.
        expect(doc(`${SESSION}/logs/lead-2`)).toMatchObject({ status: 'delivered', isSuccess: true, delivery: { state: 'unknown' } });
    });

    it('leaves a text RingCentral has not reported on waiting, and changes nothing', async () => {
        seed({ 'lead-1': sentLog('5551234567', { providerMessageId: '101', delivery: { state: 'pending', providerStatus: 'Sent' } }) });
        lineListing([rcRecord(101, '+15551234567', 'Sent')]);

        const result = await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1', now: SENT_AT + 60000 });

        expect(result.counts.pending).toBe(1);
        expect(doc(`${SESSION}/logs/lead-1`).delivery).toEqual({ state: 'pending', providerStatus: 'Sent' });
        expect(doc(SESSION).deliveryCheckedAt).toBeUndefined();
    });

    it('does not check an email campaign, or a campaign with nothing sent', async () => {
        seed({ 'lead-1': sentLog('5551234567') }, { config: { method: 'email', message: 'Hi' } });
        expect((await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1' })).status).toBe('not_sms');

        seed({ 'lead-1': sentLog('5551234567', { status: 'failed', isSuccess: false, error: 'No valid phone number' }) });
        expect((await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1' })).status).toBe('nothing_to_check');
        expect(mockGetAdapterForUser).not.toHaveBeenCalled();
    });

    it('says so when the line keeps no message store, or the app may not read it', async () => {
        seed({ 'lead-1': sentLog('5551234567') });
        mockGetAdapterForUser.mockResolvedValue({ sendSMS: jest.fn() });
        expect((await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1' })).status).toBe('unsupported');

        const refused = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
        mockGetAdapterForUser.mockResolvedValue({ listSentSms: jest.fn().mockRejectedValue(refused) });
        expect((await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1' })).status).toBe('no_permission');

        mockGetAdapterForUser.mockResolvedValue({ listSentSms: jest.fn().mockRejectedValue(new Error('socket hang up')) });
        expect(await checkSessionDelivery({ companyId: 'co-1', sessionId: 's-1' }))
            .toMatchObject({ status: 'error', message: 'socket hang up' });
        expect(doc(`${SESSION}/logs/lead-1`)).toEqual(sentLog('5551234567'));
    });
});

// The scheduled run and the button check at the real time: these texts went out a minute ago.
const justSent = (extra) => sentLog('5551234567', { providerMessageId: '101', timestamp: at(Date.now() - 60000), ...extra });

describe('the queue and the scheduled check', () => {
    it('checks a queued campaign and keeps it queued while texts wait', async () => {
        seed({ 'lead-1': justSent() });
        lineListing([rcRecord(101, '+15551234567', 'Queued')]);
        await queueDeliveryCheck('co-1', 's-1', 0);

        await checkSmsDeliveries();

        expect(doc(`${SESSION}/logs/lead-1`).delivery).toMatchObject({ state: 'pending', providerStatus: 'Queued' });
        expect(doc(QUEUE_ENTRY)).toMatchObject({ companyId: 'co-1', sessionId: 's-1', errors: 0 });
        expect(doc(QUEUE_ENTRY).dueAt.toMillis()).toBeGreaterThan(Date.now() + 14 * 60000);
    });

    it('takes a campaign off the queue once every text is settled', async () => {
        seed({ 'lead-1': justSent() });
        lineListing([rcRecord(101, '+15551234567', 'Delivered')]);
        await queueDeliveryCheck('co-1', 's-1', 0);

        await checkSmsDeliveries();

        expect(doc(`${SESSION}/logs/lead-1`).delivery.state).toBe('delivered');
        expect(doc(QUEUE_ENTRY)).toBeUndefined();
    });

    it('retries a check that failed later, and gives up after many failures', async () => {
        seed({ 'lead-1': sentLog('5551234567') });
        mockGetAdapterForUser.mockRejectedValue(new Error('No SMS provider configured'));
        await queueDeliveryCheck('co-1', 's-1', 0);

        await checkSmsDeliveries();
        expect(doc(QUEUE_ENTRY).errors).toBe(1);

        mock.docs.set(QUEUE_ENTRY, { ...doc(QUEUE_ENTRY), errors: 23, dueAt: at(0) });
        await checkSmsDeliveries();
        expect(doc(QUEUE_ENTRY)).toBeUndefined();
    });
});

describe('checkCampaignDelivery (the report button)', () => {
    const call = (data, auth = { uid: 'recruiter-1' }) => checkCampaignDelivery({ data, auth });

    it('checks the campaign for its company staff and returns the counts', async () => {
        seed({ 'lead-1': justSent() });
        lineListing([rcRecord(101, '+15551234567', 'Delivered')]);

        await expect(call({ companyId: 'co-1', sessionId: 's-1' })).resolves.toEqual({
            status: 'checked',
            counts: { delivered: 1, failed: 0, pending: 0, unconfirmed: 0, unknown: 0 },
        });
        expect(mockAssertCompanyAdmin).toHaveBeenCalledWith('recruiter-1', 'co-1');
        expect(doc(QUEUE_ENTRY)).toBeUndefined();
    });

    it('queues a later check when some texts are still on their way', async () => {
        seed({ 'lead-1': justSent() });
        lineListing([rcRecord(101, '+15551234567', 'Queued')]);

        await call({ companyId: 'co-1', sessionId: 's-1' });

        expect(doc(QUEUE_ENTRY)).toMatchObject({ companyId: 'co-1', sessionId: 's-1' });
    });

    it('refuses a caller without sign-in, access, or checks left this hour, before reading RingCentral', async () => {
        seed({ 'lead-1': sentLog('5551234567') });
        await expect(call({ companyId: 'co-1', sessionId: 's-1' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(call({ companyId: 'co-1' })).rejects.toMatchObject({ code: 'invalid-argument' });

        mockAssertCompanyAdmin.mockRejectedValueOnce(Object.assign(new Error('No access'), { code: 'permission-denied' }));
        await expect(call({ companyId: 'co-1', sessionId: 's-1' })).rejects.toMatchObject({ code: 'permission-denied' });

        mockCheckRateLimit.mockResolvedValueOnce(false);
        await expect(call({ companyId: 'co-1', sessionId: 's-1' })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockGetAdapterForUser).not.toHaveBeenCalled();
    });

    it('says when the campaign does not exist', async () => {
        mock.reset();
        await expect(call({ companyId: 'co-1', sessionId: 's-1' })).rejects.toMatchObject({ code: 'not-found' });
    });
});
