/**
 * A deleted campaign record takes its report with it: the session's logs, and
 * the uploaded rows once no session reads them any more.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeleted: (opts, handler) => handler,
}));

// The sessions left at the company, by id, after the deletion.
const mockSessions = new Map();
const mockRecursiveDelete = jest.fn();
jest.mock('../../firebaseAdmin', () => {
    const sessionsPath = (companyId) => `companies/${companyId}/bulk_sessions`;
    const collection = (path) => ({
        path,
        doc: (id) => ({
            path: `${path}/${id}`,
            collection: (name) => ({ path: `${path}/${id}/${name}` }),
            async get() { return { exists: mockSessions.has(id) }; },
        }),
        where: (field, op, value) => ({
            limit: () => ({
                async get() {
                    const hits = [...mockSessions.values()].filter((session) => session[field] === value);
                    return { empty: hits.length === 0 };
                },
            }),
        }),
    });
    return {
        db: {
            collection: () => ({ doc: (companyId) => ({ collection: () => collection(sessionsPath(companyId)) }) }),
            recursiveDelete: (...args) => mockRecursiveDelete(...args),
        },
    };
});

const { deleteBulkSessionData, __private: { RETRY_WAITS_MS, timing } } = require('../../bulkActions/workers/sessionDeleted');

const SESSIONS = 'companies/co1/bulk_sessions';
const deleted = (sessionId, data = {}) => deleteBulkSessionData({
    params: { companyId: 'co1', sessionId },
    data: { data: () => data },
});
const deletedPaths = () => mockRecursiveDelete.mock.calls.map(([ref]) => ref.path);

const waits = [];
beforeEach(() => {
    jest.resetAllMocks();
    mockSessions.clear();
    mockRecursiveDelete.mockResolvedValue(undefined);
    waits.length = 0;
    timing.wait = jest.fn(async (ms) => { waits.push(ms); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('deleteBulkSessionData', () => {
    it("deletes a deleted campaign's logs and uploaded rows", async () => {
        await deleted('s1');

        expect(deletedPaths()).toEqual([`${SESSIONS}/s1/logs`, `${SESSIONS}/s1/targets`]);
    });

    it('keeps the uploaded rows while a retry still reads them', async () => {
        mockSessions.set('r1', { importSourceSessionId: 's1' });

        await deleted('s1');

        expect(deletedPaths()).toEqual([`${SESSIONS}/s1/logs`]);
    });

    it("leaves a retry's campaign its rows while the campaign is kept", async () => {
        mockSessions.set('s1', {});

        await deleted('r1', { importSourceSessionId: 's1' });

        expect(deletedPaths()).toEqual([`${SESSIONS}/r1/logs`]);
    });

    it('takes the rows of a campaign deleted earlier with the last retry that read them', async () => {
        await deleted('r1', { importSourceSessionId: 's1' });

        expect(deletedPaths()).toEqual([`${SESSIONS}/r1/logs`, `${SESSIONS}/s1/targets`]);
    });
});

// Nothing else would finish the cleanup once the session document is gone, and
// the platform does not retry the function, so it tries again itself.
describe('deleteBulkSessionData when a step fails', () => {
    it('tries again after a failure and finishes', async () => {
        let calls = 0;
        mockRecursiveDelete.mockImplementation(async () => {
            calls += 1;
            if (calls === 1) throw new Error('UNAVAILABLE');
        });

        await deleted('s1');

        expect(waits).toEqual([RETRY_WAITS_MS[0]]);
        expect(deletedPaths()).toEqual([`${SESSIONS}/s1/logs`, `${SESSIONS}/s1/logs`, `${SESSIONS}/s1/targets`]);
    });

    it('gives up after three tries and reports it', async () => {
        mockRecursiveDelete.mockRejectedValue(new Error('UNAVAILABLE'));

        await expect(deleted('s1')).rejects.toThrow('UNAVAILABLE');

        expect(mockRecursiveDelete).toHaveBeenCalledTimes(3);
        expect(waits).toEqual(RETRY_WAITS_MS);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('co1/s1'), expect.any(Error));
    });
});
