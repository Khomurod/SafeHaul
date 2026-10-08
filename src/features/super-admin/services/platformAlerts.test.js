/**
 * What the Telegram connect call sends. The server reads `checkOnly` and
 * `chatShown` only when they are exactly booleans, and a page that says nothing
 * gets what a page built before them got.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => []);

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async (payload) => {
        sent.push({ name, payload });
        return { data: { ok: true } };
    },
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { connectPlatformAlertChat } from './platformAlerts';

beforeEach(() => {
    sent.length = 0;
});

describe('connectPlatformAlertChat', () => {
    it('sends the page\'s own check as checkOnly, and nothing else', async () => {
        await connectPlatformAlertChat({ checkOnly: true, chatShown: false });
        expect(sent).toEqual([{ name: 'connectPlatformAlertChat', payload: { checkOnly: true } }]);
    });

    it('says whether the page showed a chat when Connect chat or Reconnect chat was pressed', async () => {
        await connectPlatformAlertChat({ chatShown: false });
        await connectPlatformAlertChat({ chatShown: true });
        expect(sent.map(({ payload }) => payload)).toEqual([{ chatShown: false }, { chatShown: true }]);
    });

    it('sends nothing for a press that does not say', async () => {
        await connectPlatformAlertChat();
        expect(sent.map(({ payload }) => payload)).toEqual([{}]);
    });
});
