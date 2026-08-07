#!/usr/bin/env node
/**
 * Declare a Testing release fully shipped, and therefore promotable.
 *
 * This is the authoritative eligibility point for the whole release system. It
 * runs from the `release-ready` job in `.github/workflows/main.yml`, which lists
 * every deploy job in `needs:` and so cannot start until all of them have
 * succeeded:
 *
 *   - the Testing application and landing Hosting deploys;
 *   - Firestore rules, Storage rules and Firestore indexes;
 *   - the Cloud Functions rollout and its post-deploy smoke check.
 *
 * Those last four are SHARED backend: Testing and Production run against one
 * Firebase project. A frontend that needs a new Function, rule or index must
 * therefore not be promotable until that backend change has actually landed —
 * otherwise a promotion could put a frontend on app.safehaul.io whose backend
 * rollout failed hours earlier.
 *
 * `scripts/record-release.mjs` creates the deployment as `in_progress` during
 * the frontend deploy. Only this script marks it `success`, and only `success`
 * satisfies the gate in `functions/releaseManagement/eligibility.js`. Every way
 * this job can fail to run — a failed deploy, a cancelled workflow, a runner
 * dying — leaves the release un-promotable. It fails closed by construction.
 *
 * Reads DEPLOYMENT_ID and the standard GitHub Actions environment.
 */

const {
    DEPLOYMENT_ID: deploymentId,
    GITHUB_TOKEN: token,
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: runId,
    GITHUB_SERVER_URL: serverUrl = 'https://github.com',
    RELEASE_SHA: sha,
} = process.env;

const missing = Object.entries({ deploymentId, token, repository })
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (missing.length > 0) {
    console.error(`Cannot confirm a release as ready, missing: ${missing.join(', ')}`);
    process.exit(1);
}

if (!/^\d+$/.test(String(deploymentId))) {
    console.error(`Refusing to confirm deployment "${deploymentId}": expected a numeric id.`);
    process.exit(1);
}

const response = await fetch(
    `https://api.github.com/repos/${repository}/deployments/${deploymentId}/statuses`,
    {
        method: 'POST',
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            state: 'success',
            description: 'Frontend and shared backend released; promotable to Production.',
            log_url: runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined,
            environment_url: 'https://truckerapp-system.web.app',
        }),
    },
);

if (!response.ok) {
    const body = await response.text();
    console.error(
        `Could not confirm deployment #${deploymentId}: ${response.status} ${body.slice(0, 400)}`,
    );
    process.exit(1);
}

console.log(
    `Release ${sha || '(unknown sha)'} confirmed ready: deployment #${deploymentId} is now ` +
    'promotable to Production.',
);
