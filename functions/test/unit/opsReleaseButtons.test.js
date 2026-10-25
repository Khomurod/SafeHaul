/**
 * The release offer's buttons, pressed in Telegram.
 *
 * Pinned: only the approver, in the alert chat, on the current offer, moves
 * anything; "Выпустить" asks again and only "Да, выпустить" releases, once,
 * through the same engine as the console, for the sha the message named; a
 * refusal leaves the offer standing; an older message's button says a newer
 * release exists. Ids, names and shas are artificial.
 */

jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: jest.fn((_opts, fn) => fn) }));
jest.mock('firebase-functions/v2/https', () => {
    class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    }
    return { HttpsError, onCall: jest.fn((_opts, fn) => fn) };
});

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockSettings = { readSettings: jest.fn(), readBotToken: jest.fn() };
jest.mock('../../ops/alertSettings', () => mockSettings);

const mockRunPromotion = jest.fn();
jest.mock('../../releaseManagement/promote', () => ({ runPromotion: (...args) => mockRunPromotion(...args) }));

const mockTelegram = { answerButton: jest.fn(), editMessage: jest.fn(), sendButtons: jest.fn() };
jest.mock('../../ops/telegram', () => ({
    answerButton: (...args) => mockTelegram.answerButton(...args),
    editMessage: (...args) => mockTelegram.editMessage(...args),
    sendButtons: (...args) => mockTelegram.sendButtons(...args),
}));

const { HttpsError } = require('firebase-functions/v2/https');
const { handleButton } = require('../../ops/releaseButtons');
const offers = require('../../ops/releaseOffer');

const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const SHA = 'b'.repeat(40);
const OLDER = 'a'.repeat(40);
const OWNER = 9001;
const CONNECTED = { telegram: { chatId: 222, approverId: OWNER, approverName: 'Dana Alvarez' } };
const OFFER = { sha: SHA, chatId: 222, messageId: 77, text: 'SafeHaul: новая версия (bbbbbbb).', status: 'offered' };

const press = (step, { sha = SHA, from = OWNER, chat = 222, messageId = 77, text = OFFER.text } = {}) => ({
    id: 'cb-1',
    data: `rel:${step}:${sha}`,
    from: { id: from, first_name: 'Dana' },
    message: { message_id: messageId, chat: { id: chat }, text },
});

const stored = async () => (await offers.offerRef().get()).data();
const lastEdit = () => mockTelegram.editMessage.mock.calls.at(-1);
const answered = () => mockTelegram.answerButton.mock.calls.map((call) => call[2]);

beforeEach(async () => {
    jest.clearAllMocks();
    await offers.offerRef().set({ ...OFFER });
    mockSettings.readSettings.mockResolvedValue(CONNECTED);
    mockTelegram.answerButton.mockResolvedValue(undefined);
    mockTelegram.editMessage.mockResolvedValue(undefined);
    mockRunPromotion.mockResolvedValue({ status: 'dispatched', requestId: 'req-1', sha: SHA });
});

describe('who may press', () => {
    it('changes nothing for anyone but the approver', async () => {
        await handleButton(press('yes', { from: 1234 }), TOKEN);

        expect(mockRunPromotion).not.toHaveBeenCalled();
        expect(mockTelegram.editMessage).not.toHaveBeenCalled();
        expect(answered()).toEqual([expect.stringMatching(/только владелец/)]);
        expect((await stored()).status).toBe('offered');
    });

    it('changes nothing from another chat, even for the approver', async () => {
        await handleButton(press('yes', { chat: 999 }), TOKEN);
        expect(mockRunPromotion).not.toHaveBeenCalled();
        expect(answered()).toEqual([expect.stringMatching(/не из чата/)]);
    });

    it('changes nothing while no approver is known', async () => {
        mockSettings.readSettings.mockResolvedValue({ telegram: { chatId: 222 } });
        await handleButton(press('yes'), TOKEN);
        expect(mockRunPromotion).not.toHaveBeenCalled();
    });

    it('ignores data it did not write', async () => {
        await handleButton({ ...press('yes'), data: 'rel:yes:not-a-sha' }, TOKEN);
        await handleButton({ ...press('yes'), data: 'something else' }, TOKEN);
        expect(mockRunPromotion).not.toHaveBeenCalled();
        expect(mockSettings.readSettings).not.toHaveBeenCalled();
    });
});

describe('the two steps', () => {
    it('"Выпустить" asks again, and "Отмена" puts the first buttons back', async () => {
        await handleButton(press('ask'), TOKEN);
        expect(lastEdit()).toEqual([TOKEN, 222, 77, expect.stringMatching(/Точно выпустить версию bbbbbbb/), offers.CONFIRM_ROWS(SHA)]);
        expect(mockRunPromotion).not.toHaveBeenCalled();

        await handleButton(press('back'), TOKEN);
        expect(lastEdit()).toEqual([TOKEN, 222, 77, OFFER.text, offers.OFFER_ROWS(SHA)]);
        expect((await stored()).status).toBe('offered');
    });

    it('answers a repeated press that would leave the message as it is', async () => {
        // Telegram refuses an edit to the text and buttons already shown.
        mockTelegram.editMessage.mockRejectedValue(Object.assign(new Error('refused'), { code: 'not_modified' }));
        await expect(handleButton(press('ask'), TOKEN)).resolves.toBeUndefined();
        await expect(handleButton(press('back'), TOKEN)).resolves.toBeUndefined();
        expect(mockTelegram.answerButton).toHaveBeenCalledTimes(2);
    });

    it('does not hide any other refused edit', async () => {
        mockTelegram.editMessage.mockRejectedValue(Object.assign(new Error('refused'), { code: 'bad_request' }));
        await expect(handleButton(press('ask'), TOKEN)).rejects.toMatchObject({ code: 'bad_request' });
    });

    it('"Да, выпустить" releases the sha the message named, through the console\'s engine', async () => {
        await handleButton(press('yes'), TOKEN);

        expect(mockRunPromotion).toHaveBeenCalledTimes(1);
        const [options] = mockRunPromotion.mock.calls[0];
        expect(options).toEqual(expect.objectContaining({
            auth: { uid: `telegram:${OWNER}`, token: {} },
            kind: 'promote',
            expectedSha: SHA,
            reason: expect.stringContaining('Dana Alvarez'),
        }));
        // The candidate is whatever Testing serves and is eligible, never the button's sha.
        expect(options.resolveCandidate({ testing: { sha: 'x', eligible: true } })).toBe('x');
        expect(options.resolveCandidate({ testing: { sha: 'x', eligible: false } })).toBeNull();

        expect(await stored()).toEqual(expect.objectContaining({ status: 'releasing', requestId: 'req-1' }));
        expect(lastEdit()).toEqual([TOKEN, 222, 77, expect.stringMatching(/Выпуск запущен/), null]);
    });

    it('starts one release however often the press arrives', async () => {
        let finish;
        mockRunPromotion.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const first = handleButton(press('yes'), TOKEN);
        await new Promise((resolve) => setImmediate(resolve));
        await handleButton(press('yes'), TOKEN);
        finish({ status: 'dispatched', requestId: 'req-1' });
        await first;

        expect(mockRunPromotion).toHaveBeenCalledTimes(1);
        expect(answered()).toContain('Этот выпуск уже запущен или отменён.');
    });

    it('"Не сейчас" takes the buttons away and releases nothing', async () => {
        await handleButton(press('no'), TOKEN);
        expect((await stored()).status).toBe('declined');
        expect(lastEdit()).toEqual([TOKEN, 222, 77, expect.stringMatching(/Super Admin → Releases/), null]);

        await handleButton(press('yes'), TOKEN);
        expect(mockRunPromotion).not.toHaveBeenCalled();
    });
});

describe('when the release cannot start', () => {
    it.each([
        ['another release is running', new HttpsError('aborted', 'A release is already running.'), /другой выпуск/],
        ['the release changed or is not eligible', new HttpsError('failed-precondition', 'The tested release changed'), /изменилась/],
        ['GitHub is down', new HttpsError('unavailable', 'GitHub could not be reached'), /недоступен/],
    ])('says so in Russian when %s, and leaves the offer to press again', async (_label, error, said) => {
        mockRunPromotion.mockRejectedValue(error);

        await handleButton(press('yes'), TOKEN);

        expect((await stored()).status).toBe('offered');
        expect(lastEdit()).toEqual([TOKEN, 222, 77, expect.stringMatching(said), offers.OFFER_ROWS(SHA)]);
        expect(lastEdit()[3]).not.toMatch(/GitHub|release/);
    });

    it('says when the release is already on app.safehaul.io', async () => {
        mockRunPromotion.mockResolvedValue({ status: 'already-live', sha: SHA, requestId: null });
        await handleButton(press('yes'), TOKEN);
        expect((await stored()).status).toBe('done');
        expect(lastEdit()[3]).toMatch(/уже на app\.safehaul\.io/);
    });
});

describe('an older message', () => {
    it('says a newer release exists, loses its buttons, and releases nothing', async () => {
        await handleButton(press('yes', { sha: OLDER, messageId: 60, text: 'старое сообщение' }), TOKEN);

        expect(mockRunPromotion).not.toHaveBeenCalled();
        expect(lastEdit()).toEqual([TOKEN, 222, 60, expect.stringMatching(/^старое сообщение\n\nУстарело/), null]);
        expect(answered()).toEqual([expect.stringMatching(/версия новее/)]);
    });
});
