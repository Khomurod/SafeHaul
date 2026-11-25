/**
 * The contact form on the public site's home page (`web/index.html`), posted to
 * `/api/contact`, which both `landing-*` Hosting targets rewrite to
 * `submitWebsiteLead`.
 *
 * Built fresh, as `docs/FIREBASE_HOSTING_RUNBOOK.md` ("Landing lead form
 * security") requires: nothing here comes from the retired `submitLandingLead`.
 * That section's bar is what this meets:
 *
 * - only the public site's own origins, and only a POST of JSON (the page's
 *   script) or of a plain form (the same page with JavaScript off);
 * - every field checked for presence, length and shape, the fleet size against
 *   a fixed list;
 * - a honeypot field a person never sees (named so autofill leaves it alone):
 *   filled, the request is answered as a success and nothing is stored or sent;
 * - two fail-closed rate limits, one per address and one for the whole site, so
 *   a flood from many addresses still cannot fill the collection or the
 *   operator's chat. The per-address limit counts by a short hash that thousands
 *   of addresses share, so what it stores cannot be turned back into an address;
 * - no lead detail in any log line: only codes.
 *
 * **The lead is written first and the operator is told second**, the ordering
 * `landing/leads.js` records: a Telegram outage then costs a message, never a
 * customer. The message goes to the chat connected for operator alerts (Super
 * Admin → System Health, `ops/alertSettings.js`) through the alerts bot; with no
 * chat connected the lead is stored as "Not sent". Super Admin → Website Leads
 * lists every lead either way.
 */

const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { admin, db } = require('../firebaseAdmin');
const { checkRateLimit } = require('../shared/rateLimiter');
const { trustedClientIp } = require('../shared/clientIp');
const { isValidEmail } = require('../shared/isValidEmail');
const alertSettings = require('../ops/alertSettings');
const telegram = require('../ops/telegram');
const { LEADS_COLLECTION } = require('./leads');

/** Every address each public site answers on, and which site it is. */
const ALLOWED_ORIGINS = new Map([
    ['https://safehaul.io', 'safehaul.io'],
    ['https://www.safehaul.io', 'safehaul.io'],
    ['https://safehaul-landing-production.web.app', 'safehaul.io'],
    ['https://safehaul-landing-production.firebaseapp.com', 'safehaul.io'],
    ['https://safehaul-landing-testing.web.app', 'testing'],
    ['https://safehaul-landing-testing.firebaseapp.com', 'testing'],
]);

/** The hidden field only a script fills in. */
const HONEYPOT = 'leave_this_empty';

const FLEET_SIZES = new Set(['1-10', '11-50', '51-200', '200+']);

/** The page's `maxlength` values: a longer value did not come from the page. */
const MAX_LENGTH = Object.freeze({
    fullName: 80,
    workEmail: 120,
    companyName: 120,
    phone: 30,
    message: 1000,
});

const PER_ADDRESS = Object.freeze({ limit: 5, windowSeconds: 60 * 60 });
const SITE_WIDE = Object.freeze({ limit: 60, windowSeconds: 60 * 60 });

/** Where the page without JavaScript lands: `:target` shows the matching note. */
const PLAIN_FORM_SENT = '/#contact-sent';
const PLAIN_FORM_FAILED = '/#contact-failed';

class LeadRefused extends Error {
    constructor(status, message, field = null) {
        super(message);
        this.status = status;
        this.field = field;
    }
}

function header(req, name) {
    if (typeof req.get === 'function') return req.get(name);
    return req.headers?.[name.toLowerCase()];
}

/** Every control character becomes a space, except the ones `keep` names. */
function withoutControls(value, keep = '') {
    return [...value].map((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 || code === 127) && !keep.includes(character) ? ' ' : character;
    }).join('');
}

/** One line: control characters become spaces, runs of space collapse. */
function oneLine(value) {
    if (typeof value !== 'string') return '';
    return withoutControls(value).replace(/\s+/g, ' ').trim();
}

/** A message keeps its line breaks, at most two in a row, and nothing else below a space. */
function paragraphs(value) {
    if (typeof value !== 'string') return '';
    return withoutControls(value.replace(/\r\n?/g, '\n'), '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function capped(value, field, label) {
    if (value.length > MAX_LENGTH[field]) {
        throw new LeadRefused(400, `Please shorten your ${label}.`, field);
    }
    return value;
}

/**
 * A raw answer may run past its limit only by spaces and line breaks that
 * collapse. One longer than that is refused before it is copied: a request may
 * carry megabytes, and normalizing them would cost the instance its memory
 * before any limit ran.
 */
const RAW_SLACK = 4;

function bounded(value, field, label) {
    if (typeof value === 'string' && value.length > MAX_LENGTH[field] * RAW_SLACK) {
        throw new LeadRefused(400, `Please shorten your ${label}.`, field);
    }
    return value;
}

/** Whether the honeypot holds anything but space, without copying it. */
function filledIn(value) {
    return typeof value === 'string' && /\S/.test(value);
}

/**
 * The answers, checked; refuses the first one that is missing or malformed,
 * naming its field so the page can put the message beside it.
 */
function readLead(body) {
    const fullName = capped(oneLine(bounded(body.fullName, 'fullName', 'name')), 'fullName', 'name');
    if (!fullName) throw new LeadRefused(400, 'Please enter your name.', 'fullName');

    const workEmail = capped(oneLine(bounded(body.workEmail, 'workEmail', 'email address')).toLowerCase(), 'workEmail', 'email address');
    if (!isValidEmail(workEmail)) throw new LeadRefused(400, 'Please enter a valid email address.', 'workEmail');

    const companyName = capped(oneLine(bounded(body.companyName, 'companyName', 'company name')), 'companyName', 'company name');
    if (!companyName) throw new LeadRefused(400, 'Please enter your company name.', 'companyName');

    const phone = capped(oneLine(bounded(body.phone, 'phone', 'phone number')), 'phone', 'phone number');
    if (phone && (!/^[0-9+().\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
        throw new LeadRefused(400, 'Please enter a valid phone number, or leave it empty.', 'phone');
    }

    // Every choice is a few characters; anything longer is not one of them.
    const fleetSize = typeof body.fleetSize === 'string' && body.fleetSize.length <= 20 ? oneLine(body.fleetSize) : '';
    if (!FLEET_SIZES.has(fleetSize)) throw new LeadRefused(400, 'Please choose the number of drivers.', 'fleetSize');

    const message = capped(paragraphs(bounded(body.message, 'message', 'message')), 'message', 'message');

    return { fullName, workEmail, companyName, phone: phone || null, fleetSize, message: message || null };
}

/**
 * Plain text (the alerts bot sends no markup), one fact per line. The visitor's
 * message comes last and every line of it is quoted with "> ", so a line typed
 * to look like "Email: …" cannot pass for one of the facts above it.
 */
function operatorMessage(lead, site) {
    return [
        site === 'testing' ? 'New request from the TESTING public site' : 'New request from safehaul.io',
        '',
        `Name: ${lead.fullName}`,
        `Email: ${lead.workEmail}`,
        `Company: ${lead.companyName}`,
        `Drivers: ${lead.fleetSize}`,
        `Phone: ${lead.phone || 'not given'}`,
        '',
        'Every request: Super Admin → Website Leads.',
        '',
        ...(lead.message ? ['Message:', ...lead.message.split('\n').map((line) => `> ${line}`)] : ['Message: none']),
    ].join('\n');
}

/**
 * Tells the operator's alert chat. Returns a value-free outcome: a status the
 * Website Leads screen already shows, and a code, never an error's text, which
 * could carry the bot's URL.
 */
async function notifyOperator(lead, site, deps) {
    try {
        const saved = await deps.alertSettings.readSettings();
        const chatId = saved.telegram?.chatId;
        if (chatId === undefined || chatId === null) return { status: 'disabled', code: 'no_chat' };
        const token = await deps.alertSettings.readBotToken();
        if (!token) return { status: 'disabled', code: 'no_token' };
        await deps.telegram.sendMessage(token, chatId, operatorMessage(lead, site), deps.telegramDeps);
        return { status: 'delivered', code: null };
    } catch (error) {
        return { status: 'failed', code: typeof error?.code === 'string' ? error.code.slice(0, 40) : 'unavailable' };
    }
}

/**
 * The visitor must get their answer inside the function's 30 s, or a retry
 * would store the lead twice. Everything is measured from the request's start:
 * the answer goes by 26 s (`budget`). Once the lead is stored, telling the chat
 * (settings, the bot token, one send that gives up after 10 s) gets at most
 * 12 s, and recording how that went at most 4 s, each cut short by what the
 * limits and the store already used. Past either the lead stays as stored.
 */
const TIMING_MS = Object.freeze({ budget: 26000, notify: 12000, record: 4000 });
const TOO_LATE = Object.freeze({ status: 'failed', code: 'deadline' });

/** `work`'s result, or `late` once `ms` pass first. */
function withinDeadline(work, ms, late) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(late), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function defaultDeps() {
    return {
        db,
        serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
        checkRateLimit,
        alertSettings,
        telegram,
        telegramDeps: undefined,
        timing: TIMING_MS,
        now: () => Date.now(),
    };
}

/**
 * The per-address limit's key: 5 hex digits (20 bits) of a hash, so every key is
 * shared by thousands of IPv4 addresses and none can be worked back to one.
 * Two real visitors meeting on a key within the hour is rare, and then they
 * share the five requests.
 */
function addressKey(req) {
    return crypto.createHash('sha256').update(`website-lead:${trustedClientIp(req)}`).digest('hex').slice(0, 5);
}

/** The answer: JSON for the page's script, a redirect for a plain form post. */
function answer(res, plainForm, status, body) {
    if (plainForm) {
        res.set('Location', status === 200 ? PLAIN_FORM_SENT : PLAIN_FORM_FAILED);
        return res.status(303).end();
    }
    return res.status(status).json(body);
}

async function handleWebsiteLead(req, res, overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };
    const answerBy = deps.now() + deps.timing.budget;
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
        res.set('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }
    const contentType = String(header(req, 'content-type') || '').toLowerCase();
    const plainForm = contentType.startsWith('application/x-www-form-urlencoded');
    const site = ALLOWED_ORIGINS.get(header(req, 'origin'));
    if (!site) return answer(res, plainForm, 403, { ok: false, error: 'Origin not allowed.' });
    if (!plainForm && !contentType.startsWith('application/json')) {
        return res.status(415).json({ ok: false, error: 'Unsupported content type.' });
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

    let lead;
    try {
        lead = readLead(body);
    } catch (error) {
        if (!(error instanceof LeadRefused)) throw error;
        return answer(res, plainForm, error.status, { ok: false, error: error.message, field: error.field });
    }

    // A filled honeypot is a script: answered exactly like a person, so it learns nothing.
    if (filledIn(body[HONEYPOT])) return answer(res, plainForm, 200, { ok: true });

    const tooMany = { ok: false, error: 'Too many requests right now. Please email info@safehaul.io instead.' };
    if (!(await deps.checkRateLimit(`website_lead_${addressKey(req)}`, PER_ADDRESS.limit, PER_ADDRESS.windowSeconds, 'closed'))) {
        return answer(res, plainForm, 429, tooMany);
    }
    if (!(await deps.checkRateLimit('website_lead_all', SITE_WIDE.limit, SITE_WIDE.windowSeconds, 'closed'))) {
        console.warn('[submitWebsiteLead] the site-wide limit refused a request.');
        return answer(res, plainForm, 429, tooMany);
    }

    const ref = deps.db.collection(LEADS_COLLECTION).doc();
    try {
        await ref.set({
            fullName: lead.fullName,
            workEmail: lead.workEmail,
            companyName: lead.companyName,
            companySize: lead.fleetSize,
            phone: lead.phone,
            message: lead.message,
            primaryGoal: null,
            stage: 'qualified',
            source: 'home_page_form',
            sourcePage: '/',
            sourceSite: site,
            delivery: { status: 'pending', code: null, attempts: 0 },
            createdAt: deps.serverTimestamp(),
        });
    } catch (error) {
        console.error(`[submitWebsiteLead] the lead could not be stored: ${error?.code || 'unknown'}`);
        return answer(res, plainForm, 503, { ok: false, error: 'We could not send your request. Please try again, or email info@safehaul.io.' });
    }

    // Stored, so the visitor hears ok whatever happens next, inside the budget.
    const notifyMs = Math.min(deps.timing.notify, answerBy - deps.now() - deps.timing.record);
    const outcome = notifyMs > 0
        ? await withinDeadline(notifyOperator(lead, site, deps), notifyMs, TOO_LATE)
        : TOO_LATE;
    if (outcome.status !== 'delivered') console.warn(`[submitWebsiteLead] lead ${ref.id} not delivered: ${outcome.code}`);
    const recordMs = Math.min(deps.timing.record, answerBy - deps.now());
    // Not recorded leaves only the delivery badge at "Pending".
    const recorded = recordMs > 0
        ? await withinDeadline(
            ref.update({ delivery: { status: outcome.status, code: outcome.code, attempts: 1 } })
                .then(() => null, (error) => error?.code || 'unknown'),
            recordMs,
            'deadline',
        )
        : 'deadline';
    if (recorded) console.error(`[submitWebsiteLead] delivery of ${ref.id} not recorded: ${recorded}`);
    return answer(res, plainForm, 200, { ok: true });
}

exports.submitWebsiteLead = onRequest({
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 5,
}, (req, res) => handleWebsiteLead(req, res));

exports.__test = {
    handleWebsiteLead,
    readLead,
    operatorMessage,
    notifyOperator,
    ALLOWED_ORIGINS,
    HONEYPOT,
    FLEET_SIZES,
    MAX_LENGTH,
    RAW_SLACK,
    TIMING_MS,
    PER_ADDRESS,
    SITE_WIDE,
};
