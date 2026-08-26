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
 * @param {string} [options.defaultBranchRef]   e.g. `origin/main`, for the push fallback
 * @param {string} [options.baseOverride]       SECRET_SCAN_BASE, an owner escape hatch
 * @param {{exists:(s:string)=>boolean, isAncestor:(a:string,b:string)=>boolean,
 *          mergeBase:(a:string,b:string)=>(string|null), firstParent:(s:string)=>(string|null),
 *          resolve:(r:string)=>(string|null)}} options.git
 * @returns {{base: string|null, head: string, source: string, logOpts: string, describe: string}}
 */
export function resolveScanPlan({
    eventName,
    payload = {},
    headSha,
    defaultBranchRef = 'origin/main',
    baseOverride = '',
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

    // An explicit base always wins, and is still validated. This exists for the
    // one gap the induction below cannot cover: a push that landed without ever
    // running CI (an API merge does not create a workflow run), leaving more than
    // one increment unscanned. It is checked exactly as hard as an inferred base.
    if (baseOverride) {
        const base = requireAncestor(git, baseOverride, headSha, 'SECRET_SCAN_BASE');
        return plan(base, headSha, 'explicit-base-override');
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
        return plan(mergeBase, headSha, 'pull-request-merge-base');
    }

    if (eventName === 'push') {
        const before = payload?.before;
        // `before` is the branch's previous tip and is the right answer for an
        // ordinary push, INCLUDING a merge: everything the merge introduced is
        // reachable from the new head and not from the old one. It is not
        // trustworthy for a branch that was just created (all zeros) or
        // force-pushed (not an ancestor), so both are detected rather than
        // assumed away.
        if (before && before !== ZERO_SHA && git.exists(before) && git.isAncestor(before, headSha)) {
            return plan(before, headSha, 'push-before');
        }

        // New or rewritten branch: fall back to where it diverged from the
        // default branch, which is still a bounded, meaningful range.
        const defaultSha = git.resolve(defaultBranchRef);
        if (defaultSha) {
            const mergeBase = git.mergeBase(defaultSha, headSha);
            if (mergeBase) return plan(mergeBase, headSha, 'push-default-branch-merge-base');
        }
        throw new ScanPlanError(
            `this push gives no usable baseline (before=${describeSha(before)}) and no merge base `
            + `with ${defaultBranchRef} could be found. Refusing to fall back to a full-history scan.`,
        );
    }

    if (REVERIFICATION_EVENTS.includes(eventName)) {
        // A manual or scheduled run re-verifies a commit that is already on the
        // branch. Its baseline is the state the branch was in before that commit
        // — the first parent — which for a merge is the previous branch tip.
        //
        // Sound because every commit reached the branch through an event that
        // scanned its own range, so the only unscanned increment is this one; and
        // because the tree scan below re-checks the whole current tree regardless
        // of range. Where that induction is broken (a push that never ran CI),
        // `SECRET_SCAN_BASE` above is the deliberate, auditable repair.
        const parent = git.firstParent(headSha);
        if (parent) return plan(parent, headSha, 'previous-first-parent');

        // A root commit has no "before". Its whole history IS the one commit, so
        // scanning it is precise rather than a fallback to everything.
        return {
            base: null,
            head: headSha,
            source: 'root-commit',
            logOpts: `-m --max-count=1 ${headSha}`,
            describe: `the root commit ${short(headSha)} (no parent to compare against)`,
        };
    }

    throw new ScanPlanError(
        `unsupported event "${eventName}": this scanner will not guess a range it has no rule for. `
        + 'Add an explicit rule, or pass SECRET_SCAN_BASE.',
    );
}

function requireAncestor(git, candidate, headSha, label) {
    if (!/^[0-9a-f]{7,40}$/i.test(candidate)) {
        throw new ScanPlanError(`${label} is not a commit SHA: ${JSON.stringify(candidate)}`);
    }
    if (!git.exists(candidate)) {
        throw new ScanPlanError(`${label}=${short(candidate)} is not a commit in this clone.`);
    }
    if (!git.isAncestor(candidate, headSha)) {
        throw new ScanPlanError(
            `${label}=${short(candidate)} is not an ancestor of ${short(headSha)}, so `
            + `${short(candidate)}..${short(headSha)} would not describe this change.`,
        );
    }
    return candidate;
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
    firstParent: (sha) => {
        const result = run('git', ['rev-parse', '--verify', '--quiet', `${sha}^1`], cwd);
        return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    },
    resolve: (ref) => {
        const result = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
        return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    },
});

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
    const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || 'main';

    let scanPlan;
    try {
        scanPlan = resolveScanPlan({
            eventName,
            payload,
            headSha,
            defaultBranchRef: git.resolve(`origin/${defaultBranch}`) ? `origin/${defaultBranch}` : defaultBranch,
            baseOverride: (process.env.SECRET_SCAN_BASE || '').trim(),
            git,
        });
    } catch (error) {
        fail(
            `${error.message}\n\n`
            + 'This job fails closed on purpose. It will not widen to a full-history scan, '
            + 'which is what reported known 2025-2026 legacy findings against unrelated releases. '
            + 'See docs/SECRET_HISTORY_AUDIT.md.',
        );
        return;
    }

    console.log(`event      : ${eventName}`);
    console.log(`head       : ${scanPlan.head}`);
    console.log(`base       : ${scanPlan.base || '(root commit)'}`);
    console.log(`range      : ${scanPlan.describe}`);
    console.log(`log-opts   : ${scanPlan.logOpts}`);
    console.log(`gitleaks   : ${GITLEAKS_VERSION} (pinned, digest-verified)`);

    const commitCount = scanPlan.base
        ? run('git', ['rev-list', '--count', `${scanPlan.base}..${scanPlan.head}`], cwd).stdout.trim()
        : '1';
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
