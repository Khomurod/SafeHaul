/**
 * The Telegram Bot API client for operator alerts.
 *
 * The token travels in the URL path, so the property pinned hardest here is
 * that no failure carries the URL, the token or Telegram's own text.
 */

const telegram = require('../../ops/telegram');

// Built at run time: a token-shaped literal is what the secret scan exists to stop.
const TOKEN = `${'1'.repeat(9)}:${'t'.repeat(35)}`;

function respond(status, body) {
    return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

describe('callTelegram', () => {
    it('refuses something that is not a bot token without calling Telegram', async () => {
        const fetchImpl = respond(200, { ok: true, result: {} });
        await expect(telegram.callTelegram('not-a-token', 'getMe', {}, { fetchImpl }))
            .rejects.toMatchObject({ code: 'token_invalid' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('posts JSON to the method under the bot\'s own path', async () => {
        const fetchImpl = respond(200, { ok: true, result: { username: 'safehaul_alerts_bot' } });
        await telegram.callTelegram(TOKEN, 'getMe', {}, { fetchImpl });
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
        expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    });

    it('never lets a failed fetch carry the URL, and so the token, out', async () => {
        const fetchImpl = jest.fn(async () => { throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/getMe`); });
        const error = await telegram.callTelegram(TOKEN, 'getMe', {}, { fetchImpl }).catch((caught) => caught);
        expect(error.code).toBe('unreachable');
        expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(TOKEN);
    });

    it.each([
        [401, { ok: false, description: 'Unauthorized' }, 'token_rejected'],
        [404, { ok: false, description: 'Not Found' }, 'token_rejected'],
        [409, { ok: false, description: 'Conflict: webhook is active' }, 'webhook_set'],
        [429, { ok: false, description: 'Too Many Requests' }, 'rate_limited'],
        [502, null, 'unavailable'],
        [200, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'blocked'],
    ])('reads HTTP %p as %p, without Telegram\'s text', async (status, body, code) => {
        const error = await telegram.callTelegram(TOKEN, 'sendMessage', {}, { fetchImpl: respond(status, body) })
            .catch((caught) => caught);
        expect(error).toBeInstanceOf(telegram.TelegramError);
        expect(error.code).toBe(code);
        expect(error.message).not.toMatch(/blocked by the user|webhook|Unauthorized/);
    });

    it('counts a 200 that cannot be read as Telegram being down', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
        await expect(telegram.callTelegram(TOKEN, 'getMe', {}, { fetchImpl })).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('gives up on an answer that stops halfway, within the same ten seconds', async () => {
        jest.useFakeTimers();
        try {
            const fetchImpl = jest.fn(async (_url, { signal }) => ({
                ok: true,
                status: 200,
                json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
            }));
            const pending = telegram.callTelegram(TOKEN, 'getMe', {}, { fetchImpl }).catch((caught) => caught);
            await jest.advanceTimersByTimeAsync(10000);
            await expect(pending).resolves.toMatchObject({ code: 'unavailable' });
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('finding the operator\'s chat', () => {
    it('takes only the chat that pressed Start on the one-time link, named as a person would be', async () => {
        const fetchImpl = respond(200, {
            ok: true,
            result: [
                { update_id: 1, message: { text: '/start CODE123', chat: { id: 222, first_name: 'Dana', last_name: 'Alvarez' } } },
                // Whoever else writes to the bot, later or guessing, is not connected.
                { update_id: 2, message: { text: 'hello', chat: { id: 333, first_name: 'Stranger' } } },
                { update_id: 3, message: { text: '/start WRONG', chat: { id: 444, first_name: 'Guess' } } },
                { update_id: 4, message: { text: '/start', chat: { id: 555, first_name: 'Bare' } } },
            ],
        });
        await expect(telegram.chatThatStarted(TOKEN, 'CODE123', { fetchImpl })).resolves.toEqual({ id: 222, title: 'Dana Alvarez' });
        // By default Telegram answers with the oldest updates; the newest hundred are asked for.
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ offset: -100, limit: 100 });
    });

    it('names a group by its title, and finds nothing until the link was used', async () => {
        const group = respond(200, { ok: true, result: [{ message: { text: '/start@safehaul_alerts_bot CODE123', chat: { id: -5, title: 'Dispatch' } } }] });
        await expect(telegram.chatThatStarted(TOKEN, 'CODE123', { fetchImpl: group })).resolves.toEqual({ id: -5, title: 'Dispatch' });
        await expect(telegram.chatThatStarted(TOKEN, 'CODE123', { fetchImpl: respond(200, { ok: true, result: [] }) }))
            .resolves.toBeNull();
    });
});

describe('sendMessage', () => {
    it('sends plain text within Telegram\'s limit, with no link previews', async () => {
        const fetchImpl = respond(200, { ok: true, result: {} });
        await telegram.sendMessage(TOKEN, 222, 'x'.repeat(5000), { fetchImpl });
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body).toMatchObject({ chat_id: 222, disable_web_page_preview: true });
        expect(body.text).toHaveLength(telegram.MAX_MESSAGE_CHARS);
        expect(body).not.toHaveProperty('parse_mode');
    });
});
