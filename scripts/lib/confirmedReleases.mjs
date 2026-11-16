/**
 * The deployments the release records left on a channel, read the one way the
 * deploy base (`resolve-deploy-base.mjs`) and the health check
 * (`check-release-health.mjs`) both need: kept apart from the GitHub client so
 * the planner, which uses only the client, loads nothing from `functions/`.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isSafeHaulRelease } = require('../../functions/releaseManagement/eligibility.js');

/**
 * Each confirmed SafeHaul release recorded on a channel (`testing`,
 * `production`), newest first: a deployment this repository's release
 * recorded (`isSafeHaulRelease`) whose latest status is `success`. Read lazily,
 * so a caller that wants only the newest asks for no more.
 *
 * @param {(path: string) => Promise<any>} api a `createGithubApi` reader
 * @param {string} environment
 */
export async function* confirmedReleases(api, environment) {
    const deployments = await api(`/deployments?environment=${environment}&per_page=100`);
    for (const deployment of Array.isArray(deployments) ? deployments : []) {
        if (!isSafeHaulRelease(deployment)) continue;
        const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
        // Newest-first, so index 0 is the current state.
        if ((Array.isArray(statuses) ? statuses[0]?.state : undefined) !== 'success') continue;
        yield deployment;
    }
}
