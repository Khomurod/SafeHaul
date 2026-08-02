const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { checkRateLimit } = require('./shared/rateLimiter');

const TELEGRAM_BOT_TOKEN = defineSecret('LANDING_TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('LANDING_TELEGRAM_CHAT_ID');

const ALLOWED_ORIGINS = new Set([
    'https://safehaul.io',
    'https://www.safehaul.io',
    'https://safehaul-landing-production.web.app',
    'https://safehaul-landing-testing.web.app',
]);

const COMPANY_SIZES = new Set(['1-10', '11-50', '51-200', '201+']);
const PRIMARY_GOALS = new Set(['ATS', 'Compliance', 'E-Docs', 'PEV', 'Other']);

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

function validateLead(body) {
    const lead = {
        fullName: cleanText(body?.fullName, 100),
        workEmail: cleanText(body?.workEmail, 254).toLowerCase(),
        companyName: cleanText(body?.companyName, 150),
        companySize: cleanText(body?.companySize, 20),
        phone: cleanText(body?.phone, 40),
        primaryGoal: cleanText(body?.primaryGoal, 40),
        website: cleanText(body?.website, 200),
    };

    if (lead.website) return { bot: true, lead: null };
    if (!lead.fullName || !lead.companyName) return { error: 'Required fields are missing.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.workEmail)) return { error: 'A valid work email is required.' };
    if (!COMPANY_SIZES.has(lead.companySize)) return { error: 'Company size is not valid.' };
    if (!PRIMARY_GOALS.has(lead.primaryGoal)) return { error: 'Primary goal is not valid.' };

    return { bot: false, lead };
}

function buildTelegramMessage(lead) {
    return [
        'New lead from safehaul.io',
        '',
        `Name: ${lead.fullName}`,
        `Work email: ${lead.workEmail}`,
        `Company: ${lead.companyName}`,
        `Company size: ${lead.companySize}`,
        `Phone: ${lead.phone || 'Not provided'}`,
        `Primary goal: ${lead.primaryGoal}`,
        `Submitted: ${new Date().toISOString()}`,
    ].join('\n');
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

    const validated = validateLead(req.body);
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });
    if (validated.bot) return res.status(200).json({ ok: true });

    const sourceAddress = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const addressHash = crypto.createHash('sha256').update(sourceAddress).digest('hex').slice(0, 48);
    const rateLimit = dependencies.checkRateLimit || checkRateLimit;
    const allowed = await rateLimit(`landing-lead:${addressHash}`, 5, 60 * 60, 'closed');
    if (!allowed) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });

    const token = String(dependencies.token || TELEGRAM_BOT_TOKEN.value() || '').trim();
    const chatId = String(dependencies.chatId || TELEGRAM_CHAT_ID.value() || '').trim();
    if (!token || !chatId) {
        console.error('[submitLandingLead] Telegram delivery is not configured.');
        return res.status(503).json({ ok: false, error: 'Lead delivery is temporarily unavailable.' });
    }

    const fetchImpl = dependencies.fetchImpl || global.fetch;
    try {
        const telegramResponse = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: buildTelegramMessage(validated.lead),
            }),
        });

        if (!telegramResponse.ok) {
            console.error(`[submitLandingLead] Telegram returned HTTP ${telegramResponse.status}.`);
            return res.status(502).json({ ok: false, error: 'Lead delivery failed.' });
        }
    } catch (error) {
        console.error('[submitLandingLead] Telegram request failed.', error?.message || 'Unknown error');
        return res.status(502).json({ ok: false, error: 'Lead delivery failed.' });
    }

    return res.status(200).json({ ok: true });
}

exports.submitLandingLead = onRequest({
    region: 'us-central1',
    invoker: 'public',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
    maxInstances: 3,
    timeoutSeconds: 20,
}, (req, res) => handleLandingLead(req, res));

exports._test = {
    ALLOWED_ORIGINS,
    buildTelegramMessage,
    cleanText,
    handleLandingLead,
    validateLead,
};
