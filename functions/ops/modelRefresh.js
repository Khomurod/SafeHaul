/**
 * The daily model check: each enabled provider's lanes are tested, version by
 * version, and the versions that pass become the lane's list.
 *
 * ## When a provider is checked
 *
 * The job runs every hour at :25 (Chicago) and checks a provider when it is due:
 *
 * - **daily**, at about 03:25, and at any hour once 36 hours have passed;
 * - **first**, on the first run after a provider is set up;
 * - **failing**, when the router has recorded a failure in one of its lanes
 *   (`laneHealth`), at most every 6 hours: that is "at once when something
 *   breaks", whether a driver's request or the hourly watcher found it.
 *
 * Only enabled, configured, unretired providers, and only the lanes they already
 * serve: the check never adds a provider, enables one or changes the order.
 *
 * ## What it changes
 *
 * `../ai/tasks/modelCheck.js` decides each lane's list; this job saves it into
 * the provider's config (`modelLists`), where the router reads it, and records
 * what it found (`modelCheck`) for the console. With auto-select switched off
 * (`ai_routing_config/modelCheck.autoSelect === false`) it only reports what it
 * would change. It tells the owner in Telegram when there is news
 * (`./modelRefreshMessages.js`), and works the same with no chat connected.
 *
 * A lease in `ai_routing_config/modelCheck` keeps two runs from overlapping.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');

const { db } = require('../firebaseAdmin');
const { PROVIDERS, isRetired } = require('../ai/registry/providers');
const store = require('../ai/credentials/store');
const { saveModelCheck } = require('../ai/credentials/modelLists');
const { checkProvider } = require('../ai/tasks/modelCheck');
const { TIMEZONE } = require('../blog/pipeline/themes');
const { notesFor, composeMessage } = require('./modelRefreshMessages');
const settings = require('./alertSettings');
const telegram = require('./telegram');

const HOUR_MS = 60 * 60 * 1000;
const DAILY_HOUR = 3;
/** Below the function's 540 s, with room to save and send after the last test. */
const RUN_BUDGET_MS = 400 * 1000;
const LEASE_MS = 9 * 60 * 1000;
const SETTINGS_REF = () => db.collection('ai_routing_config').doc('modelCheck');

function chicagoHour(now) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
}

/** Why this provider is due now, or null. */
function dueReason(config, now) {
    const check = config.modelCheck || {};
    const lastFull = Date.parse(check.fullCheckAt);
    const lastAny = Date.parse(check.checkedAt);
    if (!Number.isFinite(lastFull)) return 'first';
    if (now - lastFull >= 36 * HOUR_MS) return 'daily';
    if (chicagoHour(now) === DAILY_HOUR && now - lastFull >= 20 * HOUR_MS) return 'daily';
    const failing = Object.values(config.laneHealth || {}).some((health) => health && health !== 'healthy');
    if (failing && (!Number.isFinite(lastAny) || now - lastAny >= 6 * HOUR_MS)) return 'failing';
    return null;
}

/** Takes the lease, or says another run holds it. Also reads whether changes are applied. */
async function acquireLease(now) {
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(SETTINGS_REF());
        const stored = snapshot.exists ? snapshot.data() || {} : {};
        if (Number(stored.leaseUntil) > now) return null;
        transaction.set(SETTINGS_REF(), { leaseUntil: now + LEASE_MS }, { merge: true });
        return { autoSelect: stored.autoSelect !== false };
    });
}

async function releaseLease(summary) {
    await SETTINGS_REF().set({ leaseUntil: 0, lastRunAt: new Date().toISOString(), lastRunSummary: summary }, { merge: true });
}

/** The providers to check now, with what each needs. */
async function dueProviders({ now, force, providerIds, deps }) {
    const configs = await store.readAllConfigs();
    const due = [];
    for (const provider of PROVIDERS) {
        if (isRetired(provider) || (providerIds && !providerIds.includes(provider.id))) continue;
        const config = configs.get(provider.id) || { enabled: true };
        if (config.enabled === false) continue;
        const reason = force ? 'requested' : dueReason(config, now);
        if (!reason) continue;
        const credentials = await store.resolveCredentials(provider.id, deps);
        if (!credentials.complete || (credentials.unreadable || []).length > 0) continue;
        due.push({ provider, config, credentials, reason });
    }
    return due;
}

/** What to save for one provider: the changed lists, and what the check found. */
function recordFor({ check, reason, config }, { autoSelect, at }) {
    const modelLists = {};
    const lanes = {};
    for (const [lane, result] of Object.entries(check.lanes)) {
        const apply = autoSelect && result.changed;
        if (apply) modelLists[lane] = { models: result.models, verifiedAt: at };
        lanes[lane] = {
            status: result.status,
            // What the lane uses after this check, and what was found.
            models: apply || !result.changed ? result.models : result.previous,
            suggested: !autoSelect && result.changed ? result.models : null,
            results: result.results || [],
            reason: result.reason || null,
            changedAt: apply ? at : (config.modelCheck?.lanes?.[lane]?.changedAt || null),
        };
    }
    const full = reason === 'first' || reason === 'daily' || reason === 'requested';
    return {
        modelLists,
        modelCheck: {
            checkedAt: at,
            ...(full ? { fullCheckAt: at } : {}),
            reason,
            catalogue: check.catalogue,
            account: check.account || null,
            // Merged, and an empty map would replace what earlier checks found: a
            // check stopped before any lane (a refused key) leaves them as they were.
            ...(Object.keys(lanes).length > 0 ? { lanes } : {}),
        },
    };
}

/** Sends the run's news, if a chat is connected. True when there was nothing to send, or it arrived. */
async function deliver(lines, telegramDeps) {
    const text = composeMessage(lines);
    if (!text) return true;
    const saved = await settings.readSettings();
    const chatId = saved.telegram?.chatId;
    const token = chatId === undefined || chatId === null ? null : await settings.readBotToken();
    if (!token) return false;
    try {
        await telegram.sendMessage(token, chatId, text, telegramDeps);
        return true;
    } catch (error) {
        console.error(`[ops/modelRefresh] delivery failed code=${error?.code || 'unknown'}`);
        return false;
    }
}

/**
 * One run. Exported apart from the schedule so tests, and the console's
 * "check now", drive it directly.
 *
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {boolean} [options.force] check every provider now, due or not
 * @param {string[]} [options.providerIds] only these
 * @param {number} [options.budgetMs] no test starts after this long
 * @param {object} [options.deps] `{ fetchImpl, verify, sleep }` and the Telegram `fetchImpl` as `telegramDeps`
 */
async function runModelRefresh({ now = Date.now(), force = false, providerIds = null, budgetMs = RUN_BUDGET_MS, deps = {} } = {}) {
    const lease = await acquireLease(now);
    if (!lease) return { skipped: 'running' };
    const summary = [];
    try {
        const due = await dueProviders({ now, force, providerIds, deps });
        const deadlineAt = now + budgetMs;
        const checked = await Promise.all(due.map(async (item) => {
            try {
                return { ...item, check: await checkProvider({ ...item, deadlineAt, deps }) };
            } catch (error) {
                console.error(`[ops/modelRefresh] ${item.provider.id} check failed: ${error?.name || 'Error'}`);
                return { ...item, check: null };
            }
        }));

        const at = new Date(now).toISOString();
        const lines = [];
        const outcomes = [];
        for (const item of checked) {
            if (!item.check) {
                summary.push(`${item.provider.id}=error`);
                continue;
            }
            const record = recordFor(item, { autoSelect: lease.autoSelect, at });
            const told = item.config.modelCheck?.notified || {};
            // A change is news only once applied; with auto-select off it is a suggestion.
            const lanes = Object.fromEntries(Object.entries(item.check.lanes).map(([lane, result]) => [lane, {
                ...result,
                changed: lease.autoSelect && Boolean(result.changed),
                suggested: record.modelCheck.lanes[lane].suggested,
            }]));
            const notes = notesFor({ name: item.provider.displayName, check: { account: item.check.account, lanes }, notified: told });
            lines.push(...notes.lines);
            outcomes.push({ item, record, told, notified: notes.notified });
            summary.push(`${item.provider.id}=${Object.entries(item.check.lanes).map(([lane, result]) => `${lane}:${result.status}`).join(',') || item.check.account || 'none'}`);
        }

        const delivered = await deliver(lines, deps.telegramDeps);
        for (const { item, record, told, notified } of outcomes) {
            // Not told, so not changed: the next run sees the same news and tries again.
            record.modelCheck.notified = delivered ? notified : told;
            await saveModelCheck(item.provider.id, record);
        }
        return { checked: summary, delivered, messageLines: lines.length };
    } finally {
        await releaseLease(summary.join(' ') || 'nothing due');
    }
}

exports.refreshAiModelLists = onSchedule({
    // Clear of the blog's :15 and the watcher's :40.
    schedule: '25 * * * *',
    timeZone: TIMEZONE,
    timeoutSeconds: 540,
    memory: '256MiB',
    // The legacy Groq binding, as the watcher has, so Groq's credential resolves the same way.
    secrets: ['GROQ_API_KEY'],
}, async () => {
    const outcome = await runModelRefresh();
    console.log(`[ops/modelRefresh] ${outcome.skipped || outcome.checked.join(' ') || 'nothing due'}`);
});

module.exports.runModelRefresh = runModelRefresh;
module.exports.dueReason = dueReason;
module.exports.recordFor = recordFor;
