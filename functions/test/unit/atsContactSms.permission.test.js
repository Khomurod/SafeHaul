/**
 * Who the automatic Contact Attempt text reaches, and what the driver's history
 * says about it.
 *
 * An application's driver answers "Can we send you SMS messages?" on page one
 * (`sms-consent`, optional): only an explicit "yes" lets the automatic text go.
 * Leads were never asked, so a lead is texted as before. A number on the
 * company's or the global opt-out list gets no automatic text. Every automatic
 * text leaves one entry in the record's activity log: sent, not sent and why,
 * or failed, without the message or the number. All names and numbers are
 * artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// A small document store, read and written by path.
const mockDocs = new Map();
function mockRef(path) {
    return {
        path,
        collection: (name) => ({ doc: (id) => mockRef(`${path}/${name}/${id}`) }),
        get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
        create: async (data) => {
            if (mockDocs.has(path)) throw Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 });
            mockDocs.set(path, data);
        },
    };
}
jest.mock('../../firebaseAdmin', () => ({
    db: { collection: (name) => ({ doc: (id) => mockRef(`${name}/${id}`) }) },
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
}));

const mockSendSMS = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSMS(...args) }),
}));

const { onApplicationAtsContactSms, onLeadAtsContactSms } = require('../../atsContactSms');
const BaseAdapter = require('../../integrations/adapters/BaseAdapter');

const COMPANY = 'companies/co-1';
const PHONE = '+15551234567';
const DRIVER = { firstName: 'Bob', lastName: 'Driver', phone: '(555) 123-4567', assignedTo: 'recruiter-1', assignedToName: 'Sam Rivera' };

/** Firestore's change event for a record moved from New into Contact Attempt 1. */
function moved(collection, id, record, eventId = 'event-1') {
    const before = { ...DRIVER, status: 'New', ...record };
    const after = { ...before, status: 'Contact Attempt 1' };
    return {
        id: eventId,
        params: { companyId: 'co-1', [collection === 'applications' ? 'applicationId' : 'leadId']: id },
        data: {
            before: { data: () => before },
            after: { data: () => after, ref: mockRef(`${COMPANY}/${collection}/${id}`) },
        },
    };
}
const application = (record, eventId) => onApplicationAtsContactSms(moved('applications', 'app-1', record, eventId));
const lead = (record, eventId) => onLeadAtsContactSms(moved('leads', 'lead-1', record, eventId));

/** The activity log entries written under a record. */
function entries(collection, id) {
    const prefix = `${COMPANY}/${collection}/${id}/activity_logs/`;
    return [...mockDocs].filter(([path]) => path.startsWith(prefix)).map(([, data]) => data);
}
const applicationEntries = () => entries('applications', 'app-1');
const leadEntries = () => entries('leads', 'lead-1');

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSendSMS.mockResolvedValue(undefined);
    mockDocs.clear();
    mockDocs.set(`${COMPANY}/settings/automated_sms`, { templateContactAttempt1: 'Hi {driver name}, this is {user name}.' });
});

describe('an application', () => {
    it('is texted when the driver said "Yes" to SMS, and its history says it was sent', async () => {
        await application({ 'sms-consent': 'yes' });

        expect(mockSendSMS).toHaveBeenCalledWith(PHONE, 'Hi Bob Driver, this is Sam Rivera.', 'recruiter-1');
        expect(applicationEntries()).toEqual([{
            action: 'Automated SMS',
            details: 'Automatic Contact Attempt 1 text sent.',
            type: 'system',
            smsOutcome: 'sent',
            companyId: 'co-1',
            timestamp: 'SERVER_TIME',
        }]);
    });

    it('is not texted when the driver said "No", or did not answer, and its history says why', async () => {
        for (const answer of [{ 'sms-consent': 'no' }, {}, { 'sms-consent': '' }]) {
            mockDocs.forEach((_data, path) => { if (path.includes('/activity_logs/')) mockDocs.delete(path); });
            await application(answer);

            expect(applicationEntries()).toEqual([expect.objectContaining({
                action: 'Automated SMS',
                details: 'Automatic Contact Attempt 1 text not sent: the driver did not agree to SMS.',
                type: 'system',
                smsOutcome: 'skipped_no_consent',
            })]);
        }
        expect(mockSendSMS).not.toHaveBeenCalled();
    });

    it("is not texted at a number that opted out, on the company's list or the global one", async () => {
        for (const list of [`${COMPANY}/blacklist/${PHONE}`, `blacklist/${PHONE}`]) {
            mockDocs.forEach((_data, path) => { if (path.includes('/activity_logs/') || path.includes('blacklist/')) mockDocs.delete(path); });
            mockDocs.set(list, { reason: 'STOP keyword' });
            await application({ 'sms-consent': 'yes' });

            expect(applicationEntries()).toEqual([expect.objectContaining({
                details: 'Automatic Contact Attempt 1 text not sent: this number opted out of texts.',
                smsOutcome: 'skipped_opt_out',
            })]);
        }
        expect(mockSendSMS).not.toHaveBeenCalled();
    });

    it('records one entry when the same change is delivered twice', async () => {
        await application({ 'sms-consent': 'no' }, 'event-7');
        await application({ 'sms-consent': 'no' }, 'event-7');

        expect(applicationEntries()).toHaveLength(1);
        expect(mockDocs.has(`${COMPANY}/applications/app-1/activity_logs/auto_sms_event-7`)).toBe(true);
    });
});

describe('a lead', () => {
    it('is texted although nobody asked it about SMS', async () => {
        await lead({});

        expect(mockSendSMS).toHaveBeenCalledWith(PHONE, 'Hi Bob Driver, this is Sam Rivera.', 'recruiter-1');
        expect(leadEntries()).toEqual([expect.objectContaining({ action: 'Automated SMS', smsOutcome: 'sent' })]);
    });

    it('is not texted at a number that opted out', async () => {
        mockDocs.set(`blacklist/${PHONE}`, { reason: 'Opt-out via company co-2' });
        await lead({});

        expect(mockSendSMS).not.toHaveBeenCalled();
        expect(leadEntries()).toEqual([expect.objectContaining({ smsOutcome: 'skipped_opt_out' })]);
    });

    it('is not texted without a usable number, and its history says so', async () => {
        await lead({ phone: 'n/a' });

        expect(mockSendSMS).not.toHaveBeenCalled();
        expect(leadEntries()).toEqual([expect.objectContaining({
            details: 'Automatic Contact Attempt 1 text not sent: there is no usable phone number.',
            smsOutcome: 'skipped_no_phone',
        })]);
    });
});

describe('a text that does not go out', () => {
    it('is recorded as failed, without the message, the number or the provider error', async () => {
        mockSendSMS.mockRejectedValue(new Error(`Line refused ${PHONE}`));
        await lead({});

        const [entry] = leadEntries();
        expect(entry).toEqual(expect.objectContaining({ details: 'Automatic Contact Attempt 1 text failed to send.', smsOutcome: 'failed' }));
        expect(JSON.stringify(entry)).not.toMatch(/555|Hi Bob|Line refused/);
    });

    it('says it may have gone out when the SMS provider never answered', async () => {
        mockSendSMS.mockRejectedValue(BaseAdapter.sendUnconfirmedError('RingCentral', 20));
        await lead({});

        expect(leadEntries()).toEqual([expect.objectContaining({
            details: 'Automatic Contact Attempt 1 text may have gone out: the SMS provider did not answer, so it was not sent again.',
            smsOutcome: 'failed',
        })]);
    });

    it('is not a text at all when the company set no message for the stage: nothing is sent or recorded', async () => {
        mockDocs.delete(`${COMPANY}/settings/automated_sms`);
        await application({ 'sms-consent': 'yes' });
        await lead({});

        expect(mockSendSMS).not.toHaveBeenCalled();
        expect([...applicationEntries(), ...leadEntries()]).toEqual([]);
    });
});

it('no entry holds the message or the number', async () => {
    await application({ 'sms-consent': 'yes' });
    await lead({});

    for (const entry of [...applicationEntries(), ...leadEntries()]) {
        expect(JSON.stringify(entry)).not.toMatch(/555|Hi Bob/);
    }
});
