// An email campaign sent through a company's connected Gmail. The from address
// is the one the sender setup chose (`emailFrom`), not read off an SMTP
// connection. When Gmail refuses an email for its sending limit, or because
// the connection needs reconnecting, the rest would fail the same way: the
// campaign stops at that email and is paused with the reason
// (`pauseReason`), and the admin resumes it. Any other failure fails that
// recipient only. The SMS provider's pause says its own reason. All data is
// artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const { GmailSendError } = require('../../shared/gmail/sendErrors');
const BaseAdapter = require('../../integrations/adapters/BaseAdapter');

const mockSendMail = jest.fn();
const mockSendSMSWithReceipt = jest.fn();
const mockEnqueueWorker = jest.fn();
const mockSetupSender = jest.fn();
const mockState = {};

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

function mockApplySessionWrite(data) {
  mockState.sessionWrites.push(data);
  const { session } = mockState;
  for (const [field, value] of Object.entries(data)) {
    if (field.startsWith('progress.')) {
      const key = field.slice('progress.'.length);
      const step = value?.increment;
      session.progress[key] = typeof step === 'number' ? (session.progress[key] || 0) + step : value;
    } else if (field !== 'lastUpdateAt') {
      session[field] = value;
    }
  }
}

jest.mock('../../firebaseAdmin', () => {
  const session = {
    __type: 'session',
    get: async () => mockSnap(mockState.session),
    update: async (data) => mockApplySessionWrite(data),
    collection: () => ({
      doc: (id) => ({ __type: 'log', id, get: async () => mockSnap(mockState.logs[id]) }),
    }),
  };
  const companyCollections = {
    bulk_sessions: { doc: () => session },
    leads: { doc: (id) => ({ get: async () => mockSnap(mockState.leads[id]), update: async () => {} }) },
  };
  const db = {
    runTransaction: async (callback) => callback({
      get: async (ref) => {
        if (ref?.__type === 'session') return mockSnap(mockState.session);
        if (ref?.__type === 'log') return mockSnap(mockState.logs[ref.id]);
        return mockSnap(undefined);
      },
      update: (ref, data) => { if (ref?.__type === 'session') mockApplySessionWrite(data); },
      set: (ref, data) => { if (ref?.__type === 'log') mockState.logs[ref.id] = data; },
    }),
    collection: (name) => {
      if (name === 'companies') {
        return {
          doc: () => ({
            get: async () => mockSnap({ companyName: 'Artificial Freight LLC' }),
            collection: (sub) => companyCollections[sub] || { doc: (id) => ({ id, set: async () => {} }) },
          }),
        };
      }
      return { doc: (id) => ({ id, get: async () => mockSnap(undefined), set: async () => {} }) };
    },
  };
  const admin = {
    firestore: { FieldValue: { serverTimestamp: () => 'server-time', increment: (n) => ({ increment: n }) } },
    auth: () => ({ getUser: async () => ({ displayName: null }) }),
  };
  return { admin, db };
});

jest.mock('firebase-functions/v2/https', () => ({ onRequest: (opts, handler) => handler }));
jest.mock('../../blacklist', () => ({ isBlacklisted: async () => false }));
jest.mock('../../bulkActions/workers/senderSetup', () => ({ setupSender: (...args) => mockSetupSender(...args) }));
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));
jest.mock('../../bulkActions/delivery/deliveryQueue', () => ({ queueDeliveryCheck: async () => {} }));
jest.mock('../../bulkActions/workers/sendPacing', () => ({
  ...jest.requireActual('../../bulkActions/workers/sendPacing'),
  pauseBeforeNextSend: async () => {},
}));

const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');

const emailOf = (n) => `driver${n}@example.test`;

/** An active campaign to `count` leads, none of them messaged yet. */
function startSession(count, method = 'email') {
  const ids = Array.from({ length: count }, (_, i) => `lead-${i + 1}`);
  mockState.session = {
    status: 'active',
    config: { method, message: 'Hi [Driver Name]', subject: 'News from [Company Name]' },
    leadSourceType: 'leads',
    createdBy: 'recruiter-1',
    targetIds: ids,
    progress: { currentPointer: 0, processedCount: 0, totalCount: count },
    workerGeneration: 1,
  };
  mockState.leads = Object.fromEntries(ids.map((id, i) => [id, { firstName: `Driver${i + 1}`, email: emailOf(i + 1), phone: `(555) 000-000${i + 1}` }]));
}

async function runWorker() {
  const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
  await processBulkBatch({
    headers: { 'x-safehaul-internal-auth': 'unit-test-secret' },
    body: { companyId: 'co-1', sessionId: 'session-1', workerGeneration: 1 },
  }, res);
  return res;
}

const sentTo = () => mockSendMail.mock.calls.map(([mail]) => mail.to);

beforeEach(() => {
  jest.resetAllMocks();
  Object.assign(mockState, { logs: {}, sessionWrites: [] });
  mockEnqueueWorker.mockResolvedValue(true);
  mockSendMail.mockResolvedValue({ messageId: '<artificial@example.test>' });
  mockSendSMSWithReceipt.mockResolvedValue({ providerMessageId: '1', providerStatus: 'Queued' });
  mockSetupSender.mockImplementation(async ({ config }) => (config.method === 'sms'
    ? { adapter: { sendSMSWithReceipt: mockSendSMSWithReceipt }, emailTransporter: null, emailFrom: null, failed: null }
    : { adapter: null, emailTransporter: { sendMail: mockSendMail }, emailFrom: 'hiring@example.test', failed: null }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('sends from the address the sender setup chose, with the company name', async () => {
  startSession(1);

  await runWorker();

  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
    from: '"Artificial Freight LLC" <hiring@example.test>',
    to: emailOf(1),
    subject: 'News from Artificial Freight LLC',
  }));
  expect(mockState.session.status).toBe('completed');
});

describe.each([
  ['GMAIL_RATE_LIMITED', 'gmail_limit', "Stopped: Gmail's sending limit was reached."],
  ['GMAIL_RECONNECT_NEEDED', 'gmail_reconnect', 'Stopped: Gmail needs reconnecting.'],
])('Gmail refusing an email with %s', (code, pauseReason, answer) => {
  it('stops at that email and pauses the campaign with its reason, with no next batch', async () => {
    startSession(4);
    mockSendMail
      .mockResolvedValueOnce({ messageId: '<1@example.test>' })
      .mockRejectedValueOnce(new GmailSendError(code));

    const res = await runWorker();

    expect(sentTo()).toEqual([emailOf(1), emailOf(2)]);
    expect(mockState.logs['lead-1']).toMatchObject({ status: 'delivered' });
    expect(mockState.logs['lead-2']).toMatchObject({ status: 'failed', error: new GmailSendError(code).message });
    expect(mockState.logs).not.toHaveProperty('lead-3');
    expect(mockState.session).toMatchObject({ status: 'paused', pauseReason });
    expect(mockState.session.progress.currentPointer).toBe(2);
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(answer);
  });

  it('completes instead when it was the last recipient', async () => {
    startSession(2);
    mockSendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new GmailSendError(code));

    await runWorker();

    expect(mockState.session.status).toBe('completed');
    expect(mockState.session).not.toHaveProperty('pauseReason');
  });

  it('never undoes a cancel made while that email was sent', async () => {
    startSession(4);
    mockSendMail.mockImplementation(async () => {
      mockState.session.status = 'cancelled';
      throw new GmailSendError(code);
    });

    await runWorker();

    expect(mockState.session.status).toBe('cancelled');
    expect(mockState.session).not.toHaveProperty('pauseReason');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });
});

it.each(['GMAIL_REJECTED', 'GMAIL_FAILED', 'GMAIL_UNAVAILABLE'])('fails only that recipient for %s, and carries on', async (code) => {
  startSession(3);
  mockSendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new GmailSendError(code));

  await runWorker();

  expect(sentTo()).toEqual([emailOf(1), emailOf(2), emailOf(3)]);
  expect(mockState.logs['lead-2']).toMatchObject({ status: 'failed', error: new GmailSendError(code).message });
  expect(mockState.session.status).toBe('completed');
});

it('pauses for a silent SMS provider with that reason', async () => {
  startSession(4, 'sms');
  mockSendSMSWithReceipt.mockRejectedValue(BaseAdapter.sendUnconfirmedError('RingCentral', 20));

  const res = await runWorker();

  expect(mockState.session).toMatchObject({ status: 'paused', pauseReason: 'sms_silent' });
  expect(res.send).toHaveBeenCalledWith('Stopped: the SMS provider did not answer 3 texts.');
});
