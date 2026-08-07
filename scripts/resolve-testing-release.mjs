#!/usr/bin/env node
/**
 * Resolve — and refuse to guess — the Testing release a promotion may copy.
 *
 * This is the gate that makes "promote the exact tested build" enforceable
 * rather than a convention. Given only a candidate SHA it answers:
 *
 *   - Was this SHA actually deployed to Testing, and did that deploy succeed?
 *   - Which immutable Hosting version did it produce?
 *   - Are this commit's checks still green?
 *   - Is production already on it (so a repeated promotion is a no-op)?
 *
 * Every answer comes from GitHub Deployments, which only Actions can write. A
 * SHA typed by a human, or forwarded from a browser, is never trusted: if it has
 * no successful Testing deployment record, this exits non-zero and the promotion
 * stops before any Google credential is minted.
 *
 * The resolver is exported so scripts/test-release-promotion.mjs can drive it
 * against fake API responses; the CLI wrapper at the bottom runs only when this
 * file is executed directly.
 *
 * Usage: node scripts/resolve-testing-release.mjs <sha>
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Thrown for "this candidate may not be promoted" — always a clean refusal. */
export class IneligibleReleaseError extends Error {}

/**
 * @param {object} options
 * @param {string} options.candidateSha  full 40-char commit SHA
 * @param {(path: string) => Promise<any>} options.api  GitHub REST GET
 */
export async function resolveTestingRelease({ candidateSha, api }) {
    // A short SHA could match more than one commit, and a branch name is not a
    // release at all. Only a full commit id identifies an exact tested build.
    if (typeof candidateSha !== 'string' || !/^[0-9a-f]{40}$/.test(candidateSha)) {
        throw new IneligibleReleaseError(
            `Refusing to promote "${candidateSha}": a promotion candidate must be a full ` +
            '40-character commit SHA, not a short SHA, tag or branch name.',
        );
    }

    const latestState = async (deployment) => {
        // The statuses API returns newest-first.
        const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
        return statuses[0]?.state;
    };

    // --- 1. The candidate must have a successful Testing deployment ---------

    const testingDeployments = await api(
        `/deployments?environment=testing&sha=${candidateSha}&per_page=100`,
    );

    if (!Array.isArray(testingDeployments) || testingDeployments.length === 0) {
        throw new IneligibleReleaseError(
            `Refusing to promote ${candidateSha}: it has no Testing deployment record.\n` +
            'Only a commit that CI built and deployed to Testing can be promoted. If this ' +
            'commit is newer than the last Testing release, wait for its Testing deploy to finish.',
        );
    }

    let resolved;
    for (const deployment of testingDeployments) {
        if ((await latestState(deployment)) !== 'success') continue;
        const payload = deployment.payload || {};
        if (!payload.appVersionId || !payload.landingVersionId) continue;
        resolved = { deployment, payload };
        break;
    }

    if (!resolved) {
        throw new IneligibleReleaseError(
            `Refusing to promote ${candidateSha}: its Testing deployment did not succeed, ` +
            'or recorded no pinned Hosting version. A failed Testing release is not promotable.',
        );
    }

    // --- 2. Required CI must still be green for this exact commit -----------
    //
    // Defence in depth: the Testing deployment can only be created by a job that
    // lists every required check in `needs:`, so this mainly catches a commit
    // whose checks were re-run and failed afterwards.

    const { check_runs: checkRuns = [] } = await api(
        `/commits/${candidateSha}/check-runs?per_page=100&filter=latest`,
    );

    const failed = checkRuns.filter(
        (run) =>
            run.status === 'completed' &&
            !['success', 'skipped', 'neutral'].includes(run.conclusion),
    );

    if (failed.length > 0) {
        throw new IneligibleReleaseError(
            `Refusing to promote ${candidateSha}: required checks are not green — ` +
            `${failed.map((run) => `${run.name}=${run.conclusion}`).join(', ')}.`,
        );
    }

    // --- 3. Is production already serving this release? ---------------------
    //
    // Makes a double-clicked or retried promotion a safe no-op rather than a
    // second redeploy of the same bytes.

    const productionDeployments = await api('/deployments?environment=production&per_page=100');
    let alreadyLive = false;
    for (const deployment of productionDeployments || []) {
        if ((await latestState(deployment)) !== 'success') continue;
        // Only the most recent *successful* production release matters.
        alreadyLive = deployment.sha === candidateSha;
        break;
    }

    return {
        appVersionId: resolved.payload.appVersionId,
        landingVersionId: resolved.payload.landingVersionId,
        testingDeploymentId: String(resolved.deployment.id),
        alreadyLive,
    };
}

/** GitHub REST GET bound to the repository this workflow runs in. */
export const createGithubApi = ({ token, repository }) => async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API GET ${path} -> ${response.status}: ${body.slice(0, 400)}`);
    }
    return response.json();
};

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
    const candidateSha = process.argv[2];
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: outputFile } =
        process.env;

    if (!candidateSha || !token || !repository) {
        console.error(
            'Usage: resolve-testing-release.mjs <sha> (needs GITHUB_TOKEN, GITHUB_REPOSITORY)',
        );
        process.exit(1);
    }

    try {
        const resolvedRelease = await resolveTestingRelease({
            candidateSha,
            api: createGithubApi({ token, repository }),
        });

        const outputs = {
            app_version_id: resolvedRelease.appVersionId,
            landing_version_id: resolvedRelease.landingVersionId,
            testing_deployment_id: resolvedRelease.testingDeploymentId,
            already_live: String(resolvedRelease.alreadyLive),
        };

        if (outputFile) {
            appendFileSync(
                outputFile,
                `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
                'utf8',
            );
        }

        console.log(
            `Resolved ${candidateSha} -> Hosting app version ${outputs.app_version_id} ` +
            `(Testing deployment #${outputs.testing_deployment_id}). ` +
            `Production already live on it: ${resolvedRelease.alreadyLive}.`,
        );
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
