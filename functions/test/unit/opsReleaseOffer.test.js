/**
 * The release offer in the alert chat (`offerProductionRelease`).
 *
 * Pinned: one message per eligible Testing release that Production does not
 * serve, only once an approver is known; what changed since Production; the
 * checklist link; an older offer loses its buttons. Shas, ids and titles are
 * artificial.
 */

jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: jest.fn((_opts, fn) => fn) }));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockSettings = { readSettings: jest.fn(), readBotToken: jest.fn() };
jest.mock('../../ops/alertSettings', () => mockSettings);

const mockStatus = jest.fn();
jest.mock('../../releaseManagement/eligibility', () => ({
    ...jest.requireActual('../../releaseManagement/eligibility'),
    readReleaseStatus: (...args) => mockStatus(...args),
}));

const mockTelegram = { sendButtons: jest.fn(), editMessage: jest.fn() };
jest.mock('../../ops/telegram', () => ({
    sendButtons: (...args) => mockTelegram.sendButtons(...args),
    editMessage: (...args) => mockTelegram.editMessage(...args),
}));

const offers = require('../../ops/releaseOffer');

const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const PROD = 'a'.repeat(40);
const TEST = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
const CONNECTED = { telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222, approverId: 9001, approverName: 'Dana Alvarez' } };

const merge = (number, title) => ({ commit: { message: `Merge pull request #${number} from org/branch\n\n${title}` } });
const api = jest.fn(async () => ({ commits: [
    merge(515, 'Tables: final sweep'),
    { commit: { message: 'A commit that is not a merge' } },
    merge(516, 'Signed date: the applicant\'s own calendar day'),
] }));

const status = (sha, { eligible = true, production = PROD } = {}) => ({
    testing: { sha, eligible }, production: production ? { sha: production } : null,
});

const storedOffer = async () => (await offers.offerRef().get()).data();

beforeEach(async () => {
    jest.clearAllMocks();
    await offers.offerRef().delete();
    mockSettings.readSettings.mockResolvedValue(CONNECTED);
    mockSettings.readBotToken.mockResolvedValue(TOKEN);
    mockStatus.mockResolvedValue(status(TEST));
    mockTelegram.sendButtons.mockResolvedValue(77);
    mockTelegram.editMessage.mockResolvedValue(undefined);
});

describe('when to offer', () => {
    it('offers an eligible Testing release that Production does not serve, once', async () => {
        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ offered: TEST });
        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ skipped: 'offered' });

        expect(mockTelegram.sendButtons).toHaveBeenCalledTimes(1);
        expect(await storedOffer()).toEqual(expect.objectContaining({ sha: TEST, chatId: 222, messageId: 77, status: 'offered' }));
    });

    it.each([
        ['not eligible yet', status(TEST, { eligible: false })],
        ['already on Production', status(PROD)],
        ['no Testing release', { testing: null, production: { sha: PROD } }],
    ])('offers nothing when the release is %s', async (_label, state) => {
        mockStatus.mockResolvedValue(state);
        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ skipped: 'nothing-new' });
        expect(mockTelegram.sendButtons).not.toHaveBeenCalled();
    });

    it.each([
        ['no chat is connected', { telegram: { botUsername: 'safehaul_alerts_bot' } }],
        ['nobody is known to approve', { telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222 } }],
    ])('offers nothing while %s, and does not even ask GitHub', async (_label, saved) => {
        mockSettings.readSettings.mockResolvedValue(saved);
        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ skipped: 'no-approver' });
        expect(mockStatus).not.toHaveBeenCalled();
    });

    it('waits for a release in flight before offering the next', async () => {
        await offers.offerRef().set({ sha: TEST, status: 'releasing', chatId: 222, messageId: 77, text: 'old' });
        mockStatus.mockResolvedValue(status(NEWER));
        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ skipped: 'releasing' });
    });

    it('takes the older offer\'s buttons away when a newer release is offered', async () => {
        await offers.offerLatestRelease({ api });
        mockStatus.mockResolvedValue(status(NEWER));
        mockTelegram.sendButtons.mockResolvedValue(78);

        await expect(offers.offerLatestRelease({ api })).resolves.toEqual({ offered: NEWER });

        expect(mockTelegram.editMessage).toHaveBeenCalledWith(TOKEN, 222, 77, expect.stringMatching(/Устарело/), null);
        expect(await storedOffer()).toEqual(expect.objectContaining({ sha: NEWER, messageId: 78 }));
    });
});

describe('what the message says', () => {
    it('names the release, what changed since Production, the checklist, and offers two buttons', async () => {
        await offers.offerLatestRelease({ api });

        const [token, chatId, text, rows] = mockTelegram.sendButtons.mock.calls[0];
        expect([token, chatId]).toEqual([TOKEN, 222]);
        expect(api).toHaveBeenCalledWith(`/compare/${PROD}...${TEST}`);
        expect(text).toContain('bbbbbbb');
        expect(text).toContain('• #515 Tables: final sweep');
        expect(text).toContain('• #516 Signed date: the applicant\'s own calendar day');
        expect(text).not.toContain('not a merge');
        expect(text).toContain(offers.CHECKLIST_URL);
        expect(rows).toEqual([
            [{ text: 'Выпустить на app.safehaul.io', data: `rel:ask:${TEST}` }],
            [{ text: 'Не сейчас', data: `rel:no:${TEST}` }],
        ]);
        // Telegram's limit for a button's data.
        for (const row of rows) for (const button of row) expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
    });

    it('lists the newest eight changes and counts the rest', () => {
        const changes = Array.from({ length: 11 }, (_, index) => `#${index + 1} Change ${index + 1}`);
        const text = offers.offerText(TEST, changes);
        expect(text).toContain('…и ещё 3 раньше');
        expect(text).toContain('• #11 Change 11');
        expect(text).not.toContain('• #3 Change 3');
    });

    it('still offers the release when the list of changes cannot be read', async () => {
        const failing = jest.fn(async () => { throw new Error('GitHub refused'); });
        await expect(offers.offerLatestRelease({ api: failing })).resolves.toEqual({ offered: TEST });
        expect(mockTelegram.sendButtons.mock.calls[0][2]).not.toContain('Что изменилось');
    });
});
