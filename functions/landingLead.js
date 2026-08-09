/**
 * Public lead intake for the safehaul.io marketing site.
 *
 * ## Shape of the endpoint
 *
 * One POST endpoint, three accepted payloads:
 *
 *  - `step: 1` — name and work email. Creates the lead, notifies Telegram, and
 *    returns an opaque `reference`.
 *  - `step: 2` — the reference plus qualification fields. Completes the lead and
 *    sends an enrichment message.
 *  - no `step` — the original single-shot payload, still accepted so an older
 *    cached copy of the marketing page keeps working after this deploys.
 *
 * ## Why step one writes before it notifies
 *
 * The previous implementation forwarded to Telegram and stored nothing, so a
 * Telegram outage returned 502 and destroyed the lead. Now the record is written
 * first and delivery failure is recorded against it, which makes the outcome
 * recoverable from Super Admin → Landing Page Settings.
 *
 * Splitting the form is the same idea applied to human behaviour: the visitor
 * who abandons at the qualification questions has already been captured.
 *
 * ## Defences, all retained from the original
 *
 * Origin allowlist, POST-only, JSON-only, control-character stripping, length
 * caps, enum validation, a honeypot field that reports success while doing
 * nothing, and a fail-closed per-IP rate limit over a hashed address. The raw IP
 * is never stored.
 *
 * ## Credentials
 *
 * Telegram credentials are resolved by `landing/config.js` — the encrypted
 * Firestore configuration first, the `LANDING_TELEGRAM_*` Secret Manager values
 * as fallback. Neither the token nor any part of it is logged here or returned
 * in any response.
 */

const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { checkRateLimit } = require('./shared/rateLimiter');
const landingConfig = require('./landing/config');
const landingLeads = require('./landing/leads');
const telegram = require('./landing/telegram');

const TELEGRAM_BOT_TOKEN = defineSecret('LANDING_TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('LANDING_TELEGRAM_CHAT_ID');
// Decrypts the operator-managed Telegram credentials. Shared with the SMS
// integration rather than introducing a second key to rotate.
const SMS_ENCRYPTION_KEY = defineSecret('SMS_ENCRYPTION_KEY');

const ALLOWED_ORIGINS = new Set([
    'https://safehaul.io',
    'https://www.safehaul.io',
    'https://safehaul-landing-production.web.app',
    'https://safehaul-landing-testing.web.app',
]);

const COMPANY_SIZES = new Set(['1-10', '11-50', '51-200', '201+']);
const PRIMARY_GOALS = new Set(['ATS', 'Compliance', 'E-Docs', 'PEV', 'Other']);

/** Step one is the write path, so it keeps the original tight budget. */
const STEP_ONE_LIMIT = 5;
/** Step two only completes a record step one already authorised. */
const STEP_TWO_LIMIT = 15;
const RATE_WINDOW_SECONDS = 60 * 60;

function header(req, name) {
    if (typeof req.get === 'function') return req.get(name);
    return req.headers?.[name.toLowerCase()];
}

function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    const withoutControls = [...value]
        .map((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? ' ' : character;
        })
        .join('');
    return withoutControls.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Attribution fields. Length-capped like everything else a stranger can send. */
function readContext(body, addressHash) {
    return {
        sourceAddressHash: addressHash,
        sourcePage: cleanText(body?.sourcePage, 200) || null,
        referrer: cleanText(body?.referrer, 300) || null,
        utmSource: cleanText(body?.utmSource, 80) || null,
        utmMedium: cleanText(body?.utmMedium, 80) || null,
        utmCampaign: cleanText(body?.utmCampaign, 120) || null,
    };
}

/** Step one: the two fields that make a lead contactable. */
function validateContact(body) {
    const contact = {
        fullName: cleanText(body?.fullName, 100),
        workEmail: cleanText(body?.workEmail, 254).toLowerCase(),
        website: cleanText(body?.website, 200),
    };

    if (contact.website) return { bot: true, contact: null };
    if (!contact.fullName) return { error: 'Your name is required.' };
    if (!isValidEmail(contact.workEmail)) return { error: 'A valid work email is required.' };

    return { bot: false, contact: { fullName: contact.fullName, workEmail: contact.workEmail } };
}

/** Step two: the qualification answers. Every enum is checked against a set. */
function validateQualification(body) {
    const qualification = {
        companyName: cleanText(body?.companyName, 150),
        companySize: cleanText(body?.companySize, 20),
        phone: cleanText(body?.phone, 40),
        primaryGoal: cleanText(body?.primaryGoal, 40),
    };

    if (!qualification.companyName) return { error: 'Company name is required.' };
    if (!COMPANY_SIZES.has(qualification.companySize)) return { error: 'Fleet size is not valid.' };
    if (!PRIMARY_GOALS.has(qualification.primaryGoal)) return { error: 'Primary goal is not valid.' };

    return { qualification };
}

/** The original all-at-once payload, kept working for cached pages. */
function validateLead(body) {
    const contact = validateContact(body);
    if (contact.error) return { error: contact.error };
    if (contact.bot) return { bot: true, lead: null };

    const qualified = validateQualification(body);
    if (qualified.error) return { error: qualified.error };

    return { bot: false, lead: { ...contact.contact, ...qualified.qualification } };
}

/**
 * Collapses the injectable seams into one object.
 *
 * The stores and the transport are injected rather than imported directly by
 * the handlers so the unit suite can exercise every branch without Firestore or
 * a network call. Defaults are the real modules, so production wiring is
 * unchanged by the seam's existence.
 */
function resolveDeps(dependencies = {}) {
    return {
        checkRateLimit: dependencies.checkRateLimit || checkRateLimit,
        leads: dependencies.leads || landingLeads,
        config: dependencies.config || landingConfig,
        transport: dependencies.transport || telegram,
        fetchImpl: dependencies.fetchImpl,
        // Deploy-time fallback credentials. Read lazily: `.value()` throws
        // outside a bound function invocation, which is exactly the situation
        // the unit suite runs in.
        fallback: () => ({
            botToken: dependencies.token !== undefined ? dependencies.token : safeSecret(TELEGRAM_BOT_TOKEN),
            chatId: dependencies.chatId !== undefined ? dependencies.chatId : safeSecret(TELEGRAM_CHAT_ID),
        }),
    };
}

/** Reads a bound secret, tolerating an unbound context. */
function safeSecret(param) {
    try {
        return param.value() || '';
    } catch {
        return '';
    }
}

/**
 * Resolves credentials and sends one message.
 *
 * Returns a value-free outcome. The token is read into a local, used once, and
 * never passed to a logger.
 */
async function deliver(buildMessage, deps) {
    const config = await deps.config.readTelegramConfig(deps.fallback());

    if (!config.enabled || !config.botToken || !config.chatId) {
        console.error('[submitLandingLead] Telegram delivery is not configured.');
        return { ok: false, code: 'not-configured' };
    }

    const outcome = await deps.transport.sendMessage(
        config.botToken,
        config.chatId,
        buildMessage(),
        deps.fetchImpl,
    );

    if (!outcome.ok) {
        // `outcome.code` is one of the hand-written classifications in
        // telegram.js — never a raw error, which would carry the token URL.
        console.error('[submitLandingLead] Telegram delivery failed.', { code: outcome.code });
    }
    await deps.config.recordDeliveryOutcome(outcome.ok ? 'delivered' : 'failed', outcome.code);
    return outcome;
}

/** Maps a delivery outcome onto the stored lead. */
async function settleDelivery(leadId, outcome, deps) {
    const status = outcome.ok
        ? landingLeads.DELIVERY_STATUS.DELIVERED
        : (outcome.code === 'not-configured'
            ? landingLeads.DELIVERY_STATUS.DISABLED
            : landingLeads.DELIVERY_STATUS.FAILED);
    await deps.leads.recordDelivery(leadId, status, outcome.code);
}

async function handleLandingLead(req, res, dependencies = {}) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

    const origin = header(req, 'origin');
    if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: 'Origin is not allowed.' });

    if (!String(header(req, 'content-type') || '').toLowerCase().startsWith('application/json')) {
        return res.status(415).json({ ok: false, error: 'JSON is required.' });
    }

    const sourceAddress = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const addressHash = crypto.createHash('sha256').update(sourceAddress).digest('hex').slice(0, 48);
    const deps = resolveDeps(dependencies);
    const context = { addressHash, rateLimit: deps.checkRateLimit, deps };

    const step = Number(req.body?.step);

    if (step === 2) return handleStepTwo(req, res, context);
    if (step === 1) return handleStepOne(req, res, context);
    return handleSingleStep(req, res, context);
}

/** Step one: create the lead and notify. */
async function handleStepOne(req, res, { addressHash, rateLimit, deps }) {
    const validated = validateContact(req.body);
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });

    if (validated.bot) {
        // Indistinguishable from a real success, including the reference shape,
        // so a scripted submitter learns nothing from the response.
        return res.status(200).json({ ok: true, reference: `${crypto.randomBytes(10).toString('hex')}.${crypto.randomBytes(32).toString('hex')}` });
    }

    const allowed = await rateLimit(`landing-lead:${addressHash}`, STEP_ONE_LIMIT, RATE_WINDOW_SECONDS, 'closed');
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });

    const attribution = readContext(req.body, addressHash);

    let created;
    try {
        created = await deps.leads.createLead(validated.contact, attribution);
    } catch (error) {
        console.error('[submitLandingLead] lead could not be stored.', { message: error?.message || 'unknown' });
        return res.status(503).json({ ok: false, error: 'We could not record your details. Please try again.' });
    }

    const outcome = await deliver(
        () => deps.transport.buildNewLeadMessage(validated.contact, attribution),
        deps,
    );
    await settleDelivery(created.leadId, outcome, deps);

    // The lead is safely stored, so a delivery failure is not the visitor's
    // problem and must not be shown to them as one.
    return res.status(200).json({ ok: true, reference: created.reference });
}

/** Step two: attach qualification to an existing lead. */
async function handleStepTwo(req, res, { addressHash, rateLimit, deps }) {
    const validated = validateQualification(req.body);
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });

    const allowed = await rateLimit(`landing-lead-step2:${addressHash}`, STEP_TWO_LIMIT, RATE_WINDOW_SECONDS, 'closed');
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });

    let completion;
    try {
        completion = await deps.leads.completeLead(req.body?.reference, validated.qualification);
    } catch (error) {
        console.error('[submitLandingLead] qualification could not be stored.', { message: error?.message || 'unknown' });
        return res.status(200).json({ ok: true });
    }

    if (!completion.ok) {
        // Answered as success on purpose. Distinguishing "wrong token" from
        // "expired" from "already used" would turn this endpoint into an oracle,
        // and the contact details were already captured at step one, so there is
        // nothing for the visitor to retry.
        console.warn('[submitLandingLead] qualification not applied.', { reason: completion.reason });
        return res.status(200).json({ ok: true });
    }

    const outcome = await deliver(() => deps.transport.buildQualifiedLeadMessage(completion.lead), deps);
    await settleDelivery(completion.leadId, outcome, deps);

    return res.status(200).json({ ok: true });
}

/** The original payload: everything in one request. */
async function handleSingleStep(req, res, { addressHash, rateLimit, deps }) {
    const validated = validateLead(req.body);
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });
    if (validated.bot) return res.status(200).json({ ok: true });

    const allowed = await rateLimit(`landing-lead:${addressHash}`, STEP_ONE_LIMIT, RATE_WINDOW_SECONDS, 'closed');
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });

    let created = null;
    try {
        created = await deps.leads.createLead(
            { fullName: validated.lead.fullName, workEmail: validated.lead.workEmail },
            readContext(req.body, addressHash),
        );
        await deps.leads.completeLead(created.reference, validated.lead);
    } catch (error) {
        console.error('[submitLandingLead] lead could not be stored.', { message: error?.message || 'unknown' });
        return res.status(503).json({ ok: false, error: 'We could not record your details. Please try again.' });
    }

    const outcome = await deliver(() => deps.transport.buildQualifiedLeadMessage(validated.lead), deps);
    await settleDelivery(created.leadId, outcome, deps);

    return res.status(200).json({ ok: true });
}

exports.submitLandingLead = onRequest({
    region: 'us-central1',
    invoker: 'public',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SMS_ENCRYPTION_KEY],
    maxInstances: 3,
    timeoutSeconds: 20,
}, (req, res) => handleLandingLead(req, res));

exports._test = {
    ALLOWED_ORIGINS,
    COMPANY_SIZES,
    PRIMARY_GOALS,
    STEP_ONE_LIMIT,
    STEP_TWO_LIMIT,
    cleanText,
    handleLandingLead,
    readContext,
    validateContact,
    validateLead,
    validateQualification,
};
