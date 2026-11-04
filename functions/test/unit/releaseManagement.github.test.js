/**
 * Contract for the release credential itself.
 *
 * The GitHub App private key is the most powerful non-Google credential SafeHaul
 * holds — anything that can use it can change what app.safehaul.io serves. These
 * tests pin the properties that keep it usable and contained:
 *
 *  - a missing or malformed credential is reported as "not configured", not as a
 *    crash that takes unrelated callables down with it;
 *  - the App JWT is genuinely RS256-signed and verifiable with the public key,
 *    so a silently unsigned or wrongly-encoded token cannot ship;
 *  - `iat` is backdated, because GitHub rejects a JWT issued in its own future
 *    and clock skew between a Functions instance and GitHub is not fixable;
 *  - a PEM that arrived with literal `\n` escapes still works, which is the
 *    single most common way this credential is broken in practice;
 *  - a failed token exchange never echoes the response body, which can contain
 *    the JWT that was rejected;
 *  - installation tokens are cached in memory and never persisted;
 *  - token minting and every GET give up after 15 s, but the dispatch that
 *    starts a release has no limit: a dispatch whose answer was lost may
 *    already have started one, and `promote.js` treats a failed dispatch as
 *    never started.
 *
 * The key pair below is generated at test time. No real credential is used.
 */

const { createVerify, generateKeyPairSync } = require('node:crypto');

const {
    GithubRequestError,
    createAppJwt,
    createReleaseApi,
    dispatchPromotion,
    getInstallationToken,
    isCredentialConfigured,
    readCredential,
    resetTokenCache,
} = require('../../releaseManagement/github');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const configuredEnv = () => ({
    RELEASE_GITHUB_APP_ID: '123456',
    RELEASE_GITHUB_INSTALLATION_ID: '7891011',
    RELEASE_GITHUB_PRIVATE_KEY: privateKey,
});

const decodeSegment = (segment) => JSON.parse(
    Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
);

beforeEach(() => {
    resetTokenCache();
});

describe('credential presence', () => {
    it('reports a fully configured credential', () => {
        expect(isCredentialConfigured(configuredEnv())).toBe(true);
    });

    it.each([
        'RELEASE_GITHUB_APP_ID',
        'RELEASE_GITHUB_INSTALLATION_ID',
        'RELEASE_GITHUB_PRIVATE_KEY',
    ])('reports not-configured when %s is missing', (missing) => {
        const env = configuredEnv();
        delete env[missing];
        expect(isCredentialConfigured(env)).toBe(false);
    });

    it('names what is missing without revealing what is present', () => {
        const env = configuredEnv();
        delete env.RELEASE_GITHUB_PRIVATE_KEY;

        expect(() => readCredential(env)).toThrow(/RELEASE_GITHUB_PRIVATE_KEY/);
        try {
            readCredential(env);
        } catch (error) {
            expect(error.message).not.toContain('123456');
            expect(error.message).not.toContain('7891011');
        }
    });

    it('rejects a value that is not a private key at all', () => {
        const env = { ...configuredEnv(), RELEASE_GITHUB_PRIVATE_KEY: 'not-a-key' };
        expect(isCredentialConfigured(env)).toBe(false);
    });

    it('accepts a PEM whose newlines were escaped in transit', () => {
        const env = { ...configuredEnv(), RELEASE_GITHUB_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') };
        expect(readCredential(env).privateKey).toBe(privateKey);
    });
});

describe('the App JWT', () => {
    it('is verifiable with the matching public key', () => {
        const token = createAppJwt(readCredential(configuredEnv()));
        const [header, payload, signature] = token.split('.');

        const verifier = createVerify('RSA-SHA256');
        verifier.update(`${header}.${payload}`);
        const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

        expect(verifier.verify(publicKey, raw)).toBe(true);
    });

    it('declares RS256 and issues as the App', () => {
        const token = createAppJwt(readCredential(configuredEnv()));
        const [header, payload] = token.split('.');

        expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
        expect(decodeSegment(payload).iss).toBe('123456');
    });

    it('backdates iat and stays inside GitHub ten-minute ceiling', () => {
        const now = 1800000000;
        const { iat, exp } = decodeSegment(createAppJwt(readCredential(configuredEnv()), now).split('.')[1]);

        expect(iat).toBeLessThan(now);
        expect(exp).toBeGreaterThan(now);
        expect(exp - iat).toBeLessThanOrEqual(600);
    });
});

const okResponse = (token, expiresInMs = 3600000) => ({
    ok: true,
    status: 201,
    json: async () => ({ token, expires_at: new Date(Date.now() + expiresInMs).toISOString() }),
});

describe('installation tokens', () => {
    it('exchanges the JWT for an installation token', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(okResponse('ghs-artificial-token'));

        const token = await getInstallationToken({ fetchImpl, env: configuredEnv() });

        expect(token).toBe('ghs-artificial-token');
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.github.com/app/installations/7891011/access_tokens',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('reuses a cached token rather than minting one per request', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(okResponse('ghs-artificial-token'));

        await getInstallationToken({ fetchImpl, env: configuredEnv() });
        await getInstallationToken({ fetchImpl, env: configuredEnv() });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('mints a fresh token once the cached one is close to expiring', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(okResponse('ghs-first', 30000))
            .mockResolvedValueOnce(okResponse('ghs-second'));

        expect(await getInstallationToken({ fetchImpl, env: configuredEnv() })).toBe('ghs-first');
        expect(await getInstallationToken({ fetchImpl, env: configuredEnv() })).toBe('ghs-second');
    });

    it('never echoes the response body of a failed exchange', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => 'Bad credentials for JWT eyJhbGciOiJSUzI1NiJ9.ARTIFICIAL',
        });

        await expect(getInstallationToken({ fetchImpl, env: configuredEnv() }))
            .rejects.toMatchObject({ message: expect.not.stringContaining('ARTIFICIAL') });
    });
});

describe('time limits', () => {
    const isMint = (url) => url.endsWith('/access_tokens');

    // Rejects only when the request is aborted, as the built-in fetch does.
    const untilAborted = (signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

    /** Records how a call ended, so a test can look just before the limit and at it. */
    const settleInto = (promise, seen = {}) => [
        seen,
        promise.then((value) => { seen.value = value; }, (error) => { seen.error = error; }),
    ];

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each([
        ['the answer never starts', (init) => untilAborted(init.signal)],
        ['the body never finishes', async (init) => ({ ok: true, status: 200, json: () => untilAborted(init.signal) })],
    ])('a GET gives up after 15 s when %s', async (_, slowRead) => {
        const fetchImpl = jest.fn((url, init) => (isMint(url) ? Promise.resolve(okResponse('ghs-artificial-token')) : slowRead(init)));
        const [seen, done] = settleInto(createReleaseApi({ fetchImpl, env: configuredEnv() })('/commits/x'));

        await jest.advanceTimersByTimeAsync(14999);
        expect(seen).toStrictEqual({});

        await jest.advanceTimersByTimeAsync(1);
        await done;
        expect(seen.error).toBeInstanceOf(GithubRequestError);
        expect(seen.error).toMatchObject({ status: 504, message: 'GitHub did not answer within 15 seconds.' });
        expect(fetchImpl).toHaveBeenLastCalledWith('https://api.github.com/repos/Khomurod/SafeHaul/commits/x', expect.anything());
    });

    it('gives up on a token mint after 15 s, before any dispatch is sent, and caches nothing', async () => {
        const fetchImpl = jest.fn((url, init) => untilAborted(init.signal));
        const [seen, done] = settleInto(
            dispatchPromotion({ sha: 'a'.repeat(40), requestId: 'r1' }, { fetchImpl, env: configuredEnv() }),
        );

        await jest.advanceTimersByTimeAsync(14999);
        expect(seen).toStrictEqual({});

        await jest.advanceTimersByTimeAsync(1);
        await done;
        expect(seen.error).toBeInstanceOf(GithubRequestError);
        expect(seen.error).toMatchObject({ status: 504 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(isMint(fetchImpl.mock.calls[0][0])).toBe(true);

        const answering = jest.fn(async () => okResponse('ghs-after-timeout'));
        await expect(getInstallationToken({ fetchImpl: answering, env: configuredEnv() })).resolves.toBe('ghs-after-timeout');
    });

    it('never limits the dispatch that starts a release: no signal, and a late answer still counts', async () => {
        const fetchImpl = jest.fn((url) => (isMint(url)
            ? Promise.resolve(okResponse('ghs-artificial-token'))
            : new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 204 }), 20000))));
        const [seen, done] = settleInto(
            dispatchPromotion({ sha: 'a'.repeat(40), requestId: 'r1' }, { fetchImpl, env: configuredEnv() }),
        );

        await jest.advanceTimersByTimeAsync(20000);
        await done;
        expect(seen).toStrictEqual({ value: null });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const [url, init] = fetchImpl.mock.calls[1];
        expect(url).toBe('https://api.github.com/repos/Khomurod/SafeHaul/actions/workflows/promote-production.yml/dispatches');
        expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method']);
        expect(init.signal).toBeUndefined();
    });
});
