// Who a campaign message reaches when somebody has opted out. An opt-out is
// stored under a phone number (a STOP reply, `blacklist.js`), and the send loop
// asks the real `isBlacklisted` before every message. Every other bulk-send
// suite stands that check in with "never blacklisted". All data is artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const mockSendSMS = jest.fn();
const mockSendMail = jest.fn();
const mockState = {};

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

jest.mock('../../firebaseAdmin', () => {
  const session = {
    __type: 'session',
    get: async () => ({ exists: true, data: () => mockState.session }),
    update: async () => {},
    collection: () => ({
      doc: (id) => ({ __type: 'log', id, get: async () => ({ exists: false }), set: async () => {} }),
    }),
  };
  const companyCollections = {
    bulk_sessions: { doc: () => session },
    leads: { doc: () => ({ get: async () => mockSnap(mockState.lead), update: async () => {} }) },
    system_settings: { doc: () => ({ get: async () => mockSnap({ smtpUser: 'hiring@example.com', smtpPass: 'artificial' }) }) },
    blacklist: { doc: (phone) => ({ get: async () => mockSnap(mockState.companyBlacklist[phone]) }) },
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
            get: async () => mockSnap(mockState.company),
            collection: (sub) => companyCollections[sub] || { doc: (id) => ({ id, set: async () => {} }) },
          }),
        };
      }
      if (name === 'blacklist') return { doc: (phone) => ({ get: async () => mockSnap(mockState.globalBlacklist[phone]) }) };
      if (name === 'users') return { doc: () => ({ get: async () => mockSnap({ name: 'Dana Recruiter' }) }) };
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
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (path, handler) => handler }));
jest.mock('../../integrations/factory', () => ({
  getAdapterForUser: async () => ({ ensureLoggedIn: async () => true, sendSMS: mockSendSMS }),
}));
jest.mock('../../integrations/encryption', () => ({ decrypt: (value) => value }));
jest.mock('../../bulkActions/services/queueService', () => ({ enqueueWorker: async () => true }));
jest.mock('../../bulkActions/workers/sendPacing', () => ({
  ...jest.requireActual('../../bulkActions/workers/sendPacing'),
  pauseBeforeNextSend: async () => {},
}));
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: mockSendMail, transporter: { options: { auth: { user: 'hiring@example.com' } } } }),
}));

const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');

async function runBatch(method, lead) {
  mockState.lead = lead;
  mockState.session = {
    status: 'active',
    config: { method, message: 'Hi [Driver Name].' },
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
  return mockState.logs[0];
}

const OPTED_OUT = { reason: 'STOP keyword' };

beforeEach(() => {
  jest.resetAllMocks();
  mockSendSMS.mockResolvedValue(true);
  mockSendMail.mockResolvedValue({});
  mockState.company = { companyName: 'Artificial Freight LLC' };
  mockState.companyBlacklist = {};
  mockState.globalBlacklist = {};
  mockState.logs = [];
});

describe('an email campaign', () => {
  it('reaches a recipient who has no phone number', async () => {
    const log = await runBatch('email', { firstName: 'Alice', email: 'alice@example.com' });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.com', text: 'Hi Alice.' }));
    expect(log).toEqual(expect.objectContaining({ status: 'delivered', error: null, recipientIdentity: 'alice@example.com' }));
  });

  it('reaches a recipient whose phone is not a usable number', async () => {
    const log = await runBatch('email', { firstName: 'Alice', phone: 'n/a', email: 'alice@example.com' });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(log.status).toBe('delivered');
  });

  it("does not reach a number that opted out, on the company's list or the global one", async () => {
    for (const list of ['companyBlacklist', 'globalBlacklist']) {
      mockState.companyBlacklist = {};
      mockState.globalBlacklist = {};
      mockState.logs = [];
      mockState[list]['+15551234567'] = OPTED_OUT;

      const log = await runBatch('email', { firstName: 'Alice', phone: '(555) 123-4567', email: 'alice@example.com' });

      expect(log).toEqual(expect.objectContaining({ status: 'failed', error: 'Number is blacklisted (Opt-out)' }));
    }
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('an SMS campaign', () => {
  it('reaches a number nobody opted out', async () => {
    const log = await runBatch('sms', { firstName: 'Alice', phone: '(555) 123-4567' });

    expect(mockSendSMS).toHaveBeenCalledWith('(555) 123-4567', 'Hi Alice.', 'recruiter-1');
    expect(log.status).toBe('delivered');
  });

  it("does not reach a number that opted out, written any way, on the company's list or the global one", async () => {
    for (const [list, phone] of [['companyBlacklist', '555-123-4567'], ['globalBlacklist', '+1 (555) 123 4567']]) {
      mockState.companyBlacklist = {};
      mockState.globalBlacklist = {};
      mockState.logs = [];
      mockState[list]['+15551234567'] = OPTED_OUT;

      const log = await runBatch('sms', { firstName: 'Alice', phone });

      expect(log).toEqual(expect.objectContaining({ status: 'failed', error: 'Number is blacklisted (Opt-out)' }));
    }
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it('sends nothing to a recipient without a usable number', async () => {
    for (const lead of [{ firstName: 'Alice', email: 'alice@example.com' }, { firstName: 'Alice', phone: 'n/a' }]) {
      mockState.logs = [];
      const log = await runBatch('sms', lead);

      expect(log.status).toBe('failed');
    }
    expect(mockSendSMS).not.toHaveBeenCalled();
  });
});
