// A campaign text the SMS provider never answered may still have reached the
// driver. Its log says so (`sendUnconfirmed`), a batch starts no send once its
// 270-second window is used (the next batch carries on from the stored pointer),
// and three such texts with no sent text between them pause the campaign, also
// when they span two batches. Nothing is ever sent twice. All data is artificial.

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const BaseAdapter = require('../../integrations/adapters/BaseAdapter');

const mockSendSMSWithReceipt = jest.fn();
const mockEnqueueWorker = jest.fn();
const mockQueueDeliveryCheck = jest.fn();
const mockState = {};

const mockSnap = (data) => ({ exists: data !== undefined, data: () => data });

/** Records a session write and applies the fields these tests read, as Firestore would. */
function mockApplySessionWrite(data) {
  mockState.sessionWrites.push(data);
  const { session } = mockState;
  if (data.status) session.status = data.status;
  const pointerStep = data['progress.currentPointer']?.increment;
  if (pointerStep) session.progress.currentPointer = (session.progress.currentPointer || 0) + pointerStep;
  if ('progress.unconfirmedInARow' in data) session.progress.unconfirmedInARow = data['progress.unconfirmedInARow'];
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
    runTransaction: async (callback) => {
      mockState.transactions += 1;
      if (mockState.beforeTransaction) mockState.beforeTransaction(mockState.transactions);
      return callback({
        get: async (ref) => {
          if (ref?.__type === 'session') return mockSnap(mockState.session);
          if (ref?.__type === 'log') return mockSnap(mockState.logs[ref.id]);
          return mockSnap(undefined);
        },
        update: (ref, data) => {
          if (ref?.__type !== 'session') return;
          if (data.status === 'paused' && mockState.failPause) throw new Error('Firestore unavailable');
          mockApplySessionWrite(data);
        },
        set: (ref, data) => { if (ref?.__type === 'log') mockState.logs[ref.id] = data; },
      });
    },
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
jest.mock('../../bulkActions/services/queueService', () => ({
  enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));
jest.mock('../../bulkActions/delivery/deliveryQueue', () => ({
  queueDeliveryCheck: (...args) => mockQueueDeliveryCheck(...args),
}));
jest.mock('../../bulkActions/workers/sendPacing', () => ({
  ...jest.requireActual('../../bulkActions/workers/sendPacing'),
  pauseBeforeNextSend: async () => {},
}));

const { processBulkBatch } = require('../../bulkActions/workers/batchWorker');

const accepted = { providerMessageId: '402406986008', providerStatus: 'Queued' };
const unconfirmed = () => BaseAdapter.sendUnconfirmedError('RingCentral', 20);
const phoneOf = (n) => `(555) 000-000${n}`;

/** An active SMS campaign to `count` leads, none of them messaged yet. */
function startSession(count, progress = {}) {
  const ids = Array.from({ length: count }, (_, i) => `lead-${i + 1}`);
  mockState.session = {
    status: 'active',
    config: { method: 'sms', message: 'Hi [Driver Name]' },
    leadSourceType: 'leads',
    createdBy: 'recruiter-1',
    targetIds: ids,
    progress: { currentPointer: 0, processedCount: 0, totalCount: count, ...progress },
    workerGeneration: 1,
  };
  mockState.leads = Object.fromEntries(ids.map((id, i) => [id, { firstName: `Driver${i + 1}`, phone: phoneOf(i + 1) }]));
}

/** One run of the batch worker, as Cloud Tasks would call it. */
async function runWorker() {
  const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
  await processBulkBatch({
    headers: { 'x-safehaul-internal-auth': 'unit-test-secret' },
    body: { companyId: 'co-1', sessionId: 'session-1', workerGeneration: 1 },
  }, res);
  return res;
}

const sentTo = () => mockSendSMSWithReceipt.mock.calls.map(([to]) => to);
const pauseWrites = () => mockState.sessionWrites.filter((write) => write.status === 'paused');

beforeEach(() => {
  jest.resetAllMocks();
  mockEnqueueWorker.mockResolvedValue(true);
  mockQueueDeliveryCheck.mockResolvedValue(undefined);
  mockSendSMSWithReceipt.mockResolvedValue(accepted);
  Object.assign(mockState, { logs: {}, sessionWrites: [], transactions: 0, beforeTransaction: null, failPause: false });
  mockState.adapter = { ensureLoggedIn: async () => true, sendSMSWithReceipt: mockSendSMSWithReceipt };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the log of a text the provider never answered', () => {
  it('stays a failure and says the text may have gone out', async () => {
    startSession(1);
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());

    await runWorker();

    expect(mockState.logs['lead-1']).toMatchObject({
      status: 'failed',
      isSuccess: false,
      error: unconfirmed().message,
      sendUnconfirmed: true,
    });
    expect(mockState.logs['lead-1']).not.toHaveProperty('delivery');
    expect(mockState.session.progress.unconfirmedInARow).toBe(1);
  });

  it('says the same for a line that sends without a receipt, as 8x8 does', async () => {
    startSession(1);
    const mockSendSMS = jest.fn(async () => { throw BaseAdapter.sendUnconfirmedError('8x8', 20); });
    mockState.adapter = { sendSMS: mockSendSMS };

    await runWorker();

    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(mockState.logs['lead-1']).toMatchObject({
      status: 'failed',
      isSuccess: false,
      error: BaseAdapter.sendUnconfirmedError('8x8', 20).message,
      sendUnconfirmed: true,
    });
  });

  it('is unchanged for an ordinary failure, which neither counts nor resets the run', async () => {
    startSession(1, { unconfirmedInARow: 2 });
    mockSendSMSWithReceipt.mockRejectedValue(new Error('Invalid number'));

    await runWorker();

    expect(mockState.logs['lead-1']).toMatchObject({ status: 'failed', isSuccess: false, error: 'Invalid number' });
    expect(mockState.logs['lead-1']).not.toHaveProperty('sendUnconfirmed');
    expect(mockState.sessionWrites.some((write) => 'progress.unconfirmedInARow' in write)).toBe(false);
    expect(mockState.session.progress.unconfirmedInARow).toBe(2);
  });
});

describe('the send window', () => {
  it('starts no send once 270 seconds are used, and the next batch carries on from the right recipient', async () => {
    startSession(2);
    let mockNow = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
    mockSendSMSWithReceipt.mockImplementation(async () => {
      mockNow += 271000;
      return accepted;
    });

    const res = await runWorker();

    expect(sentTo()).toEqual([phoneOf(1)]);
    expect(Object.keys(mockState.logs)).toEqual(['lead-1']);
    expect(mockState.session.progress.currentPointer).toBe(1);
    expect(mockState.session.status).toBe('active');
    expect(mockEnqueueWorker).toHaveBeenCalledWith('co-1', 'session-1', 1, 1);
    expect(res.status).toHaveBeenCalledWith(200);

    await runWorker();

    expect(sentTo()).toEqual([phoneOf(1), phoneOf(2)]);
    expect(Object.keys(mockState.logs)).toEqual(['lead-1', 'lead-2']);
    expect(mockState.session.status).toBe('completed');
    expect(mockEnqueueWorker).toHaveBeenCalledTimes(1);
  });
});

describe('a provider that does not answer three texts in a row', () => {
  it('pauses the campaign after the third, with no next batch and no fourth send', async () => {
    startSession(4);
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());

    const res = await runWorker();

    expect(sentTo()).toEqual([phoneOf(1), phoneOf(2), phoneOf(3)]);
    expect(mockState.session.status).toBe('paused');
    expect(mockState.session.progress.unconfirmedInARow).toBe(3);
    expect(mockState.session.progress.currentPointer).toBe(3);
    expect(mockState.logs).not.toHaveProperty('lead-4');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('Stopped: the SMS provider did not answer 3 texts.');
  });

  it('does not pause when a sent text comes between them', async () => {
    startSession(4);
    mockSendSMSWithReceipt
      .mockRejectedValueOnce(unconfirmed())
      .mockResolvedValueOnce(accepted)
      .mockRejectedValueOnce(unconfirmed())
      .mockRejectedValueOnce(unconfirmed());

    await runWorker();

    expect(sentTo()).toHaveLength(4);
    expect(pauseWrites()).toEqual([]);
    expect(mockState.session.status).toBe('completed');
    expect(mockState.session.progress.unconfirmedInARow).toBe(2);
  });

  it('still pauses when an ordinary failure comes between them, which neither counts nor resets the run', async () => {
    startSession(5);
    mockSendSMSWithReceipt
      .mockRejectedValueOnce(unconfirmed())
      .mockRejectedValueOnce(new Error('Invalid number'))
      .mockRejectedValueOnce(unconfirmed())
      .mockRejectedValueOnce(unconfirmed());

    await runWorker();

    expect(sentTo()).toEqual([phoneOf(1), phoneOf(2), phoneOf(3), phoneOf(4)]);
    expect(mockState.session.status).toBe('paused');
    expect(mockState.session.progress.unconfirmedInARow).toBe(3);
    expect(mockState.logs).not.toHaveProperty('lead-5');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('never undoes a cancel made during the third send', async () => {
    startSession(4);
    mockSendSMSWithReceipt.mockImplementation(async () => {
      if (mockSendSMSWithReceipt.mock.calls.length === 3) mockState.session.status = 'cancelled';
      throw unconfirmed();
    });

    await runWorker();

    expect(sentTo()).toHaveLength(3);
    expect(mockState.session.status).toBe('cancelled');
    expect(pauseWrites()).toEqual([]);
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('never undoes a cancel that lands while the pause is written', async () => {
    startSession(4);
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());
    // Transaction 1 claims the batch and 2-4 log the three sends: the fifth is the pause.
    mockState.beforeTransaction = (n) => {
      if (n === 5) mockState.session.status = 'cancelled';
    };

    await runWorker();

    expect(sentTo()).toHaveLength(3);
    expect(mockState.session.status).toBe('cancelled');
    expect(pauseWrites()).toEqual([]);
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('leaves a campaign a newer Resume took over to its new worker', async () => {
    startSession(4);
    mockSendSMSWithReceipt.mockImplementation(async () => {
      if (mockSendSMSWithReceipt.mock.calls.length === 3) mockState.session.workerGeneration = 2;
      throw unconfirmed();
    });

    await runWorker();

    expect(sentTo()).toHaveLength(3);
    expect(mockState.session.status).toBe('active');
    expect(pauseWrites()).toEqual([]);
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('counts across batches: two in the first batch and one in the next pause the campaign', async () => {
    startSession(4);
    let mockNow = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
    mockSendSMSWithReceipt.mockImplementation(async () => {
      mockNow += 136000;
      throw unconfirmed();
    });

    await runWorker();

    expect(sentTo()).toEqual([phoneOf(1), phoneOf(2)]);
    expect(mockState.session.progress.unconfirmedInARow).toBe(2);
    expect(mockState.session.status).toBe('active');
    expect(mockEnqueueWorker).toHaveBeenCalledTimes(1);

    await runWorker();

    expect(sentTo()).toEqual([phoneOf(1), phoneOf(2), phoneOf(3)]);
    expect(mockState.session.status).toBe('paused');
    expect(mockState.logs).not.toHaveProperty('lead-4');
    expect(mockEnqueueWorker).toHaveBeenCalledTimes(1);
  });

  it('pauses again on the next unanswered text after a Resume', async () => {
    // As Resume leaves it: three sent to, the run of three kept.
    startSession(5, { currentPointer: 3, processedCount: 3, unconfirmedInARow: 3 });
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());

    await runWorker();

    expect(sentTo()).toEqual([phoneOf(4)]);
    expect(mockState.session.status).toBe('paused');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });

  it('enqueues no next batch when the pause cannot be written, and answers 200 so the task is not run again', async () => {
    startSession(4);
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());
    mockState.failPause = true;

    const res = await runWorker();

    expect(sentTo()).toHaveLength(3);
    expect(mockState.session.status).toBe('active');
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('stays active with no next batch'),
      'Firestore unavailable',
    );
  });

  it('completes the campaign when the third was its last recipient', async () => {
    startSession(3);
    mockSendSMSWithReceipt.mockRejectedValue(unconfirmed());

    await runWorker();

    expect(sentTo()).toHaveLength(3);
    expect(mockState.session.status).toBe('completed');
    expect(pauseWrites()).toEqual([]);
    expect(mockEnqueueWorker).not.toHaveBeenCalled();
  });
});
