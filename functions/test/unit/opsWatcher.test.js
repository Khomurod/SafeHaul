/**
 * The hourly watcher: what it checks, and when it speaks.
 *
 * The router, the blog store, the ledger, telemetry, the settings document and
 * Telegram are all mocked at their module boundaries; their own suites own
 * their behaviour. Pinned here: one message per change and none otherwise, the
 * words a message uses, and an undelivered alert being retried, not lost.
 */

jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: jest.fn((_opts, fn) => fn) }));

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({ runAiTask: (...args) => mockRunAiTask(...args) }));

const mockReadTelemetry = jest.fn();
jest.mock('../../ai/telemetry/record', () => ({ readTelemetry: (...args) => mockReadTelemetry(...args) }));

const mockUnfilledSlots = jest.fn();
jest.mock('../../blog/store', () => ({ unfilledSlots: (...args) => mockUnfilledSlots(...args) }));

const mockReadRecentSlotRuns = jest.fn();
jest.mock('../../blog/runLedger', () => ({ readRecentSlotRuns: (...args) => mockReadRecentSlotRuns(...args) }));

const mockSettings = { readSettings: jest.fn(), readBotToken: jest.fn(), replaceSettings: jest.fn() };
jest.mock('../../ops/alertSettings', () => mockSettings);

const mockSendMessage = jest.fn();
jest.mock('../../ops/telegram', () => ({ sendMessage: (...args) => mockSendMessage(...args) }));

const { TASK_TYPES } = require('../../ai/tasks/contract');
const { AiError } = require('../../ai/router/errors');
const { runWatch, watchAiAndBlog, describeFailure } = require('../../ops/watcher');

// 2026-08-02 15:40 UTC is 10:40 in Chicago.
const NOW = Date.parse('2026-08-02T15:40:00Z');
const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;
const CONNECTED = { telegram: { botUsername: 'safehaul_alerts_bot', chatId: 222, chatTitle: 'Dana' } };

/** The router's answer: every lane reads correctly unless a test says otherwise. */
function answer(task) {
    const vision = task.capabilities.includes('vision');
    return { output: { answer: vision ? 'Red' : 'ready' }, providerId: 'gemini', fallbackCount: 0 };
}

function saved(watch) {
    return { ...CONNECTED, ...(watch ? { watch } : {}) };
}

/** The `watch` field the run wrote. */
function written() {
    const call = mockSettings.replaceSettings.mock.calls[mockSettings.replaceSettings.mock.calls.length - 1];
    return call ? call[0].watch : undefined;
}

beforeEach(() => {
    jest.resetAllMocks();
    mockSettings.readSettings.mockResolvedValue(saved());
    mockSettings.readBotToken.mockResolvedValue(TOKEN);
    mockSettings.replaceSettings.mockResolvedValue(undefined);
    mockRunAiTask.mockImplementation(async (task) => answer(task));
    // Every day has its article.
    mockUnfilledSlots.mockImplementation(async (slots) => slots.slice(1));
    mockReadRecentSlotRuns.mockResolvedValue({ entries: [] });
    mockReadTelemetry.mockResolvedValue({ entries: [] });
    mockSendMessage.mockResolvedValue(undefined);
});

describe('before anyone is connected', () => {
    it('still checks and records what it saw, and tells nobody', async () => {
        // The probes feed provider health, which sends a failing provider to the daily model check.
        mockSettings.readSettings.mockResolvedValue({ telegram: { botUsername: 'safehaul_alerts_bot' } });
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('vision')) throw new AiError('all_providers_failed', 'down');
            return answer(task);
        });

        const outcome = await runWatch({ now: NOW });

        expect(mockRunAiTask).toHaveBeenCalledTimes(2);
        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockSettings.readBotToken).not.toHaveBeenCalled();
        expect(outcome.deliveryError).toBeNull();
        expect(written().checks.vision).toMatchObject({ status: 'down' });
    });
});

describe('the checks', () => {
    it('probes each lane through the router, as a connection test that fits the schedule', async () => {
        await runWatch({ now: NOW });

        const tasks = mockRunAiTask.mock.calls.map(([task]) => task);
        expect(tasks.map((task) => task.taskType)).toEqual([TASK_TYPES.HEALTH_CHECK, TASK_TYPES.HEALTH_CHECK]);
        expect(tasks[0].capabilities).toContain('vision');
        expect(tasks[0].images).toHaveLength(1);
        expect(tasks[1].capabilities).toContain('text');
        for (const task of tasks) {
            expect(task.perAttemptDeadlineMs).toBeLessThan(task.totalDeadlineMs);
            // Two probes inside the scheduled function's 300s.
            expect(task.totalDeadlineMs * 2).toBeLessThan(300000);
        }
    });

    it('records everything working, and says nothing on a first run that finds it so', async () => {
        const outcome = await runWatch({ now: NOW });

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(outcome.changes).toEqual([]);
        expect(written().checks).toEqual({
            vision: { status: 'ok', since: '2026-08-02T15:40:00.000Z', detail: null },
            text: { status: 'ok', since: '2026-08-02T15:40:00.000Z', detail: null },
            blog: { status: 'ok', since: '2026-08-02T15:40:00.000Z', detail: null },
        });
    });

    it('counts a provider that answered in shape but wrongly as not working', async () => {
        mockRunAiTask.mockImplementation(async (task) => (task.capabilities.includes('vision')
            ? { output: { answer: 'blue' }, providerId: 'groq', fallbackCount: 1 }
            : answer(task)));

        await runWatch({ now: NOW });

        expect(written().checks.vision).toMatchObject({ status: 'down', detail: 'groq=wrong_answer' });
        expect(mockRunAiTask.mock.calls[0][0].verdictOf({ answer: 'blue' })).toBe('wrong_answer');
    });
});

describe('when it speaks', () => {
    const allProvidersFailed = () => Object.assign(
        new AiError('all_providers_failed', '2 provider(s) attempted [gemini=quota_exceeded, groq=timeout]; last failure timeout.'),
        { failureCategories: ['quota_exceeded', 'timeout'] },
    );

    it('says once that a lane went down, naming what failed and how many people felt it', async () => {
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('vision')) throw allProvidersFailed();
            return answer(task);
        });
        mockReadTelemetry.mockResolvedValue({
            entries: [
                { taskType: 'cdl_extraction', capability: 'vision' },
                { taskType: 'cdl_extraction', capability: 'vision' },
                // The watcher's own probes are not people.
                { taskType: TASK_TYPES.HEALTH_CHECK, capability: 'vision' },
                { taskType: 'article_generation', capability: 'article_generation' },
            ],
        });

        await runWatch({ now: NOW });

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const [token, chatId, text] = mockSendMessage.mock.calls[0];
        expect([token, chatId]).toEqual([TOKEN, 222]);
        expect(text).toContain('не работает ИИ для фото и документов');
        expect(text).toContain('10:40 по Чикаго: gemini=quota_exceeded, groq=timeout');
        expect(text).toContain('Ошибок у пользователей за последний час: 2');
        expect(written().checks.vision).toMatchObject({ status: 'down', detail: 'gemini=quota_exceeded, groq=timeout' });
    });

    it('counts only what people asked for, not the blog\'s own requests', async () => {
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('text')) throw allProvidersFailed();
            return answer(task);
        });
        mockReadTelemetry.mockResolvedValue({
            entries: [
                { taskType: 'application_document_extraction', capability: 'text' },
                // The blog runs at :15 with nobody waiting on it.
                { taskType: 'article_generation', capability: 'article_generation' },
                { taskType: 'article_fact_check', capability: 'text' },
                { taskType: 'topic_selection', capability: 'classification' },
            ],
        });

        await runWatch({ now: NOW });

        expect(mockSendMessage.mock.calls[0][2]).toContain('Ошибок у пользователей за последний час: 1.');
    });

    it('says "at least" when there were more failures than one read holds', async () => {
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('text')) throw allProvidersFailed();
            return answer(task);
        });
        mockReadTelemetry.mockResolvedValue({
            entries: [{ taskType: 'application_document_extraction', capability: 'text' }],
            truncated: true,
        });

        await runWatch({ now: NOW });

        expect(mockSendMessage.mock.calls[0][2]).toContain('Ошибок у пользователей за последний час: 1+.');
    });

    it('stays quiet while a lane stays down, and keeps when it went down', async () => {
        mockSettings.readSettings.mockResolvedValue(saved({
            checks: { vision: { status: 'down', since: '2026-08-02T14:40:00.000Z', detail: 'x' } },
        }));
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('vision')) throw new AiError('provider_unavailable', 'resting');
            return answer(task);
        });

        await runWatch({ now: NOW });

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(written().checks.vision).toMatchObject({ status: 'down', since: '2026-08-02T14:40:00.000Z', detail: 'provider_unavailable' });
    });

    it('says so when a lane comes back, naming who answered', async () => {
        mockSettings.readSettings.mockResolvedValue(saved({ checks: { text: { status: 'down', since: 'earlier' } } }));

        await runWatch({ now: NOW });

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage.mock.calls[0][2]).toBe('✅ SafeHaul: снова работает ИИ для текстов (блог, чтение документов рекрутером). Ответил gemini.');
        expect(written().checks.text.status).toBe('ok');
    });

    it('raises the blog when neither yesterday nor today has an article, with the reasons', async () => {
        mockUnfilledSlots.mockImplementation(async (slots) => slots);
        mockReadRecentSlotRuns.mockResolvedValue({
            entries: [
                { publicationDate: '2026-08-02', outcome: 'skipped_no_sources' },
                { publicationDate: '2026-08-01', outcome: 'failed_generation' },
                { publicationDate: '2026-08-01', outcome: 'skipped_no_sources' },
                // Older days say nothing about this miss.
                { publicationDate: '2026-07-20', outcome: 'skipped_validation' },
            ],
        });

        await runWatch({ now: NOW });

        const text = mockSendMessage.mock.calls[0][2];
        expect(text).toContain('блог не опубликовал статью ни вчера, ни сегодня');
        expect(text).toContain('Причины: нет свежих источников, ИИ не написал статью.');
        expect(text).not.toContain('черновик не прошёл проверку');
        // Yesterday and today, in Chicago.
        expect(mockUnfilledSlots.mock.calls.map(([slots]) => slots[0].publicationDate)).toEqual(['2026-08-02', '2026-08-01']);
    });

    it('clears the blog as soon as an article is out, a deleted one included', async () => {
        mockSettings.readSettings.mockResolvedValue(saved({ checks: { blog: { status: 'down', since: 'earlier' } } }));
        // Today's slots: one holds an article (perhaps since deleted, which still counts).
        mockUnfilledSlots.mockImplementation(async (slots) => slots.slice(1));

        await runWatch({ now: NOW });

        expect(mockSendMessage.mock.calls[0][2]).toBe('✅ SafeHaul: блог снова публикует статьи.');
    });

    it('keeps an alert it could not deliver, so the next run tries again', async () => {
        mockRunAiTask.mockImplementation(async (task) => {
            if (task.capabilities.includes('vision')) throw allProvidersFailed();
            return answer(task);
        });
        mockSendMessage.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'blocked' }));

        const outcome = await runWatch({ now: NOW });

        expect(outcome.deliveryError).toBe('blocked');
        expect(written().lastDeliveryError).toBe('blocked');
        // Not told, so not recorded as down: the next run sees the same change.
        expect(written().checks).not.toHaveProperty('vision');
        expect(written().checks.text.status).toBe('ok');
    });
});

describe('what a failure is called', () => {
    it('takes only whole provider=category pairs from a trail cut at 200 characters', () => {
        const cut = new AiError('all_providers_failed', '3 provider(s) attempted [gemini=quota_exceeded, groq=timeout, huggingface=time');
        expect(describeFailure(cut)).toBe('gemini=quota_exceeded, groq=timeout');
        expect(describeFailure(new AiError('provider_unavailable', 'resting'))).toBe('provider_unavailable');
        expect(describeFailure(new Error('no category'))).toBe('internal');
    });
});

describe('the schedule', () => {
    it('runs one watch when it fires', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        await watchAiAndBlog();

        expect(mockRunAiTask).toHaveBeenCalledTimes(2);
        expect(log.mock.calls[0][0]).toBe('[ops/watcher] vision=ok text=ok blog=ok');
        log.mockRestore();
    });
});
