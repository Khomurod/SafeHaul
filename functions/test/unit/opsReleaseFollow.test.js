/**
 * After a Telegram-started release: the chat hears how it ended.
 *
 * Pinned: "Готово" only when app.safehaul.io itself serves the released commit;
 * a failed run, a site serving something else, a site that does not answer, a
 * run that never finishes and a press that never dispatched are each said
 * plainly; the offer closes every time, and nothing is said while it runs.
 */

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockRuns = jest.fn();
jest.mock('../../releaseManagement/github', () => ({ listPromotionRuns: (...args) => mockRuns(...args) }));
const mockRefresh = jest.fn();
jest.mock('../../releaseManagement/promotionStore', () => ({
    PROMOTIONS_COLLECTION: 'release_promotions',
    serialisePromotion: (doc) => (doc.exists ? { requestId: doc.id, ...doc.data() } : null),
    refreshPromotion: (...args) => mockRefresh(...args),
}));
const mockSend = jest.fn();
jest.mock('../../ops/telegram', () => ({ sendMessage: (...args) => mockSend(...args) }));

const { followRelease, readLiveSha, STALL_MS, RUN_LIMIT_MS } = require('../../ops/releaseFollow');

const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const SHA = 'b'.repeat(40);
const NOW = Date.parse('2026-10-25T12:00:00Z');
const offerRef = mock.db.collection('system_jobs').doc('releaseOffer');
const OFFER = { sha: SHA, chatId: 222, messageId: 77, status: 'releasing', requestId: 'req-1', confirmedAt: new Date(NOW - 5 * 60 * 1000).toISOString() };

const live = (body, ok = true) => jest.fn(async (url) => {
    expect(url).toMatch(/^https:\/\/app\.safehaul\.io\/release\.json\?at=\d+$/);
    return { ok, json: async () => body };
});
const said = () => mockSend.mock.calls.map((call) => call[2]);
const stored = async () => (await offerRef.get()).data();

beforeEach(async () => {
    jest.clearAllMocks();
    await offerRef.set({ ...OFFER });
    await mock.db.collection('release_promotions').doc('req-1').set({ sha: SHA, status: 'in_progress' });
    mockRuns.mockResolvedValue([]);
    mockRefresh.mockResolvedValue({ status: 'in_progress' });
    mockSend.mockResolvedValue(undefined);
});

const follow = ({ offer, ...extra } = {}) => followRelease({ token: TOKEN, offer: { ...OFFER, ...offer }, offerRef, now: NOW, ...extra });

it('says nothing while the release runs', async () => {
    mockRefresh.mockResolvedValue({ status: 'in_progress' });
    await expect(follow()).resolves.toBe('waiting');
    expect(mockSend).not.toHaveBeenCalled();
    expect((await stored()).status).toBe('releasing');
    // The stored promotion is reconciled against GitHub's runs, as the console does.
    expect(mockRefresh).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1' }), []);
});

it('says "Готово" only once app.safehaul.io serves the released commit', async () => {
    mockRefresh.mockResolvedValue({ status: 'completed', conclusion: 'success' });
    await expect(follow({ fetchImpl: live({ sha: SHA }) })).resolves.toBe('done');

    expect(mockSend).toHaveBeenCalledWith(TOKEN, 222, expect.stringMatching(/готово\. app\.safehaul\.io теперь такой же, как тестовый сайт \(версия bbbbbbb\)/));
    expect(await stored()).toEqual(expect.objectContaining({ status: 'done', finishedAt: expect.any(String) }));
});

it.each([
    ['serves another commit', live({ sha: 'c'.repeat(40) }), /показывает версию ccccccc/],
    ['does not answer', live(null, false), /не отвечает/],
    ['answers without a release record', live({ builtAt: 'x' }), /не отвечает/],
])('says so when, after a green run, the live site %s', async (_label, fetchImpl, text) => {
    mockRefresh.mockResolvedValue({ status: 'completed', conclusion: 'success' });
    await expect(follow({ fetchImpl })).resolves.toBe('failed');
    expect(said()).toEqual([expect.stringMatching(text)]);
    expect((await stored()).status).toBe('failed');
});

it('says a failed run left the site as it was, with where to look', async () => {
    mockRefresh.mockResolvedValue({ status: 'completed', conclusion: 'failure', runUrl: 'https://github.com/org/repo/actions/runs/1' });
    const fetchImpl = jest.fn();
    await expect(follow({ fetchImpl })).resolves.toBe('failed');
    expect(said()).toEqual([expect.stringMatching(/не удался\. Рабочий сайт остался прежним\.\nПодробности: https:\/\/github\.com/)]);
    expect(fetchImpl).not.toHaveBeenCalled();
});

it('gives up on a run that has not finished within the hour', async () => {
    mockRefresh.mockResolvedValue({ status: 'in_progress' });
    const confirmedAt = new Date(NOW - RUN_LIMIT_MS - 1000).toISOString();
    await expect(follow({ offer: { confirmedAt } })).resolves.toBe('failed');
    expect(said()).toEqual([expect.stringMatching(/больше часа/)]);
});

it.each([
    ['GitHub cannot be read', () => mockRuns.mockRejectedValue(new Error('unavailable'))],
    ['the stored promotion cannot be read', () => mockRefresh.mockRejectedValue(new Error('unavailable'))],
])('waits while %s, and still closes the offer at the hour', async (_label, fail) => {
    fail();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(follow()).resolves.toBe('waiting');
    expect(mockSend).not.toHaveBeenCalled();
    expect((await stored()).status).toBe('releasing');

    const confirmedAt = new Date(NOW - RUN_LIMIT_MS - 1000).toISOString();
    await expect(follow({ offer: { confirmedAt } })).resolves.toBe('failed');
    expect(said()).toEqual([expect.stringMatching(/больше часа/)]);
    expect((await stored()).status).toBe('failed');
    console.error.mockRestore();
});

it('says a press that never dispatched did not start a release, after a wait', async () => {
    await expect(follow({ offer: { requestId: undefined } })).resolves.toBe('waiting');
    const confirmedAt = new Date(NOW - STALL_MS - 1000).toISOString();
    await expect(follow({ offer: { requestId: undefined, confirmedAt } })).resolves.toBe('failed');
    expect(said()).toEqual([expect.stringMatching(/не запустился\. Рабочий сайт не изменился/)]);
    expect(mockRefresh).not.toHaveBeenCalled();
});

it('reads the live commit with a timeout, and null on any failure', async () => {
    await expect(readLiveSha({ fetchImpl: jest.fn(async () => { throw new Error('offline'); }) })).resolves.toBeNull();
    await expect(readLiveSha({ fetchImpl: live({ sha: SHA }) })).resolves.toBe(SHA);
});
