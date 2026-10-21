/**
 * A call logged with a callback time puts "Call back …" in the bell of the
 * recruiter who logged it, for an application or a lead. All names are
 * artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

const mockRecords = new Map();
const mockWrites = [];
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => ({ exists: mockRecords.has(path), data: () => mockRecords.get(path) }),
        set: async (data) => { mockWrites.push({ path, data }); },
    });
    const colRef = (path) => ({ doc: (id) => docRef(`${path}/${id || `auto-${mockWrites.length}`}`) });
    return { db: { collection: (name) => colRef(name) } };
});
jest.mock('../../emailService', () => ({ sendDynamicEmail: jest.fn() }));

const { onCallbackScheduled, onLeadCallbackScheduled } = require('../../notificationTriggers');

const logEvent = (params, log) => ({ params: { companyId: 'co1', ...params }, data: { data: () => log } });
const notifications = () => mockWrites.filter(({ path }) => path.startsWith('companies/co1/notifications/'));

beforeEach(() => {
    mockRecords.clear();
    mockWrites.length = 0;
    mockRecords.set('companies/co1/applications/app1', { firstName: 'Ivan', lastName: 'Petrov' });
    mockRecords.set('companies/co1/leads/lead1', { fullName: 'Olga Smirnova' });
});

const NEW_LOG = {
    outcome: 'callback',
    callbackAt: '2026-10-22T20:00:00.000Z',
    callbackLabel: 'Oct 22 at 3:00 PM',
    performedBy: 'recruiter-1',
    performedByName: 'Rita Recruiter',
};

it('reminds the recruiter who logged it, with the time they chose', async () => {
    await onCallbackScheduled(logEvent({ appId: 'app1' }, NEW_LOG));
    expect(notifications()).toEqual([{
        path: expect.any(String),
        data: expect.objectContaining({
            type: 'callback_scheduled',
            title: 'Call back',
            message: 'Call back Ivan Petrov, Oct 22 at 3:00 PM',
            recipientId: 'recruiter-1',
            callbackAt: '2026-10-22T20:00:00.000Z',
            relatedId: 'app1',
            relatedType: 'application',
            read: false,
        }),
    }]);
});

it('reminds for a lead, and for an hour reminder after No Answer', async () => {
    await onLeadCallbackScheduled(logEvent({ leadId: 'lead1' }, { ...NEW_LOG, outcome: 'no_answer' }));
    expect(notifications()[0].data).toMatchObject({
        message: 'Call back Olga Smirnova, Oct 22 at 3:00 PM',
        recipientId: 'recruiter-1',
        relatedType: 'lead',
    });
});

it('stays a team notification for a callback logged without a time', async () => {
    // As an older screen logs it.
    await onCallbackScheduled(logEvent({ appId: 'app1' }, { outcome: 'callback', performedBy: 'recruiter-1' }));
    expect(notifications()[0].data).toMatchObject({ message: 'Call back Ivan Petrov', title: 'Call back' });
    expect(notifications()[0].data).not.toHaveProperty('recipientId');
});

it('writes nothing for a call without a callback', async () => {
    await onCallbackScheduled(logEvent({ appId: 'app1' }, { outcome: 'no_answer', performedBy: 'recruiter-1' }));
    await onLeadCallbackScheduled(logEvent({ leadId: 'lead1' }, { outcome: 'interested' }));
    expect(notifications()).toEqual([]);
});

it('takes the time as plain text', async () => {
    await onCallbackScheduled(logEvent({ appId: 'app1' }, { ...NEW_LOG, callbackLabel: `see https://evil.example ${'x'.repeat(200)}` }));
    const { message } = notifications()[0].data;
    expect(message).not.toContain('https://');
    // 40 characters, then "…".
    expect(Array.from(message).length).toBeLessThanOrEqual('Call back Ivan Petrov, '.length + 41);
});
