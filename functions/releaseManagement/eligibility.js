/**
 * The single source of truth for "may this release reach app.safehaul.io?".
 *
 * This module is deliberately pure: no Firebase, no credentials, no globals. It
 * is consumed by two callers that must never disagree with each other —
 *
 *   - `scripts/resolve-testing-release.mjs`, the gate inside
 *     `.github/workflows/promote-production.yml`, which runs on the release
 *     runner and refuses to clone anything ineligible;
 *   - `functions/releaseManagement/index.js`, the Super Admin callables, which
 *     decide what the Release Management screen shows and whether the Promote
 *     button may fire at all.
 *
 * They previously would have been two implementations of the same rules. A
 * production gate that exists in two copies is a gate that eventually disagrees
 * with itself, and the disagreement is only discovered by shipping the wrong
 * bytes, so the rules live here once and both sides import them.
 *
 * ## What "eligible" means
 *
 * A commit is promotable only when ALL of the following hold:
 *
 *   1. It is a full 40-character commit SHA (not a short SHA, tag or branch).
 *   2. It has a Testing deployment record carrying pinned Hosting version IDs.
 *   3. That deployment's latest status is `success` — which, by the design of
 *      `main.yml`, is only posted after the SHARED BACKEND rollout (Cloud
 *      Functions, Firestore rules, Storage rules, indexes, post-deploy smoke)
 *      has also finished successfully.
 *   4. Every required check on the commit has COMPLETED and concluded `success`.
 *      Queued, in-progress, SKIPPED and entirely absent required checks are
 *      refusals, not "not yet failed".
 *
 * Rule 4 is the one that is easy to get subtly wrong, in two different ways.
 *
 * Filtering for "completed checks whose conclusion is bad" accepts a commit whose
 * deployment jobs have not started yet, because a check that has not run has no
 * bad conclusion. So the gate is built from a required-set that must be PRESENT.
 *
 * And accepting `skipped` for a REQUIRED check accepts a job that did not happen.
 * That was tolerable while every required job ran unconditionally on every push.
 * It is not tolerable now: `main.yml` skips test lanes it can prove were already
 * validated against the identical source tree, so `skipped` is a routine outcome
 * for individual test jobs. The required set therefore names only checks that run
 * on every release, and each of them must conclude `success` — never `skipped`,
 * never `neutral`.
 *
 * The completeness of the test lanes themselves is asserted by ONE required
 * check, `Verify the release is fully validated`, which is a separate job that
 * re-derives whether every lane ran or was provably covered
 * (`scripts/verify-release-validation.mjs`). It is declared `if: always()`, so it
 * reports a verdict even when a lane failed or the run was cancelled. Deleting
 * it, renaming it or letting it be skipped makes every promotion refuse.
 */

/** Thrown for "this candidate may not be promoted" — always a clean refusal. */
class IneligibleReleaseError extends Error {}

/**
 * Checks that must be present and successful on a commit before it may be
 * promoted, keyed by the name GitHub reports for the job.
 *
 * These are job `name:` values from `.github/workflows/main.yml` (falling back
 * to the job id where no `name:` is set). If a job is renamed without updating
 * this list, promotion starts refusing every candidate — which is the correct
 * direction to fail, and is asserted by `scripts/test-release-promotion.mjs`
 * against the workflow file itself so the mismatch surfaces in CI rather than
 * at the moment somebody needs to release.
 *
 * Every entry here runs on EVERY release, so every entry must conclude
 * `success`. That is what lets this list reject `skipped`.
 *
 * The individual test jobs — `frontend-quality`, `frontend-e2e`,
 * `rules-emulator`, `test-functions`, `frontend-build`, the Storybook catalog —
 * are deliberately NOT listed. They are skipped on a merge whose exact source
 * tree a pull request already validated, so naming them here would either block
 * every optimised release or, far worse, require accepting `skipped` for a
 * required check. Their completeness is asserted instead by
 * `Verify the release is fully validated`, which cannot be satisfied by a lane
 * that neither ran nor has proof it passed on this code.
 *
 * `typecheck` and `e2e-a11y` are absent for a different reason: both are declared
 * non-blocking baselines in `main.yml` and run with `continue-on-error`, so
 * requiring them here would contradict the workflow.
 */
const REQUIRED_RELEASE_CHECKS = Object.freeze([
    // Scans commit HISTORY, so it can never be satisfied by a tree-hash proof
    // and runs on every release.
    'secret-scan',
    // THE completeness check: every test lane either ran in this release's run
    // or is provably covered for its exact source tree.
    'Verify the release is fully validated',
    // The two halves of the release itself. The Testing frontend and the SHARED
    // backend are separate jobs, and Production runs against the same backend,
    // so a frontend that depends on a Function or a rule which never shipped
    // must not be promotable.
    'Deploy the Testing release',
    'Deploy Cloud Functions',
    // "The deploy job succeeded" and "the release is actually live" are different
    // claims, and only the second is worth promoting. This one reads the deployed
    // SHA back off the live site, and separately refuses a run where a deploy job
    // never executed — the failure that let a60c6dc report success while shipping
    // nothing at all.
    'Confirm the release actually shipped',
]);

/**
 * The only conclusion that satisfies a REQUIRED check.
 *
 * `skipped` is excluded on purpose. A skipped required check is a check that did
 * not happen, and every name in `REQUIRED_RELEASE_CHECKS` is a job that runs
 * unconditionally on a release — so a skip there means something is wrong with
 * the workflow, not that the check was unnecessary. `neutral` is excluded for
 * the same reason: no job in the required set can produce it.
 */
const REQUIRED_CHECK_CONCLUSIONS = Object.freeze(['success']);

/**
 * Conclusions that count as "this non-required check did not fail".
 *
 * A test lane skipped because a pull request already validated this exact tree
 * lands here, and must not block. A lane that went RED still blocks, which is
 * the point of the sweep in `evaluateRequiredChecks`.
 */
const NON_BLOCKING_CONCLUSIONS = Object.freeze(['success', 'skipped', 'neutral']);

const FULL_SHA = /^[0-9a-f]{40}$/;

/** True for a full 40-character lowercase commit id. */
function isFullSha(value) {
    return typeof value === 'string' && FULL_SHA.test(value);
}

/**
 * A release record this system wrote, as opposed to one some other integration
 * wrote into the same environment.
 *
 * This repository's `Production` deployment environment contains a long tail of
 * records created by a Vercel integration that has nothing to do with Firebase
 * Hosting — same environment name, empty payload, unrelated commit history. A
 * naive "newest successful production deployment" read picks one of those up and
 * reports a foreign SHA as the live SafeHaul release, and could make a genuine
 * promotion look like a no-op. The pinned Hosting version is what makes a record
 * ours, so that is what identifies it.
 */
function isSafeHaulRelease(deployment) {
    const payload = deployment?.payload;
    if (!payload || typeof payload !== 'object') return false;
    return Boolean(payload.appVersionId);
}

/**
 * Classifies the required checks for a commit.
 *
 * @param {Array<{name: string, status: string, conclusion: string|null}>} checkRuns
 * @returns {{failed: string[], pending: string[], missing: string[], skipped: string[], ok: boolean}}
 */
function evaluateRequiredChecks(checkRuns) {
    const runs = Array.isArray(checkRuns) ? checkRuns : [];
    const byName = new Map();
    for (const run of runs) {
        if (run && typeof run.name === 'string') byName.set(run.name, run);
    }

    const failed = [];
    const pending = [];
    const missing = [];
    const skipped = [];

    for (const name of REQUIRED_RELEASE_CHECKS) {
        const run = byName.get(name);
        if (!run) {
            missing.push(name);
            continue;
        }
        if (run.status !== 'completed') {
            pending.push(name);
            continue;
        }
        // Reported separately from `failed` because the operator-facing reason is
        // different: a skipped required check did not fail, it did not happen.
        if (run.conclusion === 'skipped') {
            skipped.push(name);
            continue;
        }
        if (!REQUIRED_CHECK_CONCLUSIONS.includes(run.conclusion)) {
            failed.push(`${name}=${run.conclusion}`);
        }
    }

    // Anything else on the commit that ran and failed still blocks, so a re-run
    // that goes red is caught even if it is not on the required list. This is
    // what catches an individual test lane going red: the lanes are no longer in
    // the required set, but a failing one must still stop a promotion.
    for (const run of runs) {
        if (!run || typeof run.name !== 'string') continue;
        if (REQUIRED_RELEASE_CHECKS.includes(run.name)) continue;
        if (run.status !== 'completed') continue;
        if (NON_BLOCKING_CONCLUSIONS.includes(run.conclusion)) continue;
        // Non-blocking lanes declare themselves by concluding `success` even when
        // a step failed (`continue-on-error`), so anything red here genuinely is.
        failed.push(`${run.name}=${run.conclusion}`);
    }

    return {
        failed,
        pending,
        missing,
        skipped,
        ok: failed.length === 0 && pending.length === 0 && missing.length === 0
            && skipped.length === 0,
    };
}

/** Human-readable, non-technical explanation of why a candidate is blocked. */
function describeCheckBlockers({ failed, pending, missing, skipped = [] }) {
    const blockers = [];
    if (failed.length > 0) {
        blockers.push(`Checks failed for this release: ${failed.join(', ')}.`);
    }
    if (pending.length > 0) {
        blockers.push(`Still running: ${pending.join(', ')}.`);
    }
    if (missing.length > 0) {
        blockers.push(`Has not started: ${missing.join(', ')}.`);
    }
    if (skipped.length > 0) {
        blockers.push(
            `Did not run for this release: ${skipped.join(', ')}. A required check that was ` +
            'skipped is not a passed check.',
        );
    }
    return blockers;
}

/**
 * Builds a "latest deployment status" reader over a GitHub REST GET.
 * The statuses endpoint returns newest-first.
 */
function createLatestStateReader(api) {
    return async (deployment) => {
        const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
        return Array.isArray(statuses) ? statuses[0]?.state : undefined;
    };
}

/** Normalises a deployment record into the shape both callers render. */
function summariseDeployment(deployment, state) {
    const payload = deployment?.payload || {};
    return {
        deploymentId: String(deployment.id),
        sha: deployment.sha,
        appVersionId: payload.appVersionId || null,
        landingVersionId: payload.landingVersionId || null,
        runId: payload.runId ? String(payload.runId) : null,
        createdAt: deployment.created_at || null,
        state: state || null,
    };
}

/**
 * The authoritative Testing release: the newest Testing deployment this system
 * wrote. It may or may not be promotable yet — that is `evaluateRequiredChecks`
 * plus the deployment state, and is reported separately so the UI can explain
 * "deployed, backend still rolling out" instead of just "not available".
 *
 * @param {(path: string) => Promise<any>} api
 */
async function readLatestTestingRelease(api) {
    const deployments = await api('/deployments?environment=testing&per_page=100');
    const latestState = createLatestStateReader(api);

    for (const deployment of Array.isArray(deployments) ? deployments : []) {
        if (!isSafeHaulRelease(deployment)) continue;
        return summariseDeployment(deployment, await latestState(deployment));
    }
    return null;
}

/**
 * The production releases this system has made, newest first.
 * Foreign records sharing the environment name are excluded (see
 * `isSafeHaulRelease`).
 *
 * @param {(path: string) => Promise<any>} api
 * @param {number} [limit=2] how many successful releases to resolve
 */
async function readProductionReleases(api, limit = 2) {
    const deployments = await api('/deployments?environment=production&per_page=100');
    const latestState = createLatestStateReader(api);
    const releases = [];

    for (const deployment of Array.isArray(deployments) ? deployments : []) {
        if (!isSafeHaulRelease(deployment)) continue;
        const state = await latestState(deployment);
        if (state !== 'success') continue;
        releases.push(summariseDeployment(deployment, state));
        if (releases.length >= limit) break;
    }
    return releases;
}

/**
 * Resolve — and refuse to guess — the Testing release a promotion may copy.
 *
 * Every answer comes from GitHub Deployments and Checks, which only Actions can
 * write. A SHA typed by a human, or forwarded from a browser, is never trusted.
 *
 * @param {object} options
 * @param {string} options.candidateSha  full 40-char commit SHA
 * @param {(path: string) => Promise<any>} options.api  GitHub REST GET
 * @throws {IneligibleReleaseError}
 */
async function resolveTestingRelease({ candidateSha, api }) {
    // A short SHA could match more than one commit, and a branch name is not a
    // release at all. Only a full commit id identifies an exact tested build.
    if (!isFullSha(candidateSha)) {
        throw new IneligibleReleaseError(
            `Refusing to promote "${candidateSha}": a promotion candidate must be a full ` +
            '40-character commit SHA, not a short SHA, tag or branch name.',
        );
    }

    const latestState = createLatestStateReader(api);

    // --- 1. The candidate must have a SUCCESSFUL Testing release record ------
    //
    // `main.yml` creates this record when the Testing frontend is deployed but
    // marks it `success` only from the `release-ready` job, which cannot start
    // until the shared backend rollout has also succeeded. So "state === success"
    // here means the whole release shipped, not just the frontend.

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
    let sawUnfinished = false;
    for (const deployment of testingDeployments) {
        if (!isSafeHaulRelease(deployment)) continue;
        const state = await latestState(deployment);
        if (state !== 'success') {
            sawUnfinished = true;
            continue;
        }
        if (!deployment.payload.landingVersionId) continue;
        resolved = { deployment, payload: deployment.payload };
        break;
    }

    if (!resolved) {
        throw new IneligibleReleaseError(
            sawUnfinished
                ? `Refusing to promote ${candidateSha}: its release has not been confirmed ready. ` +
                  'The Testing frontend deploy, the shared backend rollout (Cloud Functions, ' +
                  'Firestore rules, Storage rules, indexes) and the post-deploy smoke check must ' +
                  'all have finished successfully before a release becomes promotable.'
                : `Refusing to promote ${candidateSha}: its Testing deployment did not succeed, ` +
                  'or recorded no pinned Hosting version. A failed Testing release is not promotable.',
        );
    }

    // --- 2. Every required check must be present and green -------------------
    //
    // Defence in depth against the release record and the checks disagreeing —
    // most usefully, a commit whose checks were re-run and went red afterwards.

    const { check_runs: checkRuns = [] } = await api(
        `/commits/${candidateSha}/check-runs?per_page=100&filter=latest`,
    );

    const checks = evaluateRequiredChecks(checkRuns);
    if (!checks.ok) {
        throw new IneligibleReleaseError(
            `Refusing to promote ${candidateSha}: ${describeCheckBlockers(checks).join(' ')}`,
        );
    }

    // --- 3. Is production already serving this release? ----------------------
    //
    // Makes a double-clicked or retried promotion a safe no-op rather than a
    // second redeploy of the same bytes.

    const [currentProduction] = await readProductionReleases(api, 1);

    return {
        appVersionId: resolved.payload.appVersionId,
        landingVersionId: resolved.payload.landingVersionId,
        testingDeploymentId: String(resolved.deployment.id),
        alreadyLive: currentProduction?.sha === candidateSha,
    };
}

/**
 * The whole release picture, for the Super Admin screen.
 *
 * Unlike `resolveTestingRelease` this never throws for an ineligible release: an
 * operator looking at the screen needs to be told *why* a release cannot go out,
 * which is exactly the state a thrown error would discard.
 *
 * @param {object} options
 * @param {(path: string) => Promise<any>} options.api GitHub REST GET
 * @returns {Promise<{testing: object|null, production: object|null, previousProduction: object|null}>}
 */
async function readReleaseStatus({ api }) {
    const testing = await readLatestTestingRelease(api);
    const productionReleases = await readProductionReleases(api, 2);

    let testingView = null;
    if (testing) {
        const blockers = [];

        if (testing.state !== 'success') {
            blockers.push(
                'The shared backend rollout for this release (Cloud Functions, Firestore rules, ' +
                'Storage rules and indexes) has not been confirmed successful yet.',
            );
        }

        let checks = { failed: [], pending: [], missing: [], skipped: [], ok: true };
        try {
            const { check_runs: checkRuns = [] } = await api(
                `/commits/${testing.sha}/check-runs?per_page=100&filter=latest`,
            );
            checks = evaluateRequiredChecks(checkRuns);
        } catch {
            // Reading checks is best-effort for the *display*. It is not
            // best-effort for the promotion itself: `resolveTestingRelease` runs
            // this same evaluation server-side before anything is dispatched, and
            // again on the release runner, so a display that could not read them
            // cannot widen what is allowed.
            checks = {
                failed: [], pending: [], missing: ['(could not read checks)'], skipped: [], ok: false,
            };
        }

        blockers.push(...describeCheckBlockers(checks));

        testingView = {
            ...testing,
            checksPassed: checks.ok,
            backendReleased: testing.state === 'success',
            eligible: testing.state === 'success' && checks.ok,
            blockers,
        };
    }

    return {
        testing: testingView,
        production: productionReleases[0] || null,
        previousProduction: productionReleases[1] || null,
    };
}

/** GitHub REST GET bound to one repository. */
const createGithubApi = ({ token, repository, fetchImpl = fetch }) => async (path) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
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

module.exports = {
    NON_BLOCKING_CONCLUSIONS,
    REQUIRED_CHECK_CONCLUSIONS,
    IneligibleReleaseError,
    REQUIRED_RELEASE_CHECKS,
    createGithubApi,
    describeCheckBlockers,
    evaluateRequiredChecks,
    isFullSha,
    isSafeHaulRelease,
    readLatestTestingRelease,
    readProductionReleases,
    readReleaseStatus,
    resolveTestingRelease,
};
