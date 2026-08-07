#!/usr/bin/env node
/**
 * Record a deployed release as a GitHub Deployment.
 *
 * Release state has to live somewhere durable, because a promotion must be able
 * to answer "which Hosting version did commit X actually produce?" long after
 * the workflow run that built it. Three things made GitHub Deployments the right
 * home rather than a new Firestore collection:
 *
 *   1. No new credential. `GITHUB_TOKEN` already exists and is scoped to this
 *      repository; a Firestore mirror would need a fresh IAM grant on the
 *      deployer service account purely for bookkeeping.
 *   2. No forgery surface. Deployments are only writable by Actions, so browser
 *      clients cannot invent a "successful Testing release" to promote.
 *   3. No drift. It is the same record the GitHub UI shows, so the runbook and
 *      the audit trail cannot disagree with each other.
 *
 * The pinned Hosting version IDs are stored in the deployment payload. That
 * payload is the promotion contract: `promote-production.yml` clones those exact
 * version IDs and never resolves "whatever is live on Testing right now".
 *
 * Reads APP_VERSION_ID, LANDING_VERSION_ID and the standard GitHub Actions
 * environment.
 */

const {
    APP_VERSION_ID: appVersionId,
    LANDING_VERSION_ID: landingVersionId,
    GITHUB_TOKEN: token,
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: runId,
    GITHUB_SERVER_URL: serverUrl = 'https://github.com',
    RELEASE_CHANNEL: channel = 'testing',
} = process.env;

const missing = Object.entries({ appVersionId, landingVersionId, token, repository, sha })
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (missing.length > 0) {
    console.error(`Cannot record a release, missing: ${missing.join(', ')}`);
    process.exit(1);
}

const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API ${init.method || 'GET'} ${path} -> ${response.status}: ${body.slice(0, 400)}`);
    }
    return response.json();
};

const deployment = await api('/deployments', {
    method: 'POST',
    body: JSON.stringify({
        ref: sha,
        environment: channel,
        // This workflow *is* the gate: the deploy job already lists every required
        // CI job in `needs:`, so it cannot start until they are green. Asking
        // GitHub to re-check contexts here would deadlock against itself.
        required_contexts: [],
        auto_merge: false,
        transient_environment: false,
        production_environment: channel === 'production',
        description: `SafeHaul ${channel} release ${sha.slice(0, 7)}`,
        payload: {
            sha,
            channel,
            appVersionId,
            landingVersionId,
            runId,
        },
    }),
});

await api(`/deployments/${deployment.id}/statuses`, {
    method: 'POST',
    body: JSON.stringify({
        state: 'success',
        description: `Hosting versions app=${appVersionId} landing=${landingVersionId}`,
        log_url: runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined,
        environment_url:
            channel === 'production' ? 'https://app.safehaul.io' : 'https://truckerapp-system.web.app',
    }),
});

console.log(
    `Recorded ${channel} deployment #${deployment.id} for ${sha} ` +
    `(app version ${appVersionId}, landing version ${landingVersionId}).`,
);
