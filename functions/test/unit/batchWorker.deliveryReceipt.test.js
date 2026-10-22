// What a campaign log keeps of an SMS RingCentral accepted: its message id and
// a delivery that is still waiting, so the delivery check can later say whether
// the text arrived. The batch then queues that check. An email, or a send from a
// line that gives no receipt, logs as before. All data is artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const mockSendSMS = jest.fn();
const mockSendSMSWithReceipt = jest.fn();
const mockSendMail = jest.fn();
const mockQueueDeliveryCheck = jest.fn();
const mockState = {};

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

jest.mock('../../firebaseAdmin', () => {
  const session = {
    __type: 'session',
    get: async () => mockSnap(mockState.session),
    update: async () => {},
    collection: () => ({
      doc: (id) => ({ __type: 'log', id, get: async () => ({ exists: false }), set: async () => {} }),
    }),
  };
  const companyCollections = {
    bulk_sessions: { doc: () => session },
    leads: { doc: () => ({ get: async () => mockSnap(mockState.lead), update: async () => {} }) },
    system_settings: { doc: () => ({ get: async () => mockSnap({ smtpUser: 'hiring@example.com', smtpPass: 'artificial' }) }) },
  };
  const db = {
    runTransaction: async (callback) => callback({
      get: async (ref) => (ref?.__type === 'session' ? mockSnap(mockState.session) : mockSnap(undefined)),
      update: () => {},
      set: (ref, data) => { if (ref?.__type === 'log') mockState.logs.push(data); },
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
jest.mock('../../integrations/factory', () => ({ getAdapterForUser: async () => mockState.adapter }));
jest.mock('../../bulkActions/services/queueService', () => ({ enqueueWorker: async () => true }));
jest.mock('../../bulkActions/delivery/deliveryQueue', () => ({
  queueDeliveryCheck: (...args) => mockQueueDeliveryCheck(...args),
}));
jest.mock('../../bulkActions/workers/sendPacing', () => ({
  ...jest.requireActual('../../bulkActions/workers/sendPacing'),
  pauseBeforeNextSend: async () => {},
}));
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: mockSendMail, transporter: { options: { auth: { user: 'hiring@example.com' } } } }),
}));

const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');

async function runBatch(config) {
  mockState.session = {
    status: 'active',
    config,
    leadSourceType: 'leads',
    createdBy: 'recruiter-1',
    targetIds: ['lead-1'],
    progress: { currentPointer: 0, processedCount: 0, totalCount: 1 },
    workerGeneration: 1,
  };
  const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
  await processBulkBatch({
    headers: { 'x-safehaul-internal-auth': 'unit-test-secret', 'x-appengine-queuename': 'bulk-actions-queue' },
    body: { companyId: 'co-1', sessionId: 'session-1', workerGeneration: 1 },
  }, res);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSendSMS.mockResolvedValue(true);
  mockSendSMSWithReceipt.mockResolvedValue({ providerMessageId: '402406986008', providerStatus: 'Queued' });
  mockSendMail.mockResolvedValue({});
  mockQueueDeliveryCheck.mockResolvedValue(undefined);
  mockState.logs = [];
  mockState.lead = { firstName: 'Alice', phone: '(555) 123-4567', email: 'alice@example.com' };
  mockState.adapter = { ensureLoggedIn: async () => true, sendSMS: mockSendSMS, sendSMSWithReceipt: mockSendSMSWithReceipt };
});

it("logs RingCentral's message id with a delivery still waiting, and queues the check", async () => {
  await runBatch({ method: 'sms', message: 'Hi [Driver Name]' });

  expect(mockSendSMSWithReceipt).toHaveBeenCalledWith('(555) 123-4567', 'Hi Alice', 'recruiter-1');
  expect(mockSendSMS).not.toHaveBeenCalled();
  expect(mockState.logs).toEqual([expect.objectContaining({
    status: 'delivered',
    isSuccess: true,
    providerMessageId: '402406986008',
    delivery: { state: 'pending', providerStatus: 'Queued' },
  })]);
  expect(mockQueueDeliveryCheck).toHaveBeenCalledWith('co-1', 'session-1');
});

it('logs a waiting delivery without an id when the line gives no receipt', async () => {
  mockState.adapter = { ensureLoggedIn: async () => true, sendSMS: mockSendSMS };

  await runBatch({ method: 'sms', message: 'Hi [Driver Name]' });

  expect(mockSendSMS).toHaveBeenCalledWith('(555) 123-4567', 'Hi Alice', 'recruiter-1');
  expect(mockState.logs[0]).toMatchObject({ isSuccess: true, delivery: { state: 'pending', providerStatus: null } });
  expect(mockState.logs[0]).not.toHaveProperty('providerMessageId');
});

it('queues no check when no text was accepted', async () => {
  mockSendSMSWithReceipt.mockRejectedValue(new Error('RingCentral Error [InvalidParameter]: bad number'));

  await runBatch({ method: 'sms', message: 'Hi' });

  expect(mockState.logs[0]).toMatchObject({ status: 'failed', isSuccess: false });
  expect(mockState.logs[0]).not.toHaveProperty('delivery');
  expect(mockQueueDeliveryCheck).not.toHaveBeenCalled();
});

it('finishes the batch when the check cannot be queued', async () => {
  mockQueueDeliveryCheck.mockRejectedValue(new Error('unavailable'));
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

  await runBatch({ method: 'sms', message: 'Hi' });

  expect(mockState.logs).toHaveLength(1);
  expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not queue the delivery check'), 'unavailable');
  errors.mockRestore();
});

it('logs an email as before, without a delivery check', async () => {
  await runBatch({ method: 'email', message: 'Hi [Driver Name]' });

  expect(mockState.logs[0]).toMatchObject({ status: 'delivered', isSuccess: true });
  expect(mockState.logs[0]).not.toHaveProperty('delivery');
  expect(mockQueueDeliveryCheck).not.toHaveBeenCalled();
});
