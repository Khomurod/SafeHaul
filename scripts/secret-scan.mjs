#!/usr/bin/env node
/**
 * The blocking secret scanner: what THIS change introduced, and what the tree
 * holds right now.
 *
 * ## Why this file exists rather than `gitleaks/gitleaks-action@v2`
 *
 * The action decides the scan range from the event payload, and its rules were
 * read out of its own source (`src/gitleaks.js`) rather than assumed:
 *
 * | event              | `--log-opts` the action passes            |
 * |--------------------|-------------------------------------------|
 * | `pull_request`     | `--no-merges --first-parent base^..head`   |
 * | `push`             | same, or `-1` when before == after         |
 * | `workflow_dispatch`| *nothing* — so gitleaks scans ALL history  |
 * | `schedule`         | *nothing* — same                            |
 *
 * Three separate defects, each measured on 2026-08-26 rather than reasoned
 * about:
 *
 * 1. **The dispatch case scans everything.** Run #159 on `8c3315d` scanned 256
 *    commits and reported 67 findings — eight distinct values, all from
 *    2025-12 to 2026-03, none of them from the commit under test. It failed
 *    `secret-scan`, which failed `release-validation`, which skipped both
 *    deploys. A manual verification of an already-merged commit cannot mean
 *    "scan every commit SafeHaul ever had"; that turns a fixed, known,
 *    separately-tracked history problem into a permanent release blocker.
 * 2. **`--first-parent` misses whole branches.** Measured in a synthetic repo: a
 *    secret committed on a side branch and merged into main is found by
 *    `base..head` and **not found** by `--no-merges --first-parent base^..head`.
 *    The mainline walk never visits the second parent's commits.
 * 3. **`--no-merges` misses conflict resolutions.** A merge commit can add
 *    content that is in neither parent. Measured: `base..head` finds 0 there
 *    (git shows no patch for a merge by default), `-m base..head` finds it.
 *    `--cc` was tried first and finds 0 — gitleaks does not parse combined-diff
 *    format, which is exactly why this was tested instead of assumed.
 *
 * The action also resolves its gitleaks version by calling the GitHub API for
 * the LATEST release at run time. A security gate whose scanner version changes
 * underneath it is neither reproducible nor reviewable, and `v2` runs on Node 20,
 * which GitHub stops running after 2026-09-16. Pinning the CLI by version *and*
 * SHA-256 fixes all of it and removes the Node runtime from the picture.
 *
 * ## The two protections, and why one is not enough
 *
 * - **Range scan** — every commit in `base..head`, patches diffed against each
 *   parent (`-m`). Catches a secret that was committed and then deleted again
 *   inside the same change, which no scan of the final tree can see.
 * - **Tree scan** — the tracked tree at `head`, exported with `git archive` so
 *   it is exactly the committed content and not whatever else is lying around a
 *   runner. Catches a secret that is present now but does not appear as an added
 *   line in this range: a pre-existing value in a file the change merely touched,
 *   or a merge resolution.
 *
 * Either one failing fails the job. `git archive` is used rather than scanning
 * the workspace because `gitleaks dir` does **not** honour `.gitignore`: run
 * against a working copy that happens to hold `dist/` or `storybook-static/`, it
 * reports build output as a finding. Measured, again, before relying on it.
 *
 * ## Failing safe
 *
 * Every path that cannot determine a trustworthy base **exits non-zero with the
 * reason**. There is deliberately no fallback to "scan everything": that is the
 * behaviour this file replaces, and it reports six-month-old history as though
 * the current release introduced it. A scanner that cannot say what it compared
 * against has not validated anything.
 *
 * Historical findings are not hidden — they are inventoried by
 * `.github/workflows/secret-history-audit.yml` and classified in
 * `docs/SECRET_HISTORY_AUDIT.md`, which is where legacy leaks belong: a
 * deliberate security process, not a gate every unrelated release trips over.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
    rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* -------------------------------------------------------------------------- */
/* The pinned scanner                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Pinned deliberately, and pinned by content as well as by name.
 *
 * A tag can be moved; a digest cannot. Both are checked, so a compromised or
 * re-cut release fails the job instead of scanning with something nobody
 * reviewed. Bumping this means: change both values, re-run
 * `npm run audit:secret-history` (the finding count in
 * `.github/secret-history-baseline.json` is version-sensitive), and re-verify
 * the two value exemptions in `.gitleaks.toml`.
 */
export const GITLEAKS_VERSION = '8.30.1';

/** SHA-256 of `gitleaks_<version>_linux_x64.tar.gz` from the upstream release. */
export const GITLEAKS_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';

const GITLEAKS_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`
    + `/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;

/** All-zero SHA: what a push event sends for "there was nothing here before". */
const ZERO_SHA = '0'.repeat(40);

/** Events whose baseline is the previous state of the branch being verified. */
const REVERIFICATION_EVENTS = Object.freeze(['workflow_dispatch', 'schedule', 'repository_dispatch']);

/**
 * The check name this scanner looks for when asking "was that commit validated?".
 *
 * It must equal the job's name in `main.yml`; `check:ci-plan` §L asserts that,
 * because a rename here would silently mean "nothing was ever validated" — which
 * fails closed, but for a reason nobody would guess.
 */
export const SECRET_SCAN_CHECK_NAME = 'secret-scan';

/**
 * The other check a baseline has to carry, and the reason is the scanner itself.
 *
 * "Its `secret-scan` passed" is not enough, found in review on 2026-08-26 (P1):
 * a commit could BREAK this scanner so that `secret-scan` passes wrongly, while
 * `callable-contract` — which runs `npm run test:secret-scan` — fails and blocks
 * that release. The broken commit would still look validated, and the next push,
 * with the scanner fixed, would anchor there and never look at the increment the
 * broken scanner waved through.
 *
 * `Verify the release is fully validated` is the answer already in the
 * repository: it refuses unless every `ALWAYS_REQUIRED_JOBS` entry concluded
 * success, and those are `secret-scan` and `callable-contract`. So a commit
 * carrying it was scanned by a scanner that passed its own tests. It is the same
 * check `functions/releaseManagement/eligibility.js` requires by name before a
 * production promotion, which is the company it belongs in.
 */
export const RELEASE_VALIDATION_CHECK_NAME = 'Verify the release is fully validated';

/** How far back to look for a validated ancestor before giving up. */
export const VALIDATED_ANCESTOR_WALK = 50;

/** A base that could not be determined. Always fatal, never a wider scan. */
export class ScanPlanError extends Error {}

/* -------------------------------------------------------------------------- */
/* Range selection — the part that is pure, and therefore tested               */
/* -------------------------------------------------------------------------- */

/**
 * Decide what to compare against, deterministically, from the event alone.
 *
 * `git` is injected so `scripts/test-secret-scan.mjs` can drive every branch
 * against real throwaway repositories without a GitHub event in sight.
 *
 * @param {object} options
 * @param {string} options.eventName            GITHUB_EVENT_NAME
 * @param {object} options.payload              parsed GITHUB_EVENT_PATH contents
 * @param {string} options.headSha              commit actually checked out
 * @param {string} [options.baseOverride]       SECRET_SCAN_BASE, an owner escape hatch
 * @param {() => (string|null)} [options.lastValidatedBase]
 *        the newest ancestor whose own secret-scan passed, looked up before this is
 *        called; `null` when there is none, which every caller treats as a refusal
 * @param {{exists:(s:string)=>boolean, isAncestor:(a:string,b:string)=>boolean,
 *          mergeBase:(a:string,b:string)=>(string|null)}} options.git
 * @returns {{base: string, head: string, source: string, logOpts: string, describe: string}}
 */
export function resolveScanPlan({
    eventName,
    payload = {},
    headSha,
    baseOverride = '',
    lastValidatedBase = () => null,
    git,
}) {
    if (!headSha || !/^[0-9a-f]{40}$/i.test(headSha)) {
        throw new ScanPlanError(`the head commit is not a full SHA: ${JSON.stringify(headSha)}`);
    }
    if (!git.exists(headSha)) {
        throw new ScanPlanError(
            `the head commit ${short(headSha)} is not in this clone. `
            + 'Check out with `fetch-depth: 0`.',
        );
    }

    // An explicit base always wins, and is still validated exactly as hard as an
    // inferred one.
    if (baseOverride) {
        return plan(requireUsableBase(git, baseOverride, headSha, 'SECRET_SCAN_BASE'), headSha, 'explicit-base-override');
    }

    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
        const baseSha = payload?.pull_request?.base?.sha;
        if (!baseSha) {
            throw new ScanPlanError(
                'this pull_request event carries no `pull_request.base.sha`, so the change cannot '
                + 'be separated from the base branch. Refusing to scan an unknown range.',
            );
        }
        if (!git.exists(baseSha)) {
            throw new ScanPlanError(
                `the pull request's base commit ${short(baseSha)} is not in this clone. `
                + 'Check out with `fetch-depth: 0`.',
            );
        }
        // The merge base, not the base branch tip: the range then holds exactly
        // the commits this pull request proposes, and never the base branch's
        // own later history.
        const mergeBase = git.mergeBase(baseSha, headSha);
        if (!mergeBase) {
            throw new ScanPlanError(
                `no merge base between ${short(baseSha)} and ${short(headSha)} — the branches share `
                + 'no history, so "what this change adds" is undefined. Refusing to guess.',
            );
        }
        if (mergeBase === headSha) {
            throw new ScanPlanError(
                `the merge base of this pull request equals its head (${short(headSha)}), so the range `
                + 'would be empty and nothing would be compared. Refusing.',
            );
        }
        return plan(mergeBase, headSha, 'pull-request-merge-base');
    }

    if (eventName === 'push') {
        const before = payload?.before;
        /*
         * A push is compared against the last commit CI actually validated, not
         * against the push's own `before`.
         *
         * `before` is the obvious answer and it is wrong in one specific,
         * reachable way, found in review on 2026-08-26 and reproduced: when the
         * PREVIOUS push failed its scan, `before` is that failed tip. The next
         * ordinary push then compares against it, so the increment that failed
         * is behind the range; if the credential it added was also deleted in
         * that increment, the tree is clean too, and the later push passes and
         * DEPLOYS. Measured on a throwaway repository: push A (adds and deletes
         * a synthetic key) fails with 1 finding, push B passes with 0 — and the
         * same push B anchored at the last validated commit fails with 1.
         *
         * `before` is also unusable for a branch just created (all zeros) or
         * force-pushed (not an ancestor of the new head), and the old fallback
         * for those — the merge base with the default branch — collapsed to the
         * head itself after a force-push TO the default branch, scanning
         * nothing. Both cases now take the same answer as the first.
         *
         * In the healthy case this changes nothing: the previous tip passed its
         * own scan, so it IS the last validated commit and the range is
         * identical. It widens only where something was left unverified, which
         * is exactly where widening is the point. And it gives the pipeline an
         * invariant worth stating: since a deploy requires this job to pass,
         * nothing reaches Testing unless every commit since the last passing
         * scan was scanned.
         */
        const validated = lastValidatedBase();
        if (validated) {
            return plan(
                requireUsableBase(git, validated, headSha, 'the last validated commit'),
                headSha,
                'last-validated-commit',
            );
        }
        throw new ScanPlanError(
            `no ancestor of ${short(headSha)} carries a fully validated release `
            + `(before=${describeSha(before)}), so there is no baseline to compare against. A baseline `
            + `needs both "${SECRET_SCAN_CHECK_NAME}" and "${RELEASE_VALIDATION_CHECK_NAME}" to have `
            + 'succeeded in one run. Trusting `before` here is what lets the increment behind a FAILED '
            + 'scan through. Set SECRET_SCAN_BASE to a commit you know was scanned, or fix the failing '
            + 'run. Refusing to fall back to a full-history scan, or to an empty one.',
        );
    }

    if (REVERIFICATION_EVENTS.includes(eventName)) {
        /*
         * A manual or scheduled run re-verifies a commit that is already on the
         * branch, so its baseline is "the last thing CI actually validated".
         *
         * This used to be `head^1`, on the reasoning that every earlier commit
         * was scanned by the event that introduced it. Review on 2026-08-26
         * found the hole in that: it assumes the earlier scan *passed*. A push
         * whose scan FAILED, followed by a manual re-run, would scan only the
         * last commit — so a credential added in an earlier commit of that push
         * and deleted before its tip is in neither the range nor the tree, and
         * the manual run is green. `workflow_dispatch` deploys, so that is a
         * bypass of the gate rather than a gap in a report.
         *
         * The baseline is therefore the newest ancestor carrying a fully validated
         * release — which is exactly "the last validated commit" — and
         * when there is none, this refuses and asks for an explicit base. It
         * never widens to a full-history scan, and never narrows to an empty one.
         */
        const validated = lastValidatedBase();
        if (validated) {
            return plan(
                requireUsableBase(git, validated, headSha, 'the last validated commit'),
                headSha,
                'last-validated-commit',
            );
        }
        throw new ScanPlanError(
            `no ancestor of ${short(headSha)} carries a fully validated release, so there is no `
            + `baseline to compare against. A baseline needs both "${SECRET_SCAN_CHECK_NAME}" and `
            + `"${RELEASE_VALIDATION_CHECK_NAME}" to have succeeded in one run. This is what a re-run `
            + 'after a FAILED push looks like, and scanning only the newest commit would step over the '
            + 'failure. Set SECRET_SCAN_BASE to a commit you know was scanned, or fix the failing run.',
        );
    }

    throw new ScanPlanError(
        `unsupported event "${eventName}": this scanner will not guess a range it has no rule for. `
        + 'Add an explicit rule, or pass SECRET_SCAN_BASE.',
    );
}

function requireUsableBase(git, candidate, headSha, label) {
    if (!/^[0-9a-f]{7,40}$/i.test(candidate)) {
        throw new ScanPlanError(`${label} is not a commit SHA: ${JSON.stringify(candidate)}`);
    }
    /*
     * Resolve to the full SHA before anything COMPARES it.
     *
     * An abbreviated SHA of the head is a different string and the same commit,
     * and every check below except this one is a string comparison. Found in
     * review on 2026-08-26 and reproduced: `SECRET_SCAN_BASE=<head[0..8]>` was
     * accepted, `git merge-base --is-ancestor` said yes (a commit is its own
     * ancestor), and the resulting `short..full` range held 0 commits — so a
     * credential added and deleted inside the change was compared against
     * nothing and the job passed. Against the same repository with the correct
     * base it fails with 1 finding.
     */
    const resolved = git.resolve(candidate);
    if (!resolved) {
        throw new ScanPlanError(`${label}=${short(candidate)} is not a commit in this clone.`);
    }
    if (resolved === headSha) {
        throw new ScanPlanError(
            `${label}=${short(candidate)} resolves to the head itself (${short(headSha)}), so the `
            + 'range would be empty and nothing would be compared. Refusing.',
        );
    }
    if (!git.isAncestor(resolved, headSha)) {
        throw new ScanPlanError(
            `${label}=${short(candidate)} is not an ancestor of ${short(headSha)}, so `
            + `${short(candidate)}..${short(headSha)} would not describe this change.`,
        );
    }
    // The canonical SHA, never the string that was handed in: everything
    // downstream — the equality guard in `plan()`, the range, the report —
    // compares and prints it.
    return resolved;
}

/**
 * `-m` is the flag that makes merge commits visible.
 *
 * `git log -p` prints no patch for a merge, so a secret added while resolving a
 * conflict is invisible without it — measured, not assumed. `-m` diffs a merge
 * against each parent, which over-reports (a merge shows twice) and never
 * under-reports. For a security gate that direction is the only acceptable one.
 *
 * Neither `--first-parent` nor `--no-merges` appears here, deliberately: they are
 * what let a secret ride in on a second parent.
 */
function plan(base, head, source) {
    if (base === head) {
        throw new ScanPlanError(
            `the computed base equals the head (${short(head)}), so the range is empty and nothing `
            + `would be compared (source: ${source}). Refusing.`,
        );
    }
    return {
        base,
        head,
        source,
        logOpts: `-m ${base}..${head}`,
        describe: `${short(base)}..${short(head)} (${source})`,
    };
}

const short = (sha) => String(sha || '').slice(0, 8);
const describeSha = (sha) => (!sha ? 'absent' : (sha === ZERO_SHA ? 'all zeros' : short(sha)));

/* -------------------------------------------------------------------------- */
/* Running the scanner                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The git questions the plan needs, as booleans and SHAs.
 *
 * Exported so `scripts/test-secret-scan.mjs` drives range selection through the
 * same plumbing CI uses. A test that reimplements these gets to be wrong in a
 * way the gate is not — the first version of that test did exactly that, reading
 * `git cat-file -e` (which prints nothing on success) as "commit missing".
 */
export const gitRunner = (cwd) => ({
    exists: (sha) => run('git', ['cat-file', '-e', `${sha}^{commit}`], cwd).ok,
    isAncestor: (a, b) => run('git', ['merge-base', '--is-ancestor', a, b], cwd).ok,
    mergeBase: (a, b) => {
        const result = run('git', ['merge-base', a, b], cwd);
        return result.ok ? result.stdout.trim() : null;
    },
    resolve: (ref) => {
        const result = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
        return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    },
});

/**
 * The newest ancestor of `headSha` that carries a fully validated release.
 *
 * "Validated" means one workflow run in which BOTH `secret-scan` and
 * `Verify the release is fully validated` concluded success — the second because
 * a scanner that passed while its own tests failed has validated nothing (see
 * RELEASE_VALIDATION_CHECK_NAME).
 *
 * It is asked of GitHub
 * because git cannot answer it: a commit's history says nothing about whether CI
 * ever passed on it. Walking first-parent is deliberate and conservative — for a
 * merge it lands on the previous branch tip rather than on the merged branch's
 * head, which makes the range wider, never narrower.
 *
 * `sha` is `null` when nothing qualifies, and the callers treat that as a refusal
 * rather than a licence to scan less. A lookup that could not run is also `null`,
 * for the same reason — an unanswerable question is not a "yes" — but it carries
 * `error`, so the refusal can say which of the two it was.
 *
 * What this inherits, stated plainly: trusting a commit because its own scan
 * passed means trusting the scanner that ran then. An ancestor scanned by the
 * old action's `--no-merges --first-parent` range could have passed while
 * missing a secret that arrived through a second parent. That secret is still
 * caught here if it is in the tree at `head`; if it was added and removed in
 * history, it belongs to `secret-history-audit`, which sweeps everything. The
 * alternative — trusting a commit merely because it EXISTS — is the P1 this
 * function replaced, and it is strictly worse.
 *
 * @returns {Promise<{sha: string|null, checked: number, error: string|null}>}
 */
export async function findLastValidatedAncestor({
    headSha, cwd, repository, token, fetchImpl = fetch, walk = VALIDATED_ANCESTOR_WALK,
}) {
    if (!repository || !token) {
        return { sha: null, checked: 0, error: 'no GITHUB_REPOSITORY/GITHUB_TOKEN to ask with' };
    }
    const listed = run('git', ['rev-list', '--first-parent', '--max-count', String(walk + 1), headSha], cwd);
    if (!listed.ok) {
        return { sha: null, checked: 0, error: `git rev-list failed: ${listed.stderr.trim()}` };
    }
    const ancestors = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(1);

    let checked = 0;
    for (const candidate of ancestors) {
        checked += 1;
        let response;
        try {
            response = await fetchImpl(
                `https://api.github.com/repos/${repository}/commits/${candidate}/check-runs`
                + '?status=completed&per_page=100',
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                },
            );
        } catch (error) {
            // An unanswerable question is not a "yes". Reported rather than
            // swallowed, because "no validated ancestor" and "could not ask" fail
            // the same way and need very different fixes.
            return { sha: null, checked, error: `request failed: ${error?.message || error}` };
        }
        if (!response?.ok) {
            return { sha: null, checked, error: `GitHub answered ${response?.status}` };
        }
        let body;
        try {
            body = await response.json();
        } catch (error) {
            return { sha: null, checked, error: `unreadable response: ${error?.message || error}` };
        }
        /*
         * Both checks, and both from the SAME check suite — one workflow run.
         *
         * Taking them from different runs would accept "some run scanned it" plus
         * "some other run validated it", which is not the same claim as "one run
         * scanned it with a scanner that had passed its own tests". Grouping by
         * suite costs a Map and removes the ambiguity.
         */
        const runs = Array.isArray(body?.check_runs) ? body.check_runs : [];
        const succeededBySuite = new Map();
        for (const entry of runs) {
            const suite = entry?.check_suite?.id;
            if (suite === undefined || suite === null) continue;
            if (entry?.status !== 'completed' || entry?.conclusion !== 'success') continue;
            if (!succeededBySuite.has(suite)) succeededBySuite.set(suite, new Set());
            succeededBySuite.get(suite).add(entry.name);
        }
        const validated = [...succeededBySuite.values()].some(
            (names) => names.has(SECRET_SCAN_CHECK_NAME) && names.has(RELEASE_VALIDATION_CHECK_NAME),
        );
        if (validated) {
            return { sha: candidate, checked, error: null };
        }
    }
    return { sha: null, checked, error: null };
}

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    return {
        ok: result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

/**
 * Fetch the pinned scanner, or use the one the caller supplies.
 *
 * `GITLEAKS_BIN` lets the test suite and a developer run the real binary without
 * a download per case. The download path verifies the digest before the archive
 * is ever unpacked.
 */
export function ensureGitleaks({ cacheDir = join(tmpdir(), 'safehaul-gitleaks') } = {}) {
    const supplied = process.env.GITLEAKS_BIN;
    if (supplied) {
        if (!existsSync(supplied)) throw new Error(`GITLEAKS_BIN does not exist: ${supplied}`);
        return supplied;
    }

    const binary = join(cacheDir, `gitleaks-${GITLEAKS_VERSION}`);
    if (existsSync(binary)) return binary;

    // The pinned digest belongs to one asset: the linux x64 build CI runs. Say
    // so plainly rather than downloading something the digest cannot match, or
    // (worse) relaxing the check to make another platform work.
    if (process.platform !== 'linux' || process.arch !== 'x64') {
        throw new Error(
            `no pinned gitleaks build for ${process.platform}/${process.arch}. `
            + 'CI runs linux x64; elsewhere, install gitleaks '
            + `${GITLEAKS_VERSION} yourself and point GITLEAKS_BIN at it.`,
        );
    }

    mkdirSync(cacheDir, { recursive: true });
    const archive = join(cacheDir, `gitleaks-${GITLEAKS_VERSION}.tar.gz`);
    execFileSync('curl', ['-sSL', '--retry', '3', '--max-time', '180', '-o', archive, GITLEAKS_URL], {
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (actual !== GITLEAKS_SHA256) {
        rmSync(archive, { force: true });
        throw new Error(
            `gitleaks ${GITLEAKS_VERSION} failed its digest check.\n`
            + `  expected ${GITLEAKS_SHA256}\n  received ${actual}\n`
            + 'Refusing to run an unverified scanner.',
        );
    }

    execFileSync('tar', ['xzf', archive, '-C', cacheDir, 'gitleaks'], { stdio: 'inherit' });
    renameSync(join(cacheDir, 'gitleaks'), binary);
    chmodSync(binary, 0o755);
    return binary;
}

/**
 * One gitleaks invocation, reported as data.
 *
 * `--redact` is not optional: findings are printed in CI logs, attached as
 * artifacts and quoted in summaries, and none of those may carry a value.
 *
 * gitleaks exits 1 both for "leaks found" and for "something went wrong", so the
 * two are told apart by whether a parseable report was produced — and both fail
 * the job. A scanner that errored has proven nothing, which must never read as
 * "clean".
 */
export function runGitleaksScan({ binary, mode, target, logOpts, config, reportPath }) {
    const args = mode === 'git'
        ? ['git', '--log-opts', logOpts, target]
        : ['dir', target];
    args.push(
        '--redact', '--no-banner', '--no-color',
        '--report-format', 'json', '--report-path', reportPath,
    );
    if (config) args.push('--config', config);

    const result = spawnSync(binary, args, { encoding: 'utf8' });
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    let findings = null;
    if (existsSync(reportPath)) {
        try {
            const parsed = JSON.parse(readFileSync(reportPath, 'utf8') || '[]');
            if (Array.isArray(parsed)) findings = parsed;
        } catch {
            findings = null;
        }
    }

    if (findings === null) {
        return {
            ok: false,
            errored: true,
            findings: [],
            output,
            detail: `gitleaks (${mode}) produced no readable report; exit=${result.status}`,
        };
    }
    /*
     * A readable report is not by itself proof that the scan finished.
     *
     * Review on 2026-08-26 (P1): a nonzero exit that still left a parseable
     * EMPTY report set `ok` false and `errored` false, and `performScans` only
     * looked at `errored` and the finding count — so it recorded no problem and
     * the release gate reported success over a scan that had failed. Nonzero
     * with nothing to show for it is an incomplete scan, and it is reported as
     * one. (I could not make gitleaks 8.30.1 do this: every failure mode probed
     * either exits 0 or writes no report at all. That is not a reason to leave
     * the branch open — the guarantee is "a scanner failure never reads as
     * success", and it should not rest on one version's exit-code habits.)
     */
    if (result.status !== 0 && findings.length === 0) {
        return {
            ok: false,
            errored: true,
            findings,
            output,
            detail: `gitleaks (${mode}) exited ${result.status} with no findings — an incomplete `
                + 'scan, not a clean one',
        };
    }
    return {
        ok: result.status === 0 && findings.length === 0,
        errored: false,
        findings,
        output,
        detail: `${findings.length} finding(s)`,
    };
}

/**
 * Both protections, in one place, so `scripts/test-secret-scan.mjs` exercises
 * the code the gate actually runs rather than a reimplementation of it.
 *
 * @returns {{ok: boolean, range: object, tree: object, problems: string[]}}
 */
export function performScans({ binary, cwd, plan: scanPlan, config, workDir }) {
    const range = runGitleaksScan({
        binary,
        mode: 'git',
        target: cwd,
        logOpts: scanPlan.logOpts,
        config,
        reportPath: join(workDir, 'range.json'),
    });

    // The tracked tree at `head`, exported rather than read off the workspace:
    // `gitleaks dir` does not honour `.gitignore`, so scanning a working copy
    // makes `dist/` and `storybook-static/` into findings.
    const treeDir = join(workDir, 'tree');
    mkdirSync(treeDir, { recursive: true });
    // Written to a file and extracted separately rather than piped through a
    // shell: no quoting to get wrong, and a failure in either half is visible
    // instead of being swallowed by the pipe's exit status.
    const tarball = join(workDir, 'tree.tar');
    const archived = spawnSync(
        'git',
        ['archive', '--format=tar', `--output=${tarball}`, scanPlan.head],
        { cwd, encoding: 'utf8' },
    );
    if (archived.status === 0) {
        const extracted = spawnSync('tar', ['-xf', tarball, '-C', treeDir], { encoding: 'utf8' });
        if (extracted.status !== 0) {
            return {
                ok: false,
                range,
                tree: {
                    ok: false, errored: true, findings: [], output: extracted.stderr || '', detail: 'tar extract failed',
                },
                problems: [`could not unpack the tree at ${short(scanPlan.head)}: ${extracted.stderr || 'unknown error'}`],
            };
        }
    }
    if (archived.status !== 0) {
        return {
            ok: false,
            range,
            tree: { ok: false, errored: true, findings: [], output: archived.stderr || '', detail: 'git archive failed' },
            problems: [`could not export the tree at ${short(scanPlan.head)}: ${archived.stderr || 'unknown error'}`],
        };
    }
    const tree = runGitleaksScan({
        binary,
        mode: 'dir',
        target: treeDir,
        config,
        reportPath: join(workDir, 'tree.json'),
    });
    // The tree was exported to a temp directory; report the paths a reader can
    // actually open, not the scratch location they were scanned in.
    for (const finding of tree.findings) {
        if (typeof finding.File === 'string' && finding.File.startsWith(treeDir)) {
            finding.File = finding.File.slice(treeDir.length).replace(/^[/\\]/, '');
        }
    }

    const problems = [];
    for (const [label, scan] of [['commit range', range], ['source tree', tree]]) {
        if (scan.errored) problems.push(`the ${label} scan did not complete: ${scan.detail}`);
        else if (scan.findings.length > 0) problems.push(`${scan.findings.length} finding(s) in the ${label}`);
        // Belt and braces for the same P1: whatever produced `ok === false`,
        // this refuses. Nothing may reach the deploy on a scan that did not
        // say, unambiguously, that it found nothing.
        else if (!scan.ok) problems.push(`the ${label} scan did not report success: ${scan.detail}`);
    }
    return { ok: problems.length === 0, range, tree, problems };
}

/** Findings, described without ever quoting what was found. */
export function describeFindings(findings) {
    return findings.map((f) => {
        const where = f.Commit ? `${short(f.Commit)}:${f.File}` : f.File;
        return `  ${f.RuleID} — ${where}:${f.StartLine}`;
    });
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

async function main() {
    const cwd = process.cwd();
    const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let payload = {};
    if (eventPath && existsSync(eventPath)) {
        try {
            payload = JSON.parse(readFileSync(eventPath, 'utf8'));
        } catch (error) {
            fail(`GITHUB_EVENT_PATH could not be parsed: ${error.message}`);
        }
    }

    const git = gitRunner(cwd);
    const headSha = process.env.GITHUB_SHA && git.exists(process.env.GITHUB_SHA)
        ? process.env.GITHUB_SHA
        : git.resolve('HEAD');
    // Looked up once, only if the event's own baseline turns out to be unusable,
    // and awaited before the (synchronous) plan is resolved.
    let validatedBase;
    // Every event except a pull request compares against a validated commit, so
    // every one of them has to ask. A pull request has its merge base, which is
    // what the change proposes and needs nothing from GitHub.
    const needsValidatedBase = REVERIFICATION_EVENTS.includes(eventName) || eventName === 'push';
    let lookupError = null;
    if (needsValidatedBase && !(process.env.SECRET_SCAN_BASE || '').trim()) {
        const lookup = await findLastValidatedAncestor({
            headSha,
            cwd,
            repository: process.env.GITHUB_REPOSITORY,
            token: process.env.GITHUB_TOKEN,
        });
        validatedBase = lookup.sha;
        lookupError = lookup.error;
        console.log(`validated  : ${validatedBase ? short(validatedBase) : 'none found'}`
            + ` (asked about ${lookup.checked} ancestor(s)${lookup.error ? `; ${lookup.error}` : ''})`);
    }

    let scanPlan;
    try {
        scanPlan = resolveScanPlan({
            eventName,
            payload,
            headSha,
            baseOverride: (process.env.SECRET_SCAN_BASE || '').trim(),
            lastValidatedBase: () => validatedBase || null,
            git,
        });
    } catch (error) {
        fail(
            `${error.message}\n\n`
            + (lookupError
                ? `The baseline lookup could not complete: ${lookupError}. That is why no validated `
                  + 'ancestor was found — it is not evidence that none exists.\n\n'
                : '')
            + 'This job fails closed on purpose. It will not widen to a full-history scan, '
            + 'which is what reported known 2025-2026 legacy findings against unrelated releases. '
            + 'See docs/SECRET_HISTORY_AUDIT.md.',
        );
        return;
    }

    console.log(`event      : ${eventName}`);
    console.log(`head       : ${scanPlan.head}`);
    console.log(`base       : ${scanPlan.base}`);
    console.log(`range      : ${scanPlan.describe}`);
    console.log(`log-opts   : ${scanPlan.logOpts}`);
    console.log(`gitleaks   : ${GITLEAKS_VERSION} (pinned, digest-verified)`);

    const commitCount = run(
        'git', ['rev-list', '--count', `${scanPlan.base}..${scanPlan.head}`], cwd,
    ).stdout.trim();
    console.log(`commits    : ${commitCount}`);

    const binary = ensureGitleaks();
    const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-'));
    const config = existsSync(join(cwd, '.gitleaks.toml')) ? join(cwd, '.gitleaks.toml') : undefined;

    const { range, tree, problems } = performScans({
        binary, cwd, plan: scanPlan, config, workDir: work,
    });

    for (const [label, scan] of [['commit range', range], ['source tree', tree]]) {
        if (scan.errored) {
            console.error(scan.output);
            continue;
        }
        if (scan.findings.length > 0) {
            console.error(`\n${scan.findings.length} finding(s) in the ${label}:`);
            console.error(describeFindings(scan.findings).join('\n'));
        }
    }

    const summary = [
        '## Secret scan',
        '',
        `- event: \`${eventName}\``,
        `- range: \`${scanPlan.describe}\` — ${commitCount} commit(s)`,
        `- scanner: gitleaks \`${GITLEAKS_VERSION}\` (pinned by version and digest)`,
        `- commit-range findings: ${range.errored ? 'scan failed' : range.findings.length}`,
        `- source-tree findings: ${tree.errored ? 'scan failed' : tree.findings.length}`,
        '',
        problems.length === 0
            ? 'No secret was introduced by this change, and none is present in the tracked tree.'
            : `**Refused.** ${problems.join('; ')}. Values are redacted everywhere; see the job log for rule, file and line.`,
        '',
        'Legacy findings in old history are inventoried separately by the'
        + ' `secret-history-audit` workflow and classified in `docs/SECRET_HISTORY_AUDIT.md`.',
    ].join('\n');
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    if (process.env.SECRET_SCAN_REPORT_DIR) {
        mkdirSync(process.env.SECRET_SCAN_REPORT_DIR, { recursive: true });
        writeFileSync(
            join(process.env.SECRET_SCAN_REPORT_DIR, 'secret-scan-report.json'),
            `${JSON.stringify({
                event: eventName,
                base: scanPlan.base,
                head: scanPlan.head,
                source: scanPlan.source,
                logOpts: scanPlan.logOpts,
                gitleaks: GITLEAKS_VERSION,
                commits: Number(commitCount),
                // Redacted findings only: rule, path, line. Never a value.
                rangeFindings: range.findings.map(redactFinding),
                treeFindings: tree.findings.map(redactFinding),
            }, null, 2)}\n`,
        );
    }

    rmSync(work, { recursive: true, force: true });

    if (problems.length > 0) {
        console.error(`\nsecret-scan REFUSED: ${problems.join('; ')}`);
        process.exit(1);
    }
    console.log('\nsecret-scan OK: nothing introduced by this change, nothing in the tree.');
}

const redactFinding = (f) => ({
    rule: f.RuleID,
    file: f.File,
    line: f.StartLine,
    commit: f.Commit || null,
    date: f.Date || null,
});

function fail(message) {
    console.error(`secret-scan REFUSED\n\n${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Secret scan\n\n**Refused.**\n\n\`\`\`\n${message}\n\`\`\`\n`,
        );
    }
    process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => fail(error?.stack || String(error)));
}
