/**
 * The hourly watcher: can AI read for users right now, and is the blog still
 * publishing? It tells the operator in Telegram when an answer changes, and only
 * then.
 *
 * ## What it checks
 *
 * - **Each AI lane, through the real router.** A constant request (a red square
 *   for photos, "ready" for text) takes the path a driver's request takes, so a
 *   pass means that kind of request can be served now, by whichever provider
 *   answers: the experience users get. Two small requests an hour, recorded in
 *   the Logs tab as connection tests and counted towards provider health like
 *   any other request. `testAiProvider` stays the tool for one provider.
 * - **The blog.** Down when neither yesterday nor today (Chicago) holds an
 *   article, a deleted one counting as published. A missed day raises it after
 *   midnight, and the next article clears it.
 *
 * ## When it speaks
 *
 * On a change only: a check going down, and the same check coming back. A first
 * run that finds everything working says nothing. When a message cannot be
 * delivered, the check keeps its previous state, so the next run tries again
 * rather than the alert being lost.
 *
 * Nothing runs until a bot token and a chat are connected (Super Admin → System
 * Health). With nobody to tell, the probes would spend quota for nothing.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { CAPABILITIES, laneForCapability } = require('../ai/registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('../ai/tasks/contract');
const { runAiTask } = require('../ai/router/router');
const { ALL_CATEGORIES } = require('../ai/router/errors');
const { RED_PNG } = require('../ai/tasks/healthProbes');
const { readTelemetry } = require('../ai/telemetry/record');
const blogStore = require('../blog/store');
const { TIMEZONE, allSlotsFor, publicationDateFor } = require('../blog/pipeline/themes');
const runLedger = require('../blog/runLedger');
const settings = require('./alertSettings');
const telegram = require('./telegram');

/** Below the scheduled function's timeout with both probes and the blog read. */
const PROBE_TOTAL_MS = 45000;
const PROBE_PER_ATTEMPT_MS = 20000;
const HOUR_MS = 60 * 60 * 1000;

const ANSWER_SCHEMA = Object.freeze({
    type: 'object',
    properties: { answer: { type: 'string', maxLength: 40 } },
    required: ['answer'],
    additionalProperties: false,
});

const LANES = Object.freeze([
    {
        id: 'vision',
        label: 'ИИ для фото и документов (CDL, мед. карта, PSP/MVR, помощник e-документов)',
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
        inputText: 'What colour is this image? Answer with one word.',
        images: [{ dataUrl: RED_PNG }],
        expect: /red/i,
    },
    {
        id: 'text',
        label: 'ИИ для текстов (блог, чтение документов рекрутером)',
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON],
        inputText: 'Reply with the single word: ready',
        images: null,
        expect: /ready/i,
    },
]);

const CHECK_IDS = Object.freeze([...LANES.map((lane) => lane.id), 'blog']);

/** The tasks a person waits on. The blog's tasks and these probes run with nobody waiting. */
const USER_TASKS = new Set([
    TASK_TYPES.CDL_EXTRACTION,
    TASK_TYPES.MEDICAL_CARD_EXTRACTION,
    TASK_TYPES.PSP_REPORT_EXTRACTION,
    TASK_TYPES.MVR_EXTRACTION,
    TASK_TYPES.APPLICATION_DOCUMENT_EXTRACTION,
    TASK_TYPES.EDOC_FIELD_PLACEMENT,
]);

/** Why the blog refused, in the owner's words. */
const BLOG_REASONS = Object.freeze({
    skipped_no_sources: 'нет свежих источников',
    skipped_all_duplicates: 'темы уже освещались',
    skipped_not_original: 'черновик похож на недавнюю статью',
    skipped_validation: 'черновик не прошёл проверку',
    skipped_prohibited_claim: 'запрещённое утверждение о SafeHaul',
    skipped_unsupported_claims: 'утверждение без подтверждения',
    failed_generation: 'ИИ не написал статью',
});

/**
 * What failed, as provider ids and categories only. An exhausted walk's trail
 * is in its `detail` (`buildTerminalFailure`), cut at 200 characters; only
 * `id=category` pairs naming a real category are taken from it, so a cut pair
 * and anything else that string could hold are left behind.
 */
function describeFailure(error) {
    const category = String(error?.category || 'internal');
    if (category !== 'all_providers_failed') return category;
    const pairs = (String(error?.detail || '').match(/\b[a-z0-9-]+=[a-z_]+\b/g) || [])
        .filter((pair) => ALL_CATEGORIES.includes(pair.split('=')[1]));
    return pairs.length > 0 ? pairs.join(', ') : category;
}

async function probeLane(lane, aiDeps) {
    const answered = (output) => lane.expect.test(String(output?.answer || ''));
    const task = defineTask({
        taskType: TASK_TYPES.HEALTH_CHECK,
        capabilities: lane.capabilities,
        inputText: lane.inputText,
        images: lane.images,
        outputSchema: ANSWER_SCHEMA,
        schemaName: 'watcher_probe',
        temperature: 0,
        maxOutputTokens: 120,
        privacy: PRIVACY.INTERNAL,
        totalDeadlineMs: PROBE_TOTAL_MS,
        perAttemptDeadlineMs: PROBE_PER_ATTEMPT_MS,
        // A valid shape with the wrong answer is a provider that did not read.
        verdictOf: (output) => (answered(output) ? 'answered' : 'wrong_answer'),
    });
    try {
        const result = await runAiTask(task, aiDeps);
        if (!answered(result.output)) return { ok: false, detail: `${result.providerId}=wrong_answer` };
        return { ok: true, providerId: result.providerId };
    } catch (error) {
        return { ok: false, detail: describeFailure(error) };
    }
}

function dayBefore(date) {
    return new Date(Date.parse(`${date}T12:00:00Z`) - 24 * HOUR_MS).toISOString().slice(0, 10);
}

async function blogCheck(now) {
    const today = publicationDateFor(now);
    const yesterday = dayBefore(today);
    for (const date of [today, yesterday]) {
        const slots = allSlotsFor(date);
        if ((await blogStore.unfilledSlots(slots)).length < slots.length) return { ok: true };
    }
    const { entries } = await runLedger.readRecentSlotRuns(60);
    const reasons = [...new Set(entries
        .filter((run) => run.publicationDate === today || run.publicationDate === yesterday)
        .map((run) => BLOG_REASONS[run.outcome] || run.outcome)
        .filter(Boolean))];
    return { ok: false, detail: reasons.join(', ') || 'нет записей о попытках' };
}

/** Failed user requests in the last hour, per lane: how many people felt it. */
async function userFailuresLastHour(now) {
    const { entries, truncated } = await readTelemetry({
        outcome: 'failure',
        from: new Date(now - HOUR_MS).toISOString(),
        to: new Date(now).toISOString(),
        limit: 250,
    });
    const counts = { vision: 0, text: 0 };
    for (const entry of entries) {
        if (USER_TASKS.has(entry.taskType)) counts[laneForCapability(entry.capability)] += 1;
    }
    // A full page is a floor, not a count.
    const shown = (count) => (truncated ? `${count}+` : String(count));
    return { vision: shown(counts.vision), text: shown(counts.text) };
}

function chicagoTime(now) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })
        .format(new Date(now));
}

function composeMessage(changes, results, { now, failures }) {
    const lines = changes.map((id) => {
        const result = results[id];
        const lane = LANES.find((entry) => entry.id === id);
        if (id === 'blog') {
            return result.ok
                ? '✅ SafeHaul: блог снова публикует статьи.'
                : `⚠️ SafeHaul: блог не опубликовал статью ни вчера, ни сегодня.\nПричины: ${result.detail}.\n`
                    + 'Подробности: Super Admin → Blog Posts → Publication runs.';
        }
        if (result.ok) return `✅ SafeHaul: снова работает ${lane.label}. Ответил ${result.providerId}.`;
        return `⚠️ SafeHaul: не работает ${lane.label}.\n`
            + `Проверка в ${chicagoTime(now)} по Чикаго: ${result.detail}.\n`
            + `Ошибок у пользователей за последний час: ${failures?.[id] ?? 'неизвестно'}.\n`
            + 'Люди видят «временно недоступно» и могут ввести данные вручную.';
    });
    return lines.join('\n\n');
}

/**
 * One run. Exported apart from the schedule so tests drive it directly.
 *
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {object} [options.aiDeps] the router's injection seam
 * @param {object} [options.telegramDeps] `{ fetchImpl }` for the Bot API
 */
async function runWatch({ now = Date.now(), aiDeps, telegramDeps } = {}) {
    const saved = await settings.readSettings();
    const chatId = saved.telegram?.chatId;
    const token = chatId === undefined || chatId === null ? null : await settings.readBotToken();
    if (!token) return { skipped: 'not_connected' };

    const results = {};
    for (const lane of LANES) results[lane.id] = await probeLane(lane, aiDeps);
    results.blog = await blogCheck(now);

    const previous = saved.watch?.checks || {};
    const statusOf = (id) => (results[id].ok ? 'ok' : 'down');
    const changes = CHECK_IDS.filter((id) => (statusOf(id) === 'down'
        ? previous[id]?.status !== 'down'
        : previous[id]?.status === 'down'));

    let deliveryError = null;
    if (changes.length > 0) {
        const laneDown = changes.some((id) => id !== 'blog' && !results[id].ok);
        const failures = laneDown ? await userFailuresLastHour(now) : null;
        try {
            await telegram.sendMessage(token, chatId, composeMessage(changes, results, { now, failures }), telegramDeps);
        } catch (error) {
            deliveryError = error?.code || 'unavailable';
        }
    }

    const at = new Date(now).toISOString();
    const checks = {};
    for (const id of CHECK_IDS) {
        if (deliveryError && changes.includes(id)) {
            // Not told, so not changed: the next run sees the same change and tries again.
            if (previous[id]) checks[id] = previous[id];
            continue;
        }
        const status = statusOf(id);
        checks[id] = {
            status,
            since: previous[id]?.status === status && previous[id]?.since ? previous[id].since : at,
            detail: results[id].ok ? null : String(results[id].detail || '').slice(0, 300),
        };
    }
    await settings.replaceSettings({ watch: { lastRunAt: at, checks, lastDeliveryError: deliveryError } });
    return { checks, changes, deliveryError };
}

exports.watchAiAndBlog = onSchedule({
    // Clear of the blog's :15, so a probe never competes with an article for quota.
    schedule: '40 * * * *',
    timeZone: TIMEZONE,
    timeoutSeconds: 300,
    memory: '256MiB',
    // The legacy Groq binding, so the probe sees the fallback production does.
    secrets: ['GROQ_API_KEY'],
}, async () => {
    const outcome = await runWatch();
    // Statuses and change ids only: no message text, token or chat.
    const summary = outcome.skipped
        || CHECK_IDS.map((id) => `${id}=${outcome.checks[id]?.status || 'unchanged'}`).join(' ');
    console.log(`[ops/watcher] ${summary}${outcome.deliveryError ? ` delivery=${outcome.deliveryError}` : ''}`);
});

module.exports.runWatch = runWatch;
module.exports.LANES = LANES;
module.exports.CHECK_IDS = CHECK_IDS;
module.exports.describeFailure = describeFailure;
