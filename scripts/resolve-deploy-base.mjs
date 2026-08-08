#!/usr/bin/env node
/**
 * Chooses the commit the incremental Cloud Functions deploy measures "changed"
 * against.
 *
 * ## The bug this exists to close
 *
 * `scripts/deploy-functions-incremental.mjs` deploys the functions whose source
 * changed between a base commit and HEAD. CI used to hand it
 * `github.event.before` — the PREVIOUS PUSH.
 *
 * That is only correct while every push deploys successfully. When one does not,
 * its window is never revisited: the next push starts measuring from the commit
 * that failed, so the functions it changed are silently never deployed. CI is
 * green, the frontend ships, and the callable simply does not exist.
 *
 * That is not hypothetical. `surveyHistoricalReconstruction` shipped in
 * dc0dd23 on 2026-08-07; that merge's deploy jobs died in a runner outage; the
 * next successful deploy measured from dc0dd23 and therefore saw no functions
 * changes at all. The Super Admin panel calling it returned "internal" — a 404
 * from Cloud Functions, whose non-JSON body the Firebase SDK reports as
 * `internal` — and the function was still missing from production two merges
 * later.
 *
 * ## The fix
 *
 * Measure from the last commit whose Testing release was CONFIRMED SUCCESSFUL.
 *
 * That is exactly what a `success` Testing deployment record means:
 * `scripts/record-release.mjs` writes the record `in_progress`, and only
 * `release-ready` marks it `success` — a job that cannot start until both the
 * frontend and the Cloud Functions deploy have passed. So a `success` record is
 * a commit whose functions demonstrably reached Cloud.
 *
 * A failed deploy then WIDENS the next window instead of dropping it: the base
 * stays put until something actually ships, so the orphaned commits are still
 * inside the diff next time.
 *
 * ## Failure behaviour
 *
 * Falling back means falling back to `github.event.before`, i.e. exactly what CI
 * did before this script existed. That is not ideal — it is the narrow window
 * this file exists to widen — but it is never *worse* than the old behaviour,
 * and failing the deploy outright over a transient API read would be. Every
 * fallback is logged loudly and written to the job summary.
 *
 * Writes `DEPLOY_GIT_BASE` to `$GITHUB_ENV` only when it has a better answer
 * than the default; the planner reads that in preference to `GITHUB_PUSH_BEFORE`.
 */

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGithubApi, isSafeHaulRelease } = require('../functions/releaseManagement/eligibility.js');

const FULL_SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = /^0{40}$/;

/**
 * Picks the diff base.
 *
 * Pure: `isAncestor` is injected so the decision can be tested without a git
 * repository. Ancestry matters because a recorded SHA that is not behind HEAD
 * (a force push, a rewritten history, or a re-run of an older workflow) would
 * produce a meaningless diff — better to fall back than to deploy a set of
 * functions derived from an unrelated range.
 *
 * @param {object} options
 * @param {string|null} options.lastDeployedSha newest CONFIRMED Testing release
 * @param {string|null} options.pushBefore      `github.event.before`
 * @param {(sha: string) => boolean} options.isAncestor is this behind HEAD?
 * @returns {{base: string|null, source: string, reason: string}}
 */
export function chooseDeployBase({ lastDeployedSha, pushBefore, isAncestor }) {
    const usable = (sha) => typeof sha === 'string'
        && FULL_SHA.test(sha)
        && !ZERO_SHA.test(sha)
        && isAncestor(sha);

    if (usable(lastDeployedSha)) {
        return {
            base: lastDeployedSha,
            source: 'last-successful-deploy',
            reason: `measuring from ${lastDeployedSha}, the last release confirmed successfully deployed`,
        };
    }

    const why = !lastDeployedSha
        ? 'no confirmed Testing release was found'
        : `the last confirmed release ${lastDeployedSha} is not an ancestor of HEAD`;

    if (usable(pushBefore)) {
        return {
            base: pushBefore,
            source: 'push-before',
            reason: `${why}; falling back to the previous push ${pushBefore}. `
                + 'Functions changed by a push whose deploy failed may not be included.',
        };
    }

    return {
        base: null,
        source: 'none',
        reason: `${why}, and this push has no usable previous commit either. `
            + 'The deploy planner decides what to do with no range.',
    };
}

/**
 * The newest Testing release this system recorded as fully shipped.
 *
 * Skips records still `in_progress` (the frontend deployed but the backend
 * rollout did not finish) and foreign records sharing the environment name —
 * see `isSafeHaulRelease` for why this repository has those.
 *
 * @param {(path: string) => Promise<any>} api GitHub REST GET
 * @returns {Promise<string|null>}
 */
export async function readLastDeployedSha(api) {
    const deployments = await api('/deployments?environment=testing&per_page=100');
    for (const deployment of Array.isArray(deployments) ? deployments : []) {
        if (!isSafeHaulRelease(deployment)) continue;
        const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
        // Newest-first, so index 0 is the current state.
        if ((Array.isArray(statuses) ? statuses[0]?.state : undefined) !== 'success') continue;
        return deployment.sha || null;
    }
    return null;
}

/* -------------------------------------------------------------------------- */

function gitIsAncestor(sha) {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' });
        return true;
    } catch {
        // Also covers "that commit is not in this clone at all", which is the
        // same answer for our purposes: unusable as a base.
        return false;
    }
}

async function main() {
    const {
        GITHUB_TOKEN: token,
        GITHUB_REPOSITORY: repository,
        GITHUB_PUSH_BEFORE: pushBefore = null,
        GITHUB_ENV: envFile,
        GITHUB_STEP_SUMMARY: summaryFile,
    } = process.env;

    let lastDeployedSha = null;
    if (token && repository) {
        try {
            lastDeployedSha = await readLastDeployedSha(createGithubApi({ token, repository }));
        } catch (error) {
            console.warn(`[deploy-base] could not read Testing releases: ${error.message}`);
        }
    } else {
        console.warn('[deploy-base] no credentials to read Testing releases.');
    }

    const decision = chooseDeployBase({
        lastDeployedSha,
        pushBefore,
        isAncestor: gitIsAncestor,
    });

    console.log(`[deploy-base] ${decision.reason}`);

    // Only override when we have the better answer. Leaving the variable unset
    // makes the planner fall back to GITHUB_PUSH_BEFORE on its own, which is
    // precisely the pre-existing behaviour.
    if (decision.source === 'last-successful-deploy' && envFile) {
        appendFileSync(envFile, `DEPLOY_GIT_BASE=${decision.base}\n`, 'utf8');
    }

    if (summaryFile) {
        appendFileSync(summaryFile, [
            '### Cloud Functions deploy base',
            '',
            decision.source === 'last-successful-deploy'
                ? `Measuring changes from \`${decision.base}\` — the last release confirmed deployed.`
                : `⚠️ ${decision.reason}`,
            '',
        ].join('\n'), 'utf8');
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        // Never fail the deploy over this. Without DEPLOY_GIT_BASE the planner
        // uses GITHUB_PUSH_BEFORE, which is what it always did.
        console.warn(`[deploy-base] falling back to the previous push: ${error.message}`);
    });
}
