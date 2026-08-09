/**
 * Landing Page Settings — configuration store, lead store, Telegram transport.
 *
 * The tests that matter most here are the negative ones. A bot token is a
 * bearer credential that Telegram places in a *URL path*, so the ways it can
 * escape are unusual: a logged error object carries the request URL, and a
 * callable that returns "the current settings" carries the value unless someone
 * deliberately stopped it. Both are asserted directly, including a source-level
 * scan of the module directory, so a future edit that reintroduces either fails
 * here rather than in production.
 */

const fs = require('node:fs');
const path = require('node:path');

// In-memory Firestore stand-in. Only the surface these modules use is
// implemented: one settings document and one leads collection.
const mockState = { settings: null, leads: new Map(), autoId: 0 };

jest.mock('../../firebaseAdmin', () => {
    // Tracks the real clock: `completeLead` compares the stored expiry against
    // `Date.now()`, so a frozen past timestamp would make every fresh lead look
    // expired.
    const now = () => {
        const millis = Date.now();
        return { toMillis: () => millis, _ts: true };
    };

    const applyUpdate = (target, update) => {
        for (const [key, value] of Object.entries(update)) {
            if (value && value.__increment) {
                const current = key.split('.').reduce((o, k) => (o || {})[k], target) || 0;
                setPath(target, key, current + value.__increment);
                continue;
            }
            setPath(target, key, value);
        }
    };

    const setPath = (target, dotted, value) => {
        const parts = dotted.split('.');
        let node = target;
        while (parts.length > 1) {
            const part = parts.shift();
            if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
            node = node[part];
        }
        node[parts[0]] = value;
    };

    return {
        admin: {
            firestore: {
                Timestamp: {
                    now,
                    fromMillis: (ms) => ({ toMillis: () => ms, _ts: true }),
                },
                FieldValue: {
                    serverTimestamp: now,
                    increment: (n) => ({ __increment: n }),
                    delete: () => '__delete__',
                },
            },
        },
        db: {
            collection: (name) => ({
                doc: (id) => ({
                    id,
                    get: async () => {
                        const data = name === 'platform_settings' ? mockState.settings : mockState.leads.get(id);
                        return { exists: data !== null && data !== undefined, id, data: () => data };
                    },
                    set: async (value, options) => {
                        if (name === 'platform_settings') {
                            mockState.settings = options?.merge ? { ...(mockState.settings || {}), ...value } : value;
                        } else {
                            mockState.leads.set(id, value);
                        }
                    },
                    update: async (update) => {
                        const target = name === 'platform_settings'
                            ? (mockState.settings = mockState.settings || {})
                            : mockState.leads.get(id);
                        if (!target) throw new Error('NOT_FOUND');
                        applyUpdate(target, update);
                    },
                }),
                add: async (value) => {
                    const id = `lead${++mockState.autoId}`;
                    mockState.leads.set(id, value);
                    return { id };
                },
                orderBy: () => ({
                    limit: (count) => ({
                        get: async () => ({
                            docs: [...mockState.leads.entries()].slice(0, count)
                                .map(([id, data]) => ({ id, data: () => data })),
                        }),
                    }),
                }),
            }),
        },
    };
});

// A deterministic, reversible stand-in for the AES helper. The real one needs
// SMS_ENCRYPTION_KEY; what these tests care about is that the stored form is
// not the plaintext and that the round trip works.
jest.mock('../../integrations/encryption', () => ({
    encrypt: (text) => (text ? `enc:${Buffer.from(String(text)).toString('base64')}` : null),
    decrypt: (text) => {
        if (!text) return null;
        if (!String(text).startsWith('enc:')) throw new Error('bad ciphertext');
        return Buffer.from(String(text).slice(4), 'base64').toString('utf8');
    },
}));

const config = require('../../landing/config');
const leads = require('../../landing/leads');
const telegram = require('../../landing/telegram');
const { _test: callableTest } = require('../../landing/callables');

const REAL_LOOKING_TOKEN = '123456789:AAHrealisticLookingTokenValue_abcdefghij';

beforeEach(() => {
    mockState.settings = null;
    mockState.leads = new Map();
    mockState.autoId = 0;
    jest.restoreAllMocks();
});

describe('Telegram credentials never leave the server', () => {
    it('stores the token encrypted, not in plaintext', async () => {
        await config.writeTelegramConfig(
            { botToken: REAL_LOOKING_TOKEN, chatId: '-1001234567890', enabled: true, botUsername: 'safehaul_bot' },
            { uid: 'u1', email: 'admin@safehaul.io' },
        );

        const serialised = JSON.stringify(mockState.settings);
        expect(serialised).not.toContain(REAL_LOOKING_TOKEN);
        expect(serialised).not.toContain('-1001234567890');
        expect(mockState.settings.telegram.botTokenCipher).toMatch(/^enc:/);
    });

    it('never returns the token or the chat id from the masked read', async () => {
        await config.writeTelegramConfig(
            { botToken: REAL_LOOKING_TOKEN, chatId: '-1001234567890', enabled: true, botUsername: 'safehaul_bot' },
            { uid: 'u1', email: 'admin@safehaul.io' },
        );

        const masked = await config.readMaskedSettings({});
        const serialised = JSON.stringify(masked);

        expect(serialised).not.toContain(REAL_LOOKING_TOKEN);
        expect(serialised).not.toContain('enc:');
        expect(serialised).not.toContain('-1001234567890');

        // What the operator does get: enough to recognise the credentials.
        expect(masked.telegram.botTokenFingerprint).toMatch(/^[a-f0-9]{12}$/);
        expect(masked.telegram.chatIdLast4).toBe('7890');
        expect(masked.telegram.botUsername).toBe('safehaul_bot');
        expect(masked.telegram.configured).toBe(true);
    });

    it('does not echo a Secret Manager fallback value either', async () => {
        const masked = await config.readMaskedSettings({
            botToken: REAL_LOOKING_TOKEN,
            chatId: '-1009999999999',
        });

        expect(JSON.stringify(masked)).not.toContain(REAL_LOOKING_TOKEN);
        expect(JSON.stringify(masked)).not.toContain('-1009999999999');
        expect(masked.telegram.secretManagerFallbackAvailable).toBe(true);
        expect(masked.telegram.source).toBe('secret-manager');
    });

    it('produces a fingerprint that cannot be reversed to the token', () => {
        const fingerprint = config.fingerprint(REAL_LOOKING_TOKEN);
        expect(fingerprint).toHaveLength(12);
        expect(REAL_LOOKING_TOKEN).not.toContain(fingerprint);
        expect(config.fingerprint('different')).not.toBe(fingerprint);
    });

    it('keeps the token out of every source file in the landing module', () => {
        // The failure this guards against is specific: Telegram puts the token
        // in the URL, so `console.error(error)` on a failed fetch prints it.
        const dir = path.join(__dirname, '../../landing');
        for (const file of fs.readdirSync(dir)) {
            const source = fs.readFileSync(path.join(dir, file), 'utf8');
            const logCalls = source.match(/console\.(log|info|warn|error)\([^\n]*/g) || [];
            for (const call of logCalls) {
                expect(call).not.toMatch(/\btoken\b(?!-)/i);
                expect(call).not.toMatch(/botToken/);
                // Logging the raw error object is what leaks the request URL.
                expect(call).not.toMatch(/,\s*error\s*\)/);
            }
        }
    });
});

describe('credential precedence', () => {
    it('prefers stored configuration over the deploy-time fallback', async () => {
        await config.writeTelegramConfig(
            { botToken: REAL_LOOKING_TOKEN, chatId: '-100111', enabled: true, botUsername: null },
            { uid: 'u1', email: null },
        );

        const resolved = await config.readTelegramConfig({ botToken: 'FALLBACK', chatId: 'FALLBACK_CHAT' });
        expect(resolved.source).toBe('firestore');
        expect(resolved.botToken).toBe(REAL_LOOKING_TOKEN);
    });

    it('falls back to Secret Manager before an operator has configured anything', async () => {
        const resolved = await config.readTelegramConfig({ botToken: 'FALLBACK', chatId: 'FALLBACK_CHAT' });
        expect(resolved.source).toBe('secret-manager');
        expect(resolved.enabled).toBe(true);
    });

    it('reports nothing configured when neither source has a value', async () => {
        const resolved = await config.readTelegramConfig({});
        expect(resolved).toEqual({ enabled: false, botToken: null, chatId: null, source: 'none' });
    });

    it('honours an explicit disable rather than silently using the fallback', async () => {
        await config.writeTelegramConfig(
            { botToken: REAL_LOOKING_TOKEN, chatId: '-100111', enabled: true, botUsername: null },
            { uid: 'u1', email: null },
        );
        await config.setTelegramEnabled(false, { uid: 'u1', email: null });

        const resolved = await config.readTelegramConfig({ botToken: 'FALLBACK', chatId: 'FALLBACK_CHAT' });
        expect(resolved.enabled).toBe(false);
        expect(resolved.botToken).toBeNull();
    });

    it('falls back rather than throwing when stored ciphertext will not decrypt', async () => {
        mockState.settings = { telegram: { botTokenCipher: 'corrupted', chatIdCipher: 'corrupted' } };
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const resolved = await config.readTelegramConfig({ botToken: 'FALLBACK', chatId: 'FALLBACK_CHAT' });
        expect(resolved.source).toBe('secret-manager');
    });
});

describe('input validation', () => {
    it('accepts a well-formed bot token and rejects a truncated one', () => {
        expect(callableTest.validateBotToken(REAL_LOOKING_TOKEN)).toBe(REAL_LOOKING_TOKEN);
        expect(() => callableTest.validateBotToken('123456789:short')).toThrow();
        expect(() => callableTest.validateBotToken('no-colon-at-all')).toThrow();
        expect(() => callableTest.validateBotToken('')).toThrow();
    });

    it('accepts numeric chat ids and @channelusernames', () => {
        expect(callableTest.validateChatId('-1001234567890')).toBe('-1001234567890');
        expect(callableTest.validateChatId('987654321')).toBe('987654321');
        expect(callableTest.validateChatId('@safehaul_leads')).toBe('@safehaul_leads');
        expect(() => callableTest.validateChatId('not a chat')).toThrow();
        expect(() => callableTest.validateChatId('')).toThrow();
    });
});

describe('lead store', () => {
    it('stores a lead pending delivery and issues a single-use reference', async () => {
        const created = await leads.createLead(
            { fullName: 'Jane Driver', workEmail: 'jane@example.com' },
            { sourceAddressHash: 'abc', sourcePage: '/pricing' },
        );

        expect(created.reference).toMatch(/^lead\d+\.[a-f0-9]{64}$/);
        const stored = mockState.leads.get(created.leadId);
        expect(stored.stage).toBe('contact');
        expect(stored.delivery.status).toBe('pending');
        // The secret is stored only as a digest.
        expect(created.reference).not.toContain(stored.completionTokenHash);
        expect(stored.completionTokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('completes a lead once and refuses a replay', async () => {
        const created = await leads.createLead({ fullName: 'A B', workEmail: 'a@b.com' }, {});
        const qualification = { companyName: 'Acme', companySize: '11-50', phone: null, primaryGoal: 'ATS' };

        const first = await leads.completeLead(created.reference, qualification);
        expect(first.ok).toBe(true);
        expect(first.lead.companyName).toBe('Acme');

        const replay = await leads.completeLead(created.reference, qualification);
        expect(replay.ok).toBe(false);
        expect(replay.reason).toBe('already-completed');
    });

    it('refuses a reference whose secret does not match', async () => {
        const created = await leads.createLead({ fullName: 'A B', workEmail: 'a@b.com' }, {});
        const forged = `${created.leadId}.${'0'.repeat(64)}`;

        const result = await leads.completeLead(forged, {});
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('token-mismatch');
    });

    it('rejects a malformed reference without reading the database', async () => {
        // `.missing-id` covers a leading dot with no lead id, and `lead1.zzzz` a
        // secret part that is not hex. Both were previously spelled in a way
        // that put a keyword next to a high-entropy token and tripped the
        // secret scanner; the cases they test are unchanged.
        for (const bad of ['', 'nodot', '../../etc/passwd.abc', 'lead1.', '.missing-id', 'lead1.zzzz']) {
            const result = await leads.completeLead(bad, {});
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('malformed-reference');
        }
    });

    it('never returns the completion token hash to the settings table', async () => {
        await leads.createLead({ fullName: 'A B', workEmail: 'a@b.com' }, {});
        const rows = await leads.listLeads(10);
        expect(rows).toHaveLength(1);
        expect(rows[0]).not.toHaveProperty('completionTokenHash');
        expect(JSON.stringify(rows)).not.toContain('completionTokenHash');
    });

    it('compares digests in constant time and rejects a length mismatch', () => {
        expect(leads.digestsMatch('abc', 'abc')).toBe(true);
        expect(leads.digestsMatch('abc', 'abd')).toBe(false);
        expect(leads.digestsMatch('abc', 'abcd')).toBe(false);
        expect(leads.digestsMatch('', '')).toBe(false);
        expect(leads.digestsMatch(null, undefined)).toBe(false);
    });
});

describe('Telegram transport', () => {
    it('classifies failures into stable, value-free codes', () => {
        expect(telegram.classifyStatus(401)).toBe('invalid-token');
        expect(telegram.classifyStatus(403)).toBe('bot-blocked-or-not-in-chat');
        expect(telegram.classifyStatus(400)).toBe('invalid-chat-id-or-message');
        expect(telegram.classifyStatus(429)).toBe('telegram-rate-limited');
        expect(telegram.classifyStatus(503)).toBe('telegram-unavailable');
    });

    it('reports a network failure without surfacing the error, which carries the token URL', async () => {
        const fetchImpl = jest.fn(async () => {
            const error = new Error(`request to https://api.telegram.org/bot${REAL_LOOKING_TOKEN}/sendMessage failed`);
            throw error;
        });

        const outcome = await telegram.sendMessage(REAL_LOOKING_TOKEN, '-100', 'hello', fetchImpl);

        expect(outcome.ok).toBe(false);
        expect(outcome.code).toBe('telegram-network-error');
        expect(JSON.stringify(outcome)).not.toContain(REAL_LOOKING_TOKEN);
    });

    it('treats a 200 carrying ok:false as a failure', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }));
        const outcome = await telegram.sendMessage('t', 'c', 'hello', fetchImpl);
        expect(outcome).toEqual({ ok: false, code: 'telegram-rejected' });
    });

    it('verifies a token and returns only the public username', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true, status: 200, json: async () => ({ ok: true, result: { id: 1, username: 'safehaul_bot' } }),
        }));

        const result = await telegram.verifyBotToken(REAL_LOOKING_TOKEN, fetchImpl);
        expect(result).toEqual({ ok: true, code: null, username: 'safehaul_bot' });
    });

    it('clamps a message to the Telegram maximum', async () => {
        let sentBody = null;
        const fetchImpl = jest.fn(async (_url, options) => {
            sentBody = JSON.parse(options.body);
            return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
        });

        await telegram.sendMessage('t', 'c', 'x'.repeat(9000), fetchImpl);
        expect(sentBody.text).toHaveLength(telegram.MAX_MESSAGE_LENGTH);
    });

    it('builds a step-one message from only the fields step one collects', () => {
        const message = telegram.buildNewLeadMessage(
            { fullName: 'Jane Driver', workEmail: 'jane@example.com' },
            { sourcePage: '/pricing' },
        );
        expect(message).toContain('Jane Driver');
        expect(message).toContain('jane@example.com');
        expect(message).toContain('/pricing');
    });
});
