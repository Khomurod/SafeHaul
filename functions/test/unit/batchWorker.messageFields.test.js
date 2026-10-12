// What a campaign's placeholders become. Companies store their name as
// `companyName`; the worker read `name`, so every message said "undefined" for
// [Company Name], and the email went out from "undefined" with the subject
// "Update from undefined". [Recruiter Name] read a config field nothing writes,
// so it always said "your recruiter", and a subject kept its placeholders as
// typed. All data is artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const mockSendSMS = jest.fn();
const mockSendMail = jest.fn();
const mockState = {};

const mockSession = () => ({
  __type: 'session',
  get: async () => ({ exists: true, data: () => mockState.session }),
  update: async () => {},
  collection: () => ({
    doc: (id) => ({ __type: 'log', id, get: async () => ({ exists: false }), set: async () => {} }),
  }),
});

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

jest.mock('../../firebaseAdmin', () => {
  const session = mockSession();
  const companyCollections = {
    bulk_sessions: { doc: () => session },
    leads: {
      doc: () => ({
        get: async () => mockSnap({ firstName: 'Alice', phone: '(555) 123-4567', email: 'alice@example.com' }),
        update: async () => {},
      }),
    },
    system_settings: { doc: () => ({ get: async () => mockSnap({ smtpUser: 'hiring@example.com', smtpPass: 'artificial' }) }) },
  };
  const db = {
    runTransaction: async (callback) => callback({
      get: async (ref) => (ref?.__type === 'session' ? mockSnap(mockState.session) : mockSnap(undefined)),
      update: () => {},
      set: () => {},
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
      if (name === 'users') return { doc: () => ({ get: async () => mockSnap(mockState.sender) }) };
      return { doc: (id) => ({ id, get: async () => mockSnap(undefined), set: async () => {} }) };
    },
  };
  const admin = {
    firestore: { FieldValue: { serverTimestamp: () => 'server-time', increment: (n) => ({ increment: n }) } },
    auth: () => ({ getUser: async () => ({ displayName: mockState.authName || null }) }),
  };
  return { admin, db };
});

jest.mock('firebase-functions/v2/https', () => ({ onRequest: (opts, handler) => handler }));
jest.mock('../../blacklist', () => ({ isBlacklisted: async () => false }));
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

const MESSAGE = 'Hi [Driver Name], [Recruiter Name] at [Company Name] here.';

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
  mockSendMail.mockResolvedValue({});
  mockState.company = { companyName: 'Artificial Freight LLC' };
  mockState.sender = { name: 'Dana Recruiter' };
  mockState.authName = null;
});

describe('campaign placeholders', () => {
  it('an SMS names the company and the recruiter who launched the campaign', async () => {
    await runBatch({ method: 'sms', message: MESSAGE });

    expect(mockSendSMS).toHaveBeenCalledWith(
      '(555) 123-4567',
      'Hi Alice, Dana Recruiter at Artificial Freight LLC here.',
      'recruiter-1',
    );
  });

  it('an email comes from the company, with its name in the subject', async () => {
    await runBatch({ method: 'email', message: MESSAGE });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: '"Artificial Freight LLC" <hiring@example.com>',
      to: 'alice@example.com',
      subject: 'Update from Artificial Freight LLC',
      text: 'Hi Alice, Dana Recruiter at Artificial Freight LLC here.',
    }));
  });

  it('fills the placeholders the composer offers in an email subject', async () => {
    await runBatch({ method: 'email', message: MESSAGE, subject: '[Recruiter Name] from [Company Name]' });

    expect(mockSendMail.mock.calls[0][0].subject).toBe('Dana Recruiter from Artificial Freight LLC');
  });

  it('writes a name holding "$&" as it is', async () => {
    mockState.company = { companyName: 'R$&D Haulers' };

    await runBatch({ method: 'sms', message: MESSAGE });

    expect(mockSendSMS.mock.calls[0][1]).toBe('Hi Alice, Dana Recruiter at R$&D Haulers here.');
  });

  it('takes the recruiter name from the sign-in account when the profile has none', async () => {
    mockState.sender = { email: 'dana@example.com' };
    mockState.authName = 'Dana From Auth';

    await runBatch({ method: 'sms', message: MESSAGE });

    expect(mockSendSMS.mock.calls[0][1]).toBe('Hi Alice, Dana From Auth at Artificial Freight LLC here.');
  });

  it('still sends, with the old wording, when no name can be found', async () => {
    mockState.company = {};
    mockState.sender = undefined;

    await runBatch({ method: 'sms', message: MESSAGE });

    expect(mockSendSMS.mock.calls[0][1]).toBe('Hi Alice, your recruiter at SafeHaul Company here.');
  });
});
