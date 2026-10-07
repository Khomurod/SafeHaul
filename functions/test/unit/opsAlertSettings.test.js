/**
 * The alert settings document: a conditional write checks and writes in one
 * transaction, from what that transaction read.
 */

jest.mock('../../firebaseAdmin', () => {
    const stored = { data: null };
    const db = {
        collection: () => ({ doc: () => ({ path: 'system_jobs/platformAlerts' }) }),
        // One transaction: reads see the document as it stands, writes land when it commits.
        runTransaction: async (body) => {
            const writes = [];
            const result = await body({
                get: async () => ({ exists: stored.data !== null, data: () => stored.data }),
                set: (_ref, patch, options) => writes.push({ patch, options }),
            });
            for (const { patch, options } of writes) {
                const replaced = Object.fromEntries(options.mergeFields.map((field) => [field, patch[field]]));
                stored.data = { ...(stored.data || {}), ...replaced };
            }
            return result;
        },
    };
    return { db, admin: {}, mockStored: stored };
});

const { mockStored } = require('../../firebaseAdmin');
const settings = require('../../ops/alertSettings');

describe('replaceSettingsIf', () => {
    beforeEach(() => {
        mockStored.data = {
            telegram: { botUsername: 'safehaul_alerts_bot', pendingStart: { code: 'CODE123' } },
            watch: { lastRunAt: 'earlier' },
        };
    });

    it('writes the fields it names, built from what the transaction read, and leaves the rest', async () => {
        const written = await settings.replaceSettingsIf(
            (stored) => stored.telegram?.pendingStart?.code === 'CODE123',
            (stored) => ({ telegram: { botUsername: stored.telegram.botUsername, chatId: 222 } }),
        );

        expect(written).toBe(true);
        expect(mockStored.data).toEqual({
            telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222 },
            watch: { lastRunAt: 'earlier' },
        });
    });

    it('writes nothing once the settings are no longer the ones the caller started from', async () => {
        mockStored.data = { telegram: { botUsername: 'replacement_bot' }, watch: {} };
        const buildPatch = jest.fn(() => ({ telegram: { chatId: 222 } }));

        const written = await settings.replaceSettingsIf((stored) => stored.telegram?.pendingStart?.code === 'CODE123', buildPatch);

        expect(written).toBe(false);
        expect(buildPatch).not.toHaveBeenCalled();
        expect(mockStored.data).toEqual({ telegram: { botUsername: 'replacement_bot' }, watch: {} });
    });
});
