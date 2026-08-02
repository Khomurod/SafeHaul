// Hardening guard: enqueueWorker must fail-closed when BULK_WORKER_SECRET is unset.
// Enqueuing a task without the shared secret would burn a Cloud Tasks slot on a
// request the worker is guaranteed to reject (403), masking the real config error.

const mockCreateTask = jest.fn().mockResolvedValue([{ name: 'task-1' }]);
const mockQueuePath = jest.fn(() => 'projects/p/locations/l/queues/bulk-actions-queue');

jest.mock('@google-cloud/tasks', () => ({
    CloudTasksClient: jest.fn().mockImplementation(() => ({
        createTask: mockCreateTask,
        queuePath: mockQueuePath,
    })),
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: {
        apps: [],
        firestore: { FieldValue: { serverTimestamp: () => '__ts' } },
    },
    db: { collection: jest.fn() },
}));

describe('enqueueWorker fail-closed on missing BULK_WORKER_SECRET', () => {
    const ORIGINAL_SECRET = process.env.BULK_WORKER_SECRET;

    beforeEach(() => {
        jest.clearAllMocks();
        // The recursion URL must be resolvable so the only failure under test is the secret.
        process.env.PROCESS_BULK_BATCH_URL = 'https://example.test/processBulkBatch';
    });

    afterEach(() => {
        if (ORIGINAL_SECRET === undefined) delete process.env.BULK_WORKER_SECRET;
        else process.env.BULK_WORKER_SECRET = ORIGINAL_SECRET;
    });

    it('throws and never creates a task when the secret is missing', async () => {
        delete process.env.BULK_WORKER_SECRET;
        const { enqueueWorker } = require('../../bulkActions/services/queueService');

        await expect(enqueueWorker('co1', 'sess1', 0)).rejects.toThrow(/BULK_WORKER_SECRET/);
        expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('injects the secret into the auth header when it is present', async () => {
        process.env.BULK_WORKER_SECRET = 'unit-secret';
        const { enqueueWorker } = require('../../bulkActions/services/queueService');

        await enqueueWorker('co1', 'sess1', 0);

        expect(mockCreateTask).toHaveBeenCalledTimes(1);
        const { task } = mockCreateTask.mock.calls[0][0];
        expect(task.httpRequest.headers['X-SafeHaul-Internal-Auth']).toBe('unit-secret');
    });
});
