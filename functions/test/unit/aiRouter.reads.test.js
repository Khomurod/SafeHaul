/**
 * The router reads the stored provider order and the provider configs at the
 * same time: neither depends on the other, and every AI call reads both.
 *
 * Uses the `aiRouter` harness, with a Firestore double whose order document
 * answers only when the test lets it.
 */
const mockOrderRead = jest.fn();
let mockAnswerOrderRead = () => {};

jest.mock('../../firebaseAdmin', () => ({
    ...require('./aiRouter.support').firebaseAdminMock(),
    db: { collection: () => ({ add: jest.fn(), doc: () => ({ set: jest.fn(), get: mockOrderRead }) }) },
}));
jest.mock('../../ai/telemetry/record', () => require('./aiRouter.support').telemetryMock());
jest.mock('../../ai/credentials/store', () => require('./aiRouter.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiRouter.support').providersMock());

const { runAiTask } = require('../../ai/router/router');
const { mockStore, textTask, resetAiRouterState } = require('./aiRouter.support');

beforeEach(() => {
    resetAiRouterState();
    mockOrderRead.mockImplementation(() => new Promise((resolve) => {
        mockAnswerOrderRead = () => resolve({ exists: false });
    }));
});

it('reads the provider configs while the stored order is still being read', async () => {
    const running = runAiTask(textTask());
    try {
        await new Promise((resolve) => { setImmediate(resolve); });

        expect(mockOrderRead).toHaveBeenCalled();
        expect(mockStore.readAllConfigs).toHaveBeenCalled();
    } finally {
        // Answered either way, so a failure here leaves no call running.
        mockAnswerOrderRead();
        await running.catch(() => {});
    }
    await expect(running).resolves.toMatchObject({ providerId: expect.any(String) });
});
