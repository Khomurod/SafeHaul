/**
 * Server-to-server GitHub access for the Super Admin release path.
 *
 * ## Why a GitHub App, and not a token
 *
 * The Promote button needs to start `promote-production.yml`. Anything that can
 * do that can change what app.safehaul.io serves, so the credential behind it is
 * the most sensitive one SafeHaul holds after the Firebase deployer identity.
 *
 * A GitHub App installation was chosen over a personal access token because:
 *
 *   - it is its own identity, so an audit trail says "SafeHaul Release Manager",
 *     not "whichever employee's account this token belonged to";
 *   - it survives that person leaving, changing their password, or having their
 *     token revoked with everything else they owned;
 *   - its permissions are per-repository and per-scope, so it can be granted
 *     Actions and nothing else — a classic PAT cannot be narrowed that far;
 *   - the long-lived material never leaves Secret Manager. What travels is a
 *     one-hour installation token minted on demand.
 *
 * ## What this credential can do
 *
 * Installed on `Khomurod/SafeHaul` only, with:
 *
 *   | Permission  | Level | Why                                              |
 *   | ----------- | ----- | ------------------------------------------------ |
 *   | Actions     | write | dispatch `promote-production.yml`, read its runs  |
 *   | Contents    | read  | resolve the ref a dispatch runs from              |
 *   | Deployments | read  | read the Testing/Production release records       |
 *   | Checks      | read  | read required check state for eligibility         |
 *   | Metadata    | read  | mandatory for every installation                  |
 *
 * It cannot push code, cannot merge, cannot change workflows, cannot read
 * secrets, and cannot touch any other repository. It CAN start the production
 * promotion workflow — which is the whole point, and is why the callable in
 * `index.js` refuses to reach this module without an authenticated Super Admin,
 * a recent sign-in and an independently re-verified eligible release.
 *
 * ## What never happens here
 *
 * Nothing in this file is ever returned to a browser. The App id, installation
 * id, private key and every minted installation token stay inside the Cloud
 * Functions runtime. The client's entire vocabulary is "promote the release you
 * consider eligible"; it never names a credential, a repository or a workflow.
 */

const { createSign } = require('node:crypto');

const GITHUB_API = 'https://api.github.com';

/** The one repository this credential is installed on. */
const RELEASE_REPOSITORY = 'Khomurod/SafeHaul';

/** The only workflow the Promote button may start. */
const PROMOTION_WORKFLOW = 'promote-production.yml';

/** The ref a promotion is dispatched from. The candidate SHA is an INPUT. */
const PROMOTION_REF = 'main';

/**
 * Secret Manager names, bound to the callables via `secrets: [...]` so they
 * arrive as `process.env`. They are read lazily rather than at module load so
 * that an unconfigured deployment produces a clear typed failure at call time
 * instead of a cold-start crash that takes unrelated callables down with it.
 */
const SECRET_NAMES = Object.freeze([
    'RELEASE_GITHUB_APP_ID',
    'RELEASE_GITHUB_INSTALLATION_ID',
    'RELEASE_GITHUB_PRIVATE_KEY',
]);

/** Raised when the release credential is absent or unusable. */
class ReleaseCredentialError extends Error {}

/** Raised when GitHub itself refuses or fails. */
class GithubRequestError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function base64url(input) {
    return Buffer.from(input).toString('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Reads the App credential out of the runtime environment.
 *
 * The private key is stored in Secret Manager as a PEM. Secret Manager preserves
 * newlines, but a value that has been round-tripped through a shell or a `.env`
 * at some point arrives with literal `\n`, and the resulting signature failure
 * is famously opaque — so both forms are accepted here rather than debugged at
 * 2am.
 */
function readCredential(env = process.env) {
    const appId = env.RELEASE_GITHUB_APP_ID;
    const installationId = env.RELEASE_GITHUB_INSTALLATION_ID;
    const rawKey = env.RELEASE_GITHUB_PRIVATE_KEY;

    const missing = SECRET_NAMES.filter((name) => !env[name]);
    if (missing.length > 0) {
        throw new ReleaseCredentialError(
            `The release credential is not configured (missing: ${missing.join(', ')}).`,
        );
    }

    const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
    if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
        throw new ReleaseCredentialError('The release credential is not a valid private key.');
    }

    return { appId: String(appId).trim(), installationId: String(installationId).trim(), privateKey };
}

/** True when the credential is present, without revealing anything about it. */
function isCredentialConfigured(env = process.env) {
    try {
        readCredential(env);
        return true;
    } catch {
        return false;
    }
}

/**
 * Mints the short-lived App JWT GitHub accepts in place of a password.
 *
 * Signed locally with `node:crypto`; no JWT library is added for ten lines of
 * RS256. `iat` is backdated 60s because GitHub rejects a JWT whose `iat` is in
 * its future, and clock skew between a Cloud Functions instance and GitHub is
 * both real and unfixable from here.
 */
function createAppJwt({ appId, privateKey }, nowSeconds = Math.floor(Date.now() / 1000)) {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
        iat: nowSeconds - 60,
        // GitHub caps App JWTs at 10 minutes. Nine leaves room for skew.
        exp: nowSeconds + 9 * 60,
        iss: appId,
    }));

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(privateKey).toString('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    return `${header}.${payload}.${signature}`;
}

/**
 * In-instance cache for the installation token.
 *
 * Installation tokens last an hour and minting one is two network round trips
 * plus an RSA signature. Cached per warm instance, expired a minute early so a
 * request never starts with a token that dies mid-flight. Deliberately NOT
 * persisted anywhere: a token in Firestore is a token that outlives the process
 * that needed it.
 */
let cachedToken = null;

/** Discards the cached installation token. Exposed for tests. */
function resetTokenCache() {
    cachedToken = null;
}

async function mintInstallationToken({ fetchImpl = fetch, env = process.env } = {}) {
    const credential = readCredential(env);
    const jwt = createAppJwt(credential);

    const response = await fetchImpl(
        `${GITHUB_API}/app/installations/${encodeURIComponent(credential.installationId)}/access_tokens`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${jwt}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        },
    );

    if (!response.ok) {
        // The body of a failed token exchange can echo the JWT header, so only
        // the status is surfaced.
        throw new GithubRequestError(
            `Could not obtain a GitHub installation token (HTTP ${response.status}).`,
            response.status,
        );
    }

    const body = await response.json();
    if (!body?.token) {
        throw new GithubRequestError('GitHub returned no installation token.', 502);
    }

    return { token: body.token, expiresAt: Date.parse(body.expires_at) || (Date.now() + 55 * 60000) };
}

async function getInstallationToken(options = {}) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - 60000 > now) {
        return cachedToken.token;
    }
    cachedToken = await mintInstallationToken(options);
    return cachedToken.token;
}

/**
 * Authenticated GitHub REST call, scoped to the release repository.
 *
 * @param {string} method
 * @param {string} path repository-relative (`/deployments...`) or absolute (`/app/...`)
 */
async function githubRequest(method, path, { body, fetchImpl = fetch, env = process.env } = {}) {
    const token = await getInstallationToken({ fetchImpl, env });
    const url = path.startsWith('/repos/') || path.startsWith('/app')
        ? `${GITHUB_API}${path}`
        : `${GITHUB_API}/repos/${RELEASE_REPOSITORY}${path}`;

    const response = await fetchImpl(url, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new GithubRequestError(
            `GitHub ${method} ${path} failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
            response.status,
        );
    }

    // 204 No Content — every dispatch endpoint answers this way.
    if (response.status === 204) return null;
    return response.json();
}

/** A read-only GET in the shape `eligibility.js` expects. */
function createReleaseApi(options = {}) {
    return (path) => githubRequest('GET', path, options);
}

/**
 * Starts one production promotion.
 *
 * `sha` is ALWAYS the SHA the server resolved for itself; the caller in
 * `index.js` never forwards one from the browser. `requestId` lands in the
 * workflow's `run-name`, which is how `findPromotionRun` recognises this
 * dispatch rather than someone else's.
 */
async function dispatchPromotion({ sha, reason, requestId }, options = {}) {
    return githubRequest(
        'POST',
        `/actions/workflows/${PROMOTION_WORKFLOW}/dispatches`,
        {
            ...options,
            body: {
                ref: PROMOTION_REF,
                inputs: {
                    sha,
                    reason: reason || 'Promoted from SafeHaul Super Admin Release Management.',
                    request_id: requestId,
                },
            },
        },
    );
}

/** Normalises one workflow run into the shape the callables and UI use. */
function summariseRun(run) {
    if (!run) return null;
    return {
        runId: String(run.id),
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        name: run.name,
    };
}

/**
 * Recent promotion runs, newest first.
 *
 * Fetched ONCE per status read and then queried locally by the two helpers
 * below. They previously each made their own request, which doubled the API
 * traffic of a screen that polls every few seconds while a release runs — and an
 * installation's rate limit is a shared budget, so a status page is not the place
 * to spend it twice for the same answer.
 */
async function listPromotionRuns(options = {}) {
    const result = await githubRequest(
        'GET',
        `/actions/workflows/${PROMOTION_WORKFLOW}/runs?per_page=20`,
        options,
    );
    return result?.workflow_runs || [];
}

/**
 * Finds the workflow run started by a given request id.
 *
 * `workflow_dispatch` answers 204 with no body, so there is no run id to return
 * at dispatch time. The run's `name` carries the correlation id (see the
 * `run-name:` expression in `promote-production.yml`), which makes this exact
 * rather than "probably the newest run".
 *
 * Returns null while GitHub has not created the run yet — a normal state for the
 * first few seconds, and one the UI reports as "starting" rather than "failed".
 */
function selectPromotionRun(runs, requestId) {
    if (!requestId) return null;
    return summariseRun((runs || []).find(
        (candidate) => typeof candidate.name === 'string' && candidate.name.includes(`[${requestId}]`),
    ));
}

/**
 * The promotion run that has not finished, if there is one.
 *
 * This is the authoritative "a promotion is already happening" answer, and it is
 * checked before dispatching so two Super Admins in two tabs cannot queue two
 * releases against each other. It also catches a run dispatched by hand during an
 * incident, which no local record would know about. The workflow's own
 * `concurrency` group is the backstop — it queues rather than cancels, because
 * cancelling a half-finished production release is far worse than making a second
 * click wait.
 */
function selectRunningPromotion(runs) {
    return summariseRun((runs || []).find((run) => run.status !== 'completed'));
}

/** Convenience for the promotion path, which needs only the running answer. */
async function findRunningPromotion(options = {}) {
    return selectRunningPromotion(await listPromotionRuns(options));
}

module.exports = {
    GithubRequestError,
    PROMOTION_REF,
    PROMOTION_WORKFLOW,
    RELEASE_REPOSITORY,
    ReleaseCredentialError,
    SECRET_NAMES,
    createAppJwt,
    createReleaseApi,
    dispatchPromotion,
    findRunningPromotion,
    getInstallationToken,
    githubRequest,
    isCredentialConfigured,
    listPromotionRuns,
    readCredential,
    resetTokenCache,
    selectPromotionRun,
    selectRunningPromotion,
};
