// =====================================================================
// writeNewSession (`bulkActions/helpers/sessionTargets.js`) writes a session,
// its recipients and, when a launch names its draft, the draft's launched mark
// in one batch: no session exists without its list or its mark.
// =====================================================================

const mockBatch = {
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn(async () => {}),
};

jest.mock('../../firebaseAdmin', () => ({
    db: { batch: () => mockBatch },
}));

const { writeNewSession } = require('../../bulkActions/helpers/sessionTargets');

const targetsRef = { id: 'targets' };
const sessionRef = {
    id: 'session-1',
    collection: () => ({ doc: () => targetsRef }),
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('writeNewSession', () => {
    it('writes the session and its recipients in one batch', async () => {
        await writeNewSession(sessionRef, { id: 'session-1' }, ['lead-1']);

        expect(mockBatch.set).toHaveBeenCalledWith(sessionRef, { id: 'session-1' });
        expect(mockBatch.set).toHaveBeenCalledWith(targetsRef, { ids: ['lead-1'] });
        expect(mockBatch.update).not.toHaveBeenCalled();
        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('marks the draft in the same batch when the launch names one', async () => {
        const draftRef = { id: 'camp-1' };
        const mark = { launchedAt: 'server-time', sessionId: 'session-1' };

        await writeNewSession(sessionRef, { id: 'session-1' }, ['lead-1'], { ref: draftRef, data: mark });

        expect(mockBatch.update).toHaveBeenCalledWith(draftRef, mark);
        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
        expect(mockBatch.update.mock.invocationCallOrder[0]).toBeLessThan(mockBatch.commit.mock.invocationCallOrder[0]);
    });
});
