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
 * - **failing**, within the hour of the router recording a new failure in one
 *   of its lanes (`laneHealth`, begun at `laneFailedAt`), whether a driver's
 *   request or the hourly watcher found it; then at most every 6 hours while
 *   the last check still found the lane failing.
 *
 * Only enabled, configured, unretired providers, and only the lanes they already
 * serve: the check never adds a provider, enables one or changes the order.
 *
 * ## What it changes
 *
 * `../ai/tasks/modelCheck.js` decides each lane's list; this job saves it into
 * the provider's config (`modelLists`), where the router reads it, and records
 * what it found (`modelCheck`) for the console. With auto-select switched off
 * (`ai_routing_config/modelCheck.autoSelect === false`, read again just before
 * saving, so a run already under way obeys it) it only reports what it would
 * change. It tells the owner in Telegram when there is news
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
const { notesFor, composeMessage, LANE_WORDS } = require('./modelRefreshMessages');
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
    const failing = Object.entries(config.laneHealth || {})
        .filter(([, health]) => health && health !== 'healthy')
        .map(([lane]) => lane);
    if (failing.length === 0) return null;
    // A failure that began after the last check is looked at within the hour; one
    // that the last check already saw, at most every 6 hours while that check
    // still found the lane failing. Only the router's own answers reset
    // `laneHealth`, so a provider it has not asked since would read as failing
    // for good; a lane the check passed (or an operator chose) waits for the day.
    const newSinceCheck = failing.some((lane) => Number(config.laneFailedAt?.[lane]) > lastAny);
    if (!Number.isFinite(lastAny) || newSinceCheck) return 'failing';
    const stillFailing = failing.some((lane) => !['ok', 'skipped'].includes(check.lanes?.[lane]?.status));
    return stillFailing && now - lastAny >= 6 * HOUR_MS ? 'failing' : null;
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

/** Whether changes are applied, whether a run holds the lease, and when the last one ended: for the console. */
async function readCheckState(now = Date.now()) {
    const snapshot = await SETTINGS_REF().get();
    const stored = snapshot.exists ? snapshot.data() || {} : {};
    return {
        autoSelect: stored.autoSelect !== false,
        running: Number(stored.leaseUntil) > now,
        lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : null,
    };
}

/**
 * Whether changes are applied, read again as a run saves: the switch may have
 * moved while its providers were being checked. The run's own reading stands
 * when the setting cannot be read.
 */
async function autoSelectNow(fallback) {
    try {
        const snapshot = await SETTINGS_REF().get();
        return (snapshot.exists ? snapshot.data() || {} : {}).autoSelect !== false;
    } catch (error) {
        console.error(`[ops/modelRefresh] auto-select read failed code=${error?.code || 'unknown'}`);
        return fallback;
    }
}

/** Off keeps every list as it is now, a run under way included; nothing is put back. On applies from the next check. */
async function setAutoSelect(enabled) {
    await SETTINGS_REF().set({ autoSelect: enabled === true }, { merge: true });
}

/** Whether a provider's credentials let the check run: all present, all readable. */
function credentialsReady(credentials) {
    return Boolean(credentials?.complete) && (credentials.unreadable || []).length === 0;
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
        if (!credentialsReady(credentials)) continue;
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
        if (apply) modelLists[lane] = { models: result.models, verifiedAt: at, seed: result.seed };
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

/** At most this many undelivered list changes are kept per provider for the next message. */
const MAX_PENDING_NEWS = 4;

/**
 * The chat the owner is told in, read once per run: its id, and a key that
 * changes when a chat is connected again. Null with none connected, or when the
 * settings cannot be read: then nothing is sent and nothing is marked as told.
 */
async function readDestination() {
    try {
        const saved = await settings.readSettings();
        const chatId = saved.telegram?.chatId;
        if (chatId === undefined || chatId === null) return null;
        return { chatId, key: String(saved.telegram.connectedAt || 'connected') };
    } catch (error) {
        console.error(`[ops/modelRefresh] settings read failed code=${error?.code || 'unknown'}`);
        return null;
    }
}

/**
 * What this chat was last told. A chat connected since then starts from "all
 * well", as the watcher's does, so it hears anything still wrong. Every key is
 * kept, at its "all well" value, because the record is merged: a key left out
 * would keep what an earlier chat was told. A lane is "ok"; the account and a
 * suggestion are nothing.
 */
function toldTo(stored, destination) {
    if ((stored.destination || null) === (destination?.key || null)) return stored;
    return Object.fromEntries(Object.keys(stored)
        .filter((key) => key !== 'destination')
        .map((key) => [key, LANE_WORDS[key] ? 'ok' : null]));
}

/** Sends the run's news. True when there was nothing to send, or it arrived. */
async function deliver(lines, destination, telegramDeps) {
    const text = composeMessage(lines);
    if (!text) return true;
    if (!destination) return false;
    try {
        const token = await settings.readBotToken();
        if (!token) return false;
        await telegram.sendMessage(token, destination.chatId, text, telegramDeps);
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
        const autoSelect = await autoSelectNow(lease.autoSelect);
        const destination = await readDestination();
        const lines = [];
        const outcomes = [];
        let errors = 0;
        for (const item of checked) {
            if (!item.check) {
                summary.push(`${item.provider.id}=error`);
                errors += 1;
                continue;
            }
            const record = recordFor(item, { autoSelect, at });
            const stored = item.config.modelCheck?.notified || {};
            const pending = (item.config.modelCheck?.pendingNews || []).filter((line) => typeof line === 'string');
            // A change is news only once applied; with auto-select off it is a suggestion.
            const lanes = Object.fromEntries(Object.entries(item.check.lanes).map(([lane, result]) => [lane, {
                ...result,
                changed: autoSelect && Boolean(result.changed),
                suggested: record.modelCheck.lanes[lane].suggested,
            }]));
            const notes = notesFor({
                name: item.provider.displayName,
                check: { account: item.check.account, lanes },
                notified: toldTo(stored, destination),
            });
            lines.push(...pending, ...notes.lines);
            outcomes.push({ item, record, stored, pending, notes });
            summary.push(`${item.provider.id}=${Object.entries(item.check.lanes).map(([lane, result]) => `${lane}:${result.status}`).join(',') || item.check.account || 'none'}`);
        }

        const delivered = await deliver(lines, destination, deps.telegramDeps);
        for (const { item, record, stored, pending, notes } of outcomes) {
            // Not told, so not marked as told: the next check sees the same states
            // and tries again. A list change it cannot see again waits in `pendingNews`.
            record.modelCheck.notified = delivered ? { ...notes.notified, destination: destination?.key || null } : stored;
            record.modelCheck.pendingNews = delivered ? [] : [...pending, ...notes.news].slice(-MAX_PENDING_NEWS);
            await saveModelCheck(item.provider.id, record);
        }
        return { checked: summary, errors, delivered, messageLines: lines.length };
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
module.exports.readCheckState = readCheckState;
module.exports.setAutoSelect = setAutoSelect;
module.exports.credentialsReady = credentialsReady;
