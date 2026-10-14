/**
 * The write side of the saved model lists: what a check saves, and what
 * "Use built-in versions" forgets. Merged into the provider's own config
 * document, so nothing else in it moves.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { delete: () => 'DELETE', serverTimestamp: () => 'TS' } } },
}));
const mockDoc = { data: {}, options: [] };
jest.mock('../../ai/credentials/configDoc', () => ({
    configRef: () => ({
        set: async (patch, options) => {
            mockDoc.options.push(options);
            const next = { ...mockDoc.data };
            for (const [key, value] of Object.entries(patch)) {
                if (value === 'DELETE') delete next[key];
                else next[key] = value;
            }
            mockDoc.data = next;
        },
    }),
}));

const { saveModelCheck, clearModelLists } = require('../../ai/credentials/modelLists');

beforeEach(() => {
    mockDoc.data = { enabled: true, laneHealth: { vision: 'healthy' } };
    mockDoc.options = [];
});

it('forgets the saved lists and keeps what the checks found and everything else', async () => {
    const modelCheck = { checkedAt: '2026-10-14T08:25:00.000Z', lanes: { vision: { status: 'ok' } } };
    await saveModelCheck('gemini', { modelLists: { vision: { models: ['m2'], seed: ['m1'] } }, modelCheck });
    expect(mockDoc.data.modelLists).toEqual({ vision: { models: ['m2'], seed: ['m1'] } });

    await clearModelLists('gemini');

    expect(mockDoc.data).not.toHaveProperty('modelLists');
    expect(mockDoc.data).toMatchObject({ enabled: true, laneHealth: { vision: 'healthy' }, modelCheck });
    expect(mockDoc.options).toEqual([{ merge: true }, { merge: true }]);
});
