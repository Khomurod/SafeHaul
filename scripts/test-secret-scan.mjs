#!/usr/bin/env node
/**
 * Tests for the blocking secret scanner: the range it chooses, and what that
 * range actually catches.
 *
 * Plain assertions, no external runner, matching `scripts/test-ci-plan.mjs`.
 * Exit 0 = all pass.
 *
 * ## Why these tests are the point of the change
 *
 * The defect they exist to prevent was not a wrong regex — it was a wrong
 * *range*, chosen invisibly by a third-party action, and nothing in this
 * repository could see it. `workflow_dispatch` scanned all 256 commits and
 * reported eight known legacy values as though the release had introduced them;
 * `--first-parent` quietly skipped whole merged branches. Both are range bugs,
 * both were silent, and a rule-level test would have passed through either.
 *
 * So every case below is about scope: what gets compared against what, per
 * event, and which secrets that does and does not catch. Sections B and C run
 * the **real pinned gitleaks** over **real throwaway git repositories** built by
 * this file, through `performScans` — the same function `secret-scan.mjs` runs in
 * CI, not a reimplementation of it.
 *
 * ## The fixtures contain no real credential, and no literal at all
 *
 * Every synthetic secret is derived at run time from a fixed seed (`synth`
 * below). Two consequences, both deliberate:
 *
 *   - the values are identical on every run, so a failure is reproducible;
 *   - no secret-shaped literal is ever committed to this repository, so this
 *     file does not need an allowlist entry and cannot become the place a real
 *     leak hides. The only literals here are the two values `.gitleaks.toml`
 *     already exempts by name — which is precisely what cases 11 and 12 test.
 */

import { execFileSync } from 'node:child_process';
import {
    chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GITLEAKS_SHA256,
    GITLEAKS_VERSION,
    ScanPlanError,
    ensureGitleaks,
    findLastValidatedAncestor,
    gitRunner,
    performScans,
    resolveScanPlan,
    runGitleaksScan,
} from './secret-scan.mjs';
import { evaluateAudit, fingerprintOf } from './secret-history-audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_CONFIG = resolvePath(here, '../.gitleaks.toml');

let failures = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${detail}`);
}

function throws(label, fn, detail) {
    try {
        fn();
        failures += 1;
        console.log(`  FAIL ${label}`);
        console.log(`       it returned instead of refusing${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
        if (error instanceof ScanPlanError) {
            console.log(`  ok   ${label}`);
            return;
        }
        failures += 1;
        console.log(`  FAIL ${label}`);
        console.log(`       threw ${error?.constructor?.name}: ${error?.message}`);
    }
}

/* -------------------------------------------------------------------------- */
/* Synthetic secrets, derived rather than written down                          */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, seeded, and identical on every platform. */
function prng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function synth(seed, length) {
    const random = prng(seed);
    let out = '';
    for (let i = 0; i < length; i += 1) out += ALPHA[Math.floor(random() * ALPHA.length)];
    return out;
}

/**
 * A Google-API-key-shaped value: matches `gcp-api-key` and clears its entropy
 * floor, while saying NOTREAL in the middle of itself. Verified to be detected
 * by the pinned scanner (case B0 below asserts it, so a fixture that stops
 * tripping the rule fails loudly instead of making every other case vacuous).
 */
const FAKE_GCP_KEY = `AIza${'SyNOTREAL'}${synth(20260826, 26)}`;
const FAKE_GCP_KEY_2 = `AIza${'SyNOTREAL'}${synth(20260901, 26)}`;

/** The two values `.gitleaks.toml` exempts by name — the real literals. */
const ALLOWED_PLACEHOLDER_KEY = 'AIzaSyE2EPlaceholderKey1234567890123';
const ALLOWED_SLOT_KEY = '2026-08-02_safehaul-education';

/* -------------------------------------------------------------------------- */
/* Throwaway repositories                                                      */
/* -------------------------------------------------------------------------- */

const scratch = [];

function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'safehaul-secret-test-'));
    scratch.push(dir);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tests@safehaul.invalid');
    git('config', 'user.name', 'SafeHaul tests');
    git('config', 'commit.gpgsign', 'false');

    const api = {
        dir,
        git,
        /** The repository's own gitleaks config, so exemptions under test are the real ones. */
        useRepoConfig() {
            copyFileSync(REPO_CONFIG, join(dir, '.gitleaks.toml'));
            return api;
        },
        write(path, contents) {
            const full = join(dir, path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, `${contents}\n`);
            return api;
        },
        remove(path) {
            execFileSync('rm', ['-f', join(dir, path)]);
            return api;
        },
        commit(message) {
            git('add', '-A');
            git('commit', '-q', '--allow-empty', '-m', message);
            return api.head();
        },
        head: () => git('rev-parse', 'HEAD'),
        rev: (ref) => git('rev-parse', ref),
        checkoutNew(branch, from) {
            git('checkout', '-q', '-b', branch, ...(from ? [from] : []));
            return api;
        },
        checkout(branch) {
            git('checkout', '-q', branch);
            return api;
        },
        merge(branch, message) {
            git('merge', '-q', '--no-ff', '-m', message, branch);
            return api.head();
        },
        // The production plumbing, not a copy of it.
        gitOps: () => gitRunner(dir),
    };
    return api;
}

/** Run the real two-part scan exactly as CI does, and report pass/fail. */
function scan(repo, plan, binary) {
    const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-test-'));
    scratch.push(work);
    const config = existsSync(join(repo.dir, '.gitleaks.toml'))
        ? join(repo.dir, '.gitleaks.toml')
        : REPO_CONFIG;
    return performScans({ binary, cwd: repo.dir, plan, config, workDir: work });
}

/* ========================================================================== */
console.log('A. Range selection — what each event compares against');
/* ========================================================================== */

{
    // main: A -> B (ancient) ; feature branched at B, adds C and D
    const repo = makeRepo();
    repo.write('readme.md', 'a');
    const a = repo.commit('A');
    repo.write('readme.md', 'b');
    const b = repo.commit('B');
    repo.checkoutNew('feature');
    repo.write('feature.md', 'c');
    repo.commit('C');
    repo.write('feature.md', 'd');
    const d = repo.commit('D');
    repo.checkout('main');
    repo.write('readme.md', 'e');
    const e = repo.commit('E — base branch moved on after the fork');

    const git = repo.gitOps();
    /** Stands in for "GitHub says this commit's own secret-scan passed". */
    const validated = (sha) => () => sha;
    const nothingValidated = () => null;

    // 5. A pull request scans only its own ancestry.
    const pr = resolveScanPlan({
        eventName: 'pull_request',
        payload: { pull_request: { base: { sha: e } } },
        headSha: d,
        git,
    });
    assert('A1 (req 5). pull_request compares against the MERGE BASE, not the base tip',
        pr.base === b,
        `expected the fork point ${b.slice(0, 8)}, got ${String(pr.base).slice(0, 8)}`);
    assert('A2 (req 5). the pull request range therefore excludes the base branch\'s own later commits',
        !pr.logOpts.includes(e) && pr.logOpts.includes(`${b}..${d}`),
        pr.logOpts);
    assert('A3 (req 5). and excludes ancient history before the fork',
        pr.base !== a,
        'a range starting at the first commit is the bug this replaces');

    // 6. A push to main scans what the push introduced. In the healthy case the
    // previous tip passed its own scan, so it IS the last validated commit and
    // the range is exactly what the push added.
    const push = resolveScanPlan({
        eventName: 'push',
        payload: { before: b, after: e },
        headSha: e,
        lastValidatedBase: validated(b),
        git,
    });
    assert('A4 (req 6). push uses the event\'s previous tip as the base',
        push.base === b && push.source === 'last-validated-commit',
        `${push.source}: ${String(push.base).slice(0, 8)}`);

    /*
     * ...and it is NOT the previous tip when that tip's own scan failed. Review
     * on 2026-08-26: `before` is the failed tip, so the increment that failed is
     * behind the range, and if its credential was also deleted there the tree is
     * clean too — the later push passes and deploys. B16/B17 below measure it.
     */
    // `before` here is B: a real ancestor of the head, exactly what an ordinary
    // push carries — but B's own scan failed, so A is the last validated commit.
    const pushAfterFailure = resolveScanPlan({
        eventName: 'push',
        payload: { before: b, after: e },
        headSha: e,
        lastValidatedBase: validated(a),
        git,
    });
    assert('A4b (req 6). a push whose previous tip FAILED widens to the last validated commit',
        pushAfterFailure.base === a && pushAfterFailure.source === 'last-validated-commit',
        `${pushAfterFailure.source}: ${String(pushAfterFailure.base).slice(0, 8)}`);
    throws('A4c (req 10). and with nothing validated it refuses rather than trusting `before`',
        () => resolveScanPlan({
            eventName: 'push',
            payload: { before: b, after: e },
            headSha: e,
            lastValidatedBase: nothingValidated,
            git,
        }),
        'a usable-looking `before` is not evidence that anything was ever scanned');

    // 8 + 9. Manual re-verification of an already-merged commit.
    const dispatch = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: e, lastValidatedBase: validated(b), git,
    });
    assert('A5 (req 8). workflow_dispatch compares against the last VALIDATED commit',
        dispatch.base === b && dispatch.source === 'last-validated-commit',
        `${dispatch.source}: ${String(dispatch.base).slice(0, 8)}`);
    assert('A6 (req 8, 23). and never against the whole history',
        dispatch.logOpts.includes('..') && !dispatch.logOpts.includes('--all'),
        dispatch.logOpts);

    const again = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: e, lastValidatedBase: validated(b), git,
    });
    assert('A7 (req 9). repeating the same manual run produces the identical range',
        again.logOpts === dispatch.logOpts,
        `${dispatch.logOpts} vs ${again.logOpts}`);

    assert('A8. schedule is treated like a manual re-verification, not a full sweep',
        resolveScanPlan({
            eventName: 'schedule', headSha: e, lastValidatedBase: validated(b), git,
        }).logOpts === dispatch.logOpts,
        'the full sweep is the separate audit workflow, which gates nothing');

    // 7. A merge must not be able to hide a second parent.
    repo.checkout('main');
    const merge = repo.merge('feature', 'merge feature into main');
    const mergePush = resolveScanPlan({
        eventName: 'push',
        payload: { before: e, after: merge },
        headSha: merge,
        lastValidatedBase: validated(e),
        git,
    });
    assert('A9 (req 7). a merge push scans everything the merge introduced',
        mergePush.base === e,
        `${String(mergePush.base).slice(0, 8)}`);
    assert('A10 (req 7). no range ever uses --first-parent or --no-merges',
        [pr, push, dispatch, mergePush]
            .every((p) => !/--first-parent|--no-merges/.test(p.logOpts)),
        'those two flags are what let a secret ride in on a second parent');
    assert('A11 (req 7). every range passes -m so merge commits are diffed against each parent',
        [pr, push, dispatch, mergePush].every((p) => p.logOpts.startsWith('-m ')),
        'without -m, git prints no patch for a merge and a conflict resolution is invisible');

    /*
     * Found in review on 2026-08-26 (P1).
     *
     * A manual re-run used to compare against `head^1`, on the reasoning that
     * every earlier commit was scanned by the event that introduced it. That
     * assumes the earlier scan PASSED. After a push whose scan FAILED, a manual
     * re-run would scan only the newest commit — so a credential added earlier in
     * that push and deleted before its tip is in neither the range nor the tree,
     * and `workflow_dispatch` deploys. The baseline is the last VALIDATED commit
     * now, and no validated commit means refusal.
     */
    throws('A12 (req 10). a manual run with no validated ancestor REFUSES',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: e, lastValidatedBase: nothingValidated, git,
        }),
        'this is the re-run-after-a-failed-push case; scanning one commit would step over it');

    /*
     * Also found in review on 2026-08-26 (P1).
     *
     * A force-push to the default branch leaves `before` non-ancestral, and the
     * old fallback took the merge base with the default branch — which IS the
     * head after a force-push, giving the empty range `head..head`. A credential
     * added and removed inside the rewritten commits passed both scans.
     */
    throws('A13 (req 10). a force-push whose baseline collapses to the head REFUSES',
        () => resolveScanPlan({
            eventName: 'push',
            // A force-push: `before` is not an ancestor of the new head, so the
            // event gives no usable baseline...
            payload: { before: '0'.repeat(40), after: e },
            headSha: e,
            // ...and the fallback resolves to the head itself, which is exactly
            // what `mergeBase(origin/main, head)` produced after a force-push to
            // the default branch.
            lastValidatedBase: () => e,
            git,
        }),
        'a base equal to the head means an empty range, which validates nothing');
    throws('A14 (req 10). a force-push with no validated ancestor REFUSES rather than widening',
        () => resolveScanPlan({
            eventName: 'push',
            payload: { before: '0'.repeat(40), after: e },
            headSha: e,
            lastValidatedBase: nothingValidated,
            git,
        }));
    const forcePushed = resolveScanPlan({
        eventName: 'push',
        payload: { before: '0'.repeat(40), after: e },
        headSha: e,
        lastValidatedBase: validated(b),
        git,
    });
    assert('A15. a force-push falls back to the last validated commit when there is one',
        forcePushed.base === b && forcePushed.source === 'last-validated-commit',
        `${forcePushed.source}: ${String(forcePushed.base).slice(0, 8)}`);

    const dispatchOnMerge = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: merge, lastValidatedBase: validated(e), git,
    });
    assert('A16 (req 8). dispatching on a merge commit scans everything since the validated one',
        dispatchOnMerge.base === e,
        `expected ${e.slice(0, 8)}, got ${String(dispatchOnMerge.base).slice(0, 8)}`);
}

/* ========================================================================== */
console.log('\nB. Detection — what those ranges actually catch');
/* ========================================================================== */

let binary = null;
try {
    binary = ensureGitleaks();
} catch (error) {
    failures += 1;
    console.log('  FAIL B. the pinned scanner could not be obtained');
    console.log(`       ${error.message}`);
}

if (binary) {
    console.log(`  (gitleaks ${GITLEAKS_VERSION}, pinned by digest)`);

    // B0. The fixtures must actually be detectable, or every case below is vacuous.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('config.txt', `key=${FAKE_GCP_KEY}`);
        const only = repo.commit('a secret, on its own');
        const result = scan(repo, {
            base: null, head: only, source: 'test', logOpts: `-m --max-count=1 ${only}`,
        }, binary);
        assert('B0. the synthetic fixture is detected at all (guards every case below)',
            !result.ok && result.range.findings.length > 0,
            'if this fails, the fixture stopped matching the rule and nothing else here means anything');
    }

    // 1 + 8 + 9. Ancient secret, deleted long ago, current change unrelated.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('legacy.env', `SECRET_KEY=${FAKE_GCP_KEY}`);
        repo.commit('ancient: a real secret lands');
        repo.remove('legacy.env');
        repo.commit('ancient: and is removed again');
        repo.write('src/app.js', 'export const answer = 42;');
        const validatedCommit = repo.commit('a previous, already-validated release');
        repo.write('src/app.js', 'export const answer = 43;');
        const head = repo.commit('the change under test — nothing sensitive');

        const git = repo.gitOps();
        // Stands in for "GitHub reports this commit's own secret-scan passed".
        const validated = () => validatedCommit;
        const dispatch = resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: head, lastValidatedBase: validated, git,
        });
        const manual = scan(repo, dispatch, binary);
        assert('B1 (req 1, 9). a manual run passes when the only secrets are in ancient history',
            manual.ok,
            `range=${manual.range.findings.length} tree=${manual.tree.findings.length} — ${manual.problems.join('; ')}`);
        assert('B2 (req 8, 23). that manual run scanned 1 commit, not the whole history',
            dispatch.base === validatedCommit,
            `base was ${String(dispatch.base).slice(0, 8)}, expected ${validatedCommit.slice(0, 8)}`);

        // The same repository, scanned the way the old action did on dispatch.
        const everything = scan(repo, {
            base: null, head, source: 'full-history', logOpts: '--all',
        }, binary);
        assert('B3 (req 1, 17). and the OLD full-history behaviour would have failed it',
            !everything.ok && everything.range.findings.length > 0,
            'this is exactly run #159: legacy findings failing an unrelated release');
        assert('B4 (req 9). repeating the manual run gives the same clean verdict',
            scan(repo, resolveScanPlan({
                eventName: 'workflow_dispatch', headSha: head, lastValidatedBase: validated, git,
            }), binary).ok,
            'a re-verification must not rediscover history it already accepted');

        assert('B5. the ancient secret is still visible to the deliberate audit',
            !scan(repo, { base: null, head, source: 'audit', logOpts: '--all' }, binary).ok,
            'nothing is hidden — the full sweep still reports it, it just does not gate');
    }

    // 2. A new commit that adds a secret.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'export const answer = 42;');
        const base = repo.commit('clean base');
        repo.write('src/config.js', `export const apiKey = '${FAKE_GCP_KEY}';`);
        const head = repo.commit('adds a secret');
        const result = scan(repo, resolveScanPlan({
            eventName: 'push', payload: { before: base, after: head }, headSha: head, lastValidatedBase: () => base, git: repo.gitOps(),
        }), binary);
        assert('B6 (req 2, 4, 18). a new commit that adds a secret FAILS',
            !result.ok && result.range.findings.length > 0 && result.tree.findings.length > 0,
            `range=${result.range.findings.length} tree=${result.tree.findings.length}`);
    }

    // 3. Added, then removed again inside the same change — the tree is clean.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'export const answer = 42;');
        const base = repo.commit('clean base');
        repo.write('.env.local.tmp', `TOKEN=${FAKE_GCP_KEY}`);
        repo.commit('oops, commits a secret');
        repo.remove('.env.local.tmp');
        const head = repo.commit('removes it again, same pull request');

        const plan = resolveScanPlan({
            eventName: 'push', payload: { before: base, after: head }, headSha: head, lastValidatedBase: () => base, git: repo.gitOps(),
        });
        const result = scan(repo, plan, binary);
        assert('B7 (req 6). a secret added and then deleted in the same change still FAILS',
            !result.ok && result.range.findings.length > 0,
            'the commit is in history and the value is disclosed; deleting the file does not undo that');
        assert('B8 (req 6). and the tree scan alone would NOT have caught it',
            result.tree.findings.length === 0,
            'which is why both protections exist rather than just the tree scan');
    }

    /*
     * 3b. The same shape one push later — found in review on 2026-08-26 (P1).
     *
     * Push A adds the credential and deletes it again, so its scan fails and the
     * release is blocked. Push B is an ordinary unrelated change. Anchored at
     * push B's own `before` — the tip that FAILED — the disclosed increment is
     * behind the range and the tree is clean, so push B passes and deploys.
     * Anchored at the last commit that actually passed, it does not.
     */
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'export const answer = 42;');
        const validatedTip = repo.commit('the last release, scanned and PASSED');
        repo.write('.env.local.tmp', `TOKEN=${FAKE_GCP_KEY}`);
        repo.commit('push A: commits a secret');
        repo.remove('.env.local.tmp');
        const failedTip = repo.commit('push A: removes it again — this push FAILS its scan');
        repo.write('README.md', 'push B: something else entirely');
        const head = repo.commit('push B: an ordinary later change');

        const anchoredAtBefore = scan(repo, resolveScanPlan({
            eventName: 'push',
            payload: { before: failedTip, after: head },
            headSha: head,
            // What trusting `before` would have produced.
            lastValidatedBase: () => failedTip,
            git: repo.gitOps(),
        }), binary);
        assert('B16 (req 2, 6). trusting `before` after a FAILED push would have passed the next one',
            anchoredAtBefore.ok,
            'this is the hole, measured: the credential is disclosed and nothing reports it');

        const anchoredAtValidated = scan(repo, resolveScanPlan({
            eventName: 'push',
            payload: { before: failedTip, after: head },
            headSha: head,
            lastValidatedBase: () => validatedTip,
            git: repo.gitOps(),
        }), binary);
        assert('B17 (req 2, 6). anchoring at the last VALIDATED commit fails it instead',
            !anchoredAtValidated.ok && anchoredAtValidated.range.findings.length > 0
            && anchoredAtValidated.tree.findings.length === 0,
            `range=${anchoredAtValidated.range.findings.length} tree=${anchoredAtValidated.tree.findings.length}`
            + ' — the tree is clean, so only the widened range can catch it');
    }

    /*
     * 3c. The abbreviated-SHA collapse, measured — found in review on 2026-08-26
     * (P1). `SECRET_SCAN_BASE=<head[0..8]>` used to be accepted: a 0-commit range
     * that reports nothing, over a change that added and deleted a credential.
     */
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'export const answer = 42;');
        const base = repo.commit('clean base');
        repo.write('.env.local.tmp', `TOKEN=${FAKE_GCP_KEY}`);
        repo.commit('adds a credential');
        repo.remove('.env.local.tmp');
        const head = repo.commit('and deletes it again');

        const collapsed = scan(repo, {
            base: head.slice(0, 8), head, source: 'test', logOpts: `-m ${head.slice(0, 8)}..${head}`,
        }, binary);
        assert('B18 (req 10). a short-SHA-of-the-head range reports nothing over a real disclosure',
            collapsed.ok && collapsed.range.findings.length === 0,
            'which is exactly why the resolver refuses to build it (C11)');
        const honest = scan(repo, resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: head, baseOverride: base, git: repo.gitOps(),
        }), binary);
        assert('B19 (req 10). the honest range over the same commits FAILS',
            !honest.ok && honest.range.findings.length > 0 && honest.tree.findings.length === 0,
            `range=${honest.range.findings.length} tree=${honest.tree.findings.length}`);
    }

    // 4. Present in the tree, but not added by this range.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/legacy.js', `const key = '${FAKE_GCP_KEY}';`);
        const base = repo.commit('a secret that predates the change');
        repo.write('README.md', 'unrelated edit');
        const head = repo.commit('the change under test touches nothing sensitive');

        const plan = resolveScanPlan({
            eventName: 'push', payload: { before: base, after: head }, headSha: head, lastValidatedBase: () => base, git: repo.gitOps(),
        });
        const result = scan(repo, plan, binary);
        assert('B9 (req 8). a secret sitting in the tree FAILS even when this range did not add it',
            !result.ok && result.tree.findings.length > 0,
            'the tree scan is what stops "not in my diff" from meaning "not my problem"');
        assert('B10 (req 8). and the range scan alone would NOT have caught that one',
            result.range.findings.length === 0,
            'the complement of B7/B8 — neither scan subsumes the other');
    }

    // 7. A secret introduced on a second parent, merged in.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'clean');
        const base = repo.commit('base');
        repo.checkoutNew('side');
        repo.write('src/side.js', `const token = '${FAKE_GCP_KEY}';`);
        repo.commit('side branch adds a secret');
        repo.checkout('main');
        repo.write('src/app.js', 'mainline moves on');
        const mainTip = repo.commit('mainline commit');
        const merge = repo.merge('side', 'merge side into main');

        const plan = resolveScanPlan({
            eventName: 'push', payload: { before: mainTip, after: merge }, headSha: merge, lastValidatedBase: () => mainTip, git: repo.gitOps(),
        });
        const result = scan(repo, plan, binary);
        assert('B11 (req 7). a secret arriving through a SECOND PARENT fails',
            !result.ok && result.range.findings.length > 0,
            'the case gitleaks-action@v2 missed: --first-parent never walks the merged branch');

        // The old strategy, run against the same repository, for contrast.
        const oldStrategy = scan(repo, {
            base, head: merge, source: 'action-v2',
            logOpts: `--no-merges --first-parent ${base}^..${merge}`,
        }, binary);
        assert('B12 (req 7). and the old --no-merges --first-parent range provably missed it',
            oldStrategy.range.findings.length === 0,
            'measured, not assumed: this is why the range is owned here now');
    }

    // 7b. A secret that exists only because of a merge conflict resolution.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('shared.txt', 'origin');
        const base = repo.commit('base');
        repo.checkoutNew('left', base);
        repo.write('shared.txt', 'left change');
        repo.commit('left');
        repo.checkoutNew('right', base);
        repo.write('shared.txt', 'right change');
        repo.commit('right');
        repo.checkout('left');
        try {
            repo.git('merge', 'right', '-m', 'merge right');
        } catch {
            // expected conflict
        }
        repo.write('shared.txt', `resolved = '${FAKE_GCP_KEY_2}'`);
        repo.git('add', '-A');
        repo.git('commit', '-q', '-m', 'resolve the conflict, badly');
        const merge = repo.head();

        const plan = resolveScanPlan({
            eventName: 'push', payload: { before: base, after: merge }, headSha: merge, lastValidatedBase: () => base, git: repo.gitOps(),
        });
        const result = scan(repo, plan, binary);
        assert('B13 (req 7). a secret introduced by a merge-conflict resolution fails',
            !result.ok,
            `range=${result.range.findings.length} tree=${result.tree.findings.length}`);
    }

    // 11 + 12. The two documented exemptions, and their limit.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/lib/firebase/config.js', `export const config = { apiKey: '${ALLOWED_PLACEHOLDER_KEY}' };`);
        repo.write('src/blog.test.js', `expect(run.slotKey).toBe('${ALLOWED_SLOT_KEY}');`);
        const base = repo.commit('the documented placeholders');
        const allowed = scan(repo, {
            base: null, head: base, source: 'test', logOpts: `-m --max-count=1 ${base}`,
        }, binary);
        assert('B14 (req 11). the documented placeholder and slot-id values are allowed',
            allowed.ok,
            `range=${allowed.range.findings.length} tree=${allowed.tree.findings.length} `
            + `— ${JSON.stringify(allowed.tree.findings.map((f) => `${f.RuleID}:${f.File}`))}`);

        // A real secret in the SAME FILE, on the very next line.
        repo.write(
            'src/lib/firebase/config.js',
            `export const config = { apiKey: '${ALLOWED_PLACEHOLDER_KEY}' };\n`
            + `export const oops = '${FAKE_GCP_KEY}';`,
        );
        const head = repo.commit('a real one beside the placeholder');
        const beside = scan(repo, resolveScanPlan({
            eventName: 'push', payload: { before: base, after: head }, headSha: head, lastValidatedBase: () => base, git: repo.gitOps(),
        }), binary);
        assert('B15 (req 12). a real secret next to an allowed placeholder is still detected',
            !beside.ok && beside.tree.findings.length > 0,
            'the exemptions are values, not paths and not rules — this is what that buys');
    }
}

/* ========================================================================== */
console.log('\nC. Failing safe — a base that cannot be trusted is never widened');
/* ========================================================================== */

{
    const repo = makeRepo();
    repo.write('a.txt', 'a');
    const first = repo.commit('first');
    repo.write('a.txt', 'b');
    const second = repo.commit('second');
    const git = repo.gitOps();

    // 10. Malformed / missing base information.
    throws('C1 (req 10). a pull_request with no base.sha refuses',
        () => resolveScanPlan({ eventName: 'pull_request', payload: { pull_request: {} }, headSha: second, git }));
    throws('C2 (req 10). a pull_request whose base is not in the clone refuses',
        () => resolveScanPlan({
            eventName: 'pull_request',
            payload: { pull_request: { base: { sha: 'f'.repeat(40) } } },
            headSha: second,
            git,
        }));
    throws('C3 (req 10). a push with no before and nothing validated refuses',
        () => resolveScanPlan({
            eventName: 'push',
            payload: { before: '0'.repeat(40) },
            headSha: second,
            lastValidatedBase: () => null,
            git,
        }));
    throws('C4 (req 10). an unknown event refuses rather than guessing',
        () => resolveScanPlan({ eventName: 'issue_comment', headSha: second, git }));
    throws('C5 (req 10). a head that is not a full SHA refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'HEAD', git }));
    throws('C6 (req 10). a head that is not in the clone refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'a'.repeat(40), git }));
    throws('C6b (req 10). a validated base that is the head itself refuses (empty range)',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, lastValidatedBase: () => second, git,
        }),
        'an empty range compares nothing, which must never read as clean');

    // The override is an escape hatch, not a bypass.
    throws('C7. SECRET_SCAN_BASE that is not an ancestor of head refuses',
        () => {
            repo.checkoutNew('unrelated', first);
            repo.write('b.txt', 'b');
            const off = repo.commit('off to one side');
            repo.checkout('main');
            resolveScanPlan({ eventName: 'workflow_dispatch', headSha: second, baseOverride: off, git });
        });
    throws('C8. SECRET_SCAN_BASE that is not a SHA at all refuses',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, baseOverride: 'main~3', git,
        }));
    const overridden = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: second, baseOverride: first, git,
    });
    assert('C9. a valid SECRET_SCAN_BASE is honoured and recorded as the source',
        overridden.base === first && overridden.source === 'explicit-base-override',
        `${overridden.source}: ${String(overridden.base).slice(0, 8)}`);

    /*
     * Found in review on 2026-08-26 (P1).
     *
     * An abbreviated SHA of the head is a different STRING and the same COMMIT.
     * Every check but one is a string comparison, and `merge-base --is-ancestor`
     * says yes because a commit is its own ancestor — so `SECRET_SCAN_BASE` set
     * to the head's short form produced a 0-commit range that passed. The base is
     * resolved to its full SHA before anything compares it now.
     */
    throws('C11 (req 10). an ABBREVIATED SHA of the head refuses, like the full one',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, baseOverride: second.slice(0, 8), git,
        }),
        'short and long names of one commit must both be recognised as the head');
    const abbreviated = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: second, baseOverride: first.slice(0, 10), git,
    });
    assert('C12. an abbreviated base that IS an ancestor is honoured, and canonicalised',
        abbreviated.base === first && abbreviated.logOpts === `-m ${first}..${second}`,
        `${abbreviated.logOpts} — the range must name commits in full, not as typed`);

    /*
     * A scanner that did not run has proven nothing, and must never read as
     * clean. gitleaks exits 1 both for "leaks found" and for "something went
     * wrong", so the two are told apart by whether a parseable report exists —
     * and both fail the job.
     */
    if (binary) {
        const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-err-'));
        scratch.push(work);
        const brokenConfig = runGitleaksScan({
            binary,
            mode: 'git',
            target: repo.dir,
            logOpts: `-m ${first}..${second}`,
            config: join(work, 'this-config-does-not-exist.toml'),
            reportPath: join(work, 'a.json'),
        });
        assert('C13 (req 21). a scanner that could not run reports an ERROR, never "clean"',
            brokenConfig.errored && !brokenConfig.ok && brokenConfig.findings.length === 0,
            `ok=${brokenConfig.ok} errored=${brokenConfig.errored} — 0 findings and exit 1 must not `
            + 'be read as "nothing found"');

        const brokenTarget = runGitleaksScan({
            binary,
            mode: 'git',
            target: join(work, 'not-a-repository'),
            logOpts: `-m ${first}..${second}`,
            reportPath: join(work, 'b.json'),
        });
        assert('C14 (req 21). and so does one pointed at something that is not a repository',
            brokenTarget.errored && !brokenTarget.ok,
            `ok=${brokenTarget.ok} errored=${brokenTarget.errored}`);

        const scanned = performScans({
            binary,
            cwd: repo.dir,
            plan: {
                base: first, head: second, source: 'test', logOpts: `-m ${first}..${second}`,
            },
            config: join(work, 'this-config-does-not-exist.toml'),
            workDir: join(work, 'run'),
        });
        assert('C15 (req 21). and the two-part scan refuses the job when either half errored',
            !scanned.ok && scanned.problems.some((problem) => /did not complete/.test(problem)),
            scanned.problems.join('; '));
    }

    /*
     * The same guarantee one step further, found in review on 2026-08-26 (P1).
     *
     * A readable report is not proof that the scan finished: a nonzero exit that
     * still wrote a parseable EMPTY report used to set `errored` false with no
     * findings, so `performScans` recorded no problem and the gate passed over a
     * scanner that had failed. Driven here with a stub scanner, because gitleaks
     * 8.30.1 does not do it — which is exactly why the branch must not depend on
     * that staying true.
     */
    {
        const stubDir = mkdtempSync(join(tmpdir(), 'safehaul-stub-scanner-'));
        scratch.push(stubDir);
        const stub = join(stubDir, 'gitleaks-stub');
        writeFileSync(stub, [
            '#!/usr/bin/env node',
            '// Writes an empty, perfectly parseable report and then fails.',
            "const { writeFileSync } = require('node:fs');",
            "const at = process.argv.indexOf('--report-path');",
            "if (at !== -1) writeFileSync(process.argv[at + 1], '[]');",
            'process.exit(7);',
        ].join('\n'));
        chmodSync(stub, 0o755);

        const failed = runGitleaksScan({
            binary: stub,
            mode: 'git',
            target: repo.dir,
            logOpts: `-m ${first}..${second}`,
            reportPath: join(stubDir, 'empty.json'),
        });
        assert('C16 (req 21). a nonzero exit with an EMPTY report is an incomplete scan, not a clean one',
            failed.errored && !failed.ok,
            `ok=${failed.ok} errored=${failed.errored} detail=${failed.detail}`);

        // The work directory has to exist before the call, or the stub cannot
        // write its report and the case degrades into C13's (no report at all)
        // — which passes for the wrong reason.
        const runDir = join(stubDir, 'run');
        mkdirSync(runDir, { recursive: true });
        const scanned = performScans({
            binary: stub,
            cwd: repo.dir,
            plan: {
                base: first, head: second, source: 'test', logOpts: `-m ${first}..${second}`,
            },
            workDir: runDir,
        });
        assert('C17 (req 21). and the job refuses rather than deploying on it',
            !scanned.ok && scanned.problems.length > 0,
            scanned.problems.join('; ') || 'no problem was recorded, so the release gate saw success');
    }

    // A repository whose single commit has never been validated has no baseline,
    // and says so rather than inventing one.
    const fresh = makeRepo();
    fresh.write('only.txt', 'x');
    const root = fresh.commit('root');
    throws('C10 (req 10). a commit with no validated ancestor refuses, whatever its position',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: root, lastValidatedBase: () => null, git: fresh.gitOps(),
        }),
        'including a root commit — "nothing to compare against" is a refusal, not a full scan');
}

/* ========================================================================== */
console.log('\nE. Finding the last validated commit');
/* ========================================================================== */

{
    /*
     * The baseline for a manual run and for a force-push is "the newest ancestor
     * whose own secret-scan passed". Git cannot answer that, so GitHub is asked —
     * and the answers that are NOT "yes" all have to fail closed, distinguishably.
     */
    const repo = makeRepo();
    repo.write('f.txt', '1');
    const first = repo.commit('first');
    repo.write('f.txt', '2');
    const second = repo.commit('second');
    repo.write('f.txt', '3');
    const third = repo.commit('third');

    const reply = (byCommit) => async (url) => {
        const sha = url.split('/commits/')[1].split('/')[0];
        const conclusion = byCommit[sha];
        return {
            ok: true,
            json: async () => ({
                check_runs: conclusion
                    ? [{ name: 'secret-scan', status: 'completed', conclusion }]
                    : [],
            }),
        };
    };
    const opts = { headSha: third, cwd: repo.dir, repository: 'o/r', token: 't' };

    const found = await findLastValidatedAncestor({
        ...opts, fetchImpl: reply({ [second]: 'success', [first]: 'success' }),
    });
    assert('E1. it returns the NEWEST validated ancestor',
        found.sha === second,
        `${String(found.sha).slice(0, 8)} — walking must stop at the first success`);

    const skipped = await findLastValidatedAncestor({
        ...opts, fetchImpl: reply({ [second]: 'failure', [first]: 'success' }),
    });
    assert('E2 (req 10). an ancestor whose scan FAILED is not a baseline',
        skipped.sha === first,
        'this is the whole point: a failed push must not become the thing we compare against');

    const none = await findLastValidatedAncestor({ ...opts, fetchImpl: reply({}) });
    assert('E3 (req 10). nothing validated yields no baseline, and the caller refuses',
        none.sha === null && none.error === null && none.checked === 2,
        JSON.stringify(none));

    const broken = await findLastValidatedAncestor({
        ...opts,
        fetchImpl: async () => { throw new Error('network down'); },
    });
    assert('E4 (req 10). a lookup that could not run reports WHY, and still yields no baseline',
        broken.sha === null && /network down/.test(broken.error || ''),
        JSON.stringify(broken));
    assert('E5. "could not ask" is never mistaken for "nothing to find"',
        broken.error !== null && none.error === null,
        'the two fail identically but need different fixes, so they read differently');

    const denied = await findLastValidatedAncestor({
        ...opts, fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    assert('E6 (req 10). a 403 is a refusal, not an empty answer',
        denied.sha === null && /403/.test(denied.error || ''),
        JSON.stringify(denied));

    const untokened = await findLastValidatedAncestor({ ...opts, token: '', fetchImpl: reply({}) });
    assert('E7. with no token it does not pretend to know',
        untokened.sha === null && /GITHUB_TOKEN/.test(untokened.error || ''),
        JSON.stringify(untokened));
}

/* ========================================================================== */
console.log('\nD. The pinned scanner, and the separate history audit');
/* ========================================================================== */

assert('D1 (req 14). the gitleaks version is pinned to an exact release',
    /^\d+\.\d+\.\d+$/.test(GITLEAKS_VERSION) && !/latest/i.test(GITLEAKS_VERSION),
    `version is ${GITLEAKS_VERSION} — a security gate must not track "latest"`);
assert('D2 (req 14). and pinned by content as well as by tag',
    /^[0-9a-f]{64}$/.test(GITLEAKS_SHA256),
    'a tag can be moved; the digest is what makes the scanner reproducible');

const FP = (n) => `${'a'.repeat(39)}${n}:legacy/.env:gcp-api-key:1`;
const legacy = { findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2)] };

assert('D3 (req 10). the audit refuses to enforce without a recorded baseline',
    evaluateAudit(null, { findings: 3, gitleaksVersion: GITLEAKS_VERSION, fingerprints: [] }).ok === false,
    'no baseline means nothing to compare against, which is not the same as "clean"');
assert('D4 (req 10). a baseline with a count but no identities is refused',
    evaluateAudit(
        { findings: 2, gitleaksVersion: '8.30.1' },
        { findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2)] },
    ).verdict === 'no-identities',
    'counting alone cannot tell a replaced finding from an unchanged one');
assert('D5. an unchanged history passes and says so',
    evaluateAudit(legacy, { ...legacy }).verdict === 'unchanged',
    'the known legacy findings are recorded, not re-litigated on every run');
assert('D6 (req 10). a NEW finding fails the audit',
    evaluateAudit(legacy, {
        findings: 3, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2), FP(3)],
    }).verdict === 'regressed',
    'something entered history that the inventory does not know about');

/*
 * The case counting missed, found in review on 2026-08-26 (P2).
 *
 * One legacy finding disappears — a stale branch deleted — and a new secret
 * appears on another unmerged branch. The total is identical, and a count
 * comparison calls that `unchanged`. It matters because the blocking gate only
 * runs for `main` and pull requests targeting it, so an unmerged branch is this
 * audit's to catch.
 */
{
    const swapped = evaluateAudit(legacy, {
        findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(9)],
    });
    assert('D7 (req 10). a new finding that REPLACES a vanished one still fails',
        swapped.ok === false && swapped.verdict === 'regressed',
        `verdict was ${swapped.verdict} — the totals match, so only identities can see this`);
    assert('D8. and it names what appeared and what went, by location only',
        swapped.added.length === 1 && swapped.added[0] === FP(9)
        && swapped.removed.length === 1 && swapped.removed[0] === FP(2),
        JSON.stringify({ added: swapped.added, removed: swapped.removed }));
}

assert('D9. a cleaned history passes, and asks for the baseline to be updated',
    evaluateAudit(legacy, { findings: 1, gitleaksVersion: '8.30.1', fingerprints: [FP(1)] }).verdict === 'improved',
    'fewer findings must not read as a failure');
assert('D10. a scanner upgrade reports instead of failing',
    evaluateAudit(
        { ...legacy, gitleaksVersion: '8.24.3' },
        { findings: 90, gitleaksVersion: '8.30.1', fingerprints: [FP(5)] },
    ).verdict === 'version-changed',
    'rule sets differ between versions; a bump is not a breach');

assert('D11. a fingerprint is a location, and carries no part of a value',
    fingerprintOf({ Commit: 'abc', File: 'x/.env', RuleID: 'gcp-api-key', StartLine: 3, Secret: 'AIzaTOPSECRET' })
        === 'abc:x/.env:gcp-api-key:3',
    'the baseline records these, so they must never be able to leak the finding');

/*
 * The recorded inventory is what the audit enforces against, so its shape is
 * asserted here rather than trusted.
 */
{
    const recorded = JSON.parse(readFileSync(resolvePath(here, '../.github/secret-history-baseline.json'), 'utf8'));
    assert('D12. the recorded baseline lists an identity for every finding it counts',
        Array.isArray(recorded.fingerprints) && recorded.fingerprints.length === recorded.findings,
        `${recorded.fingerprints?.length} identities for ${recorded.findings} findings`);
    assert('D13. and no recorded identity contains anything that looks like a secret',
        recorded.fingerprints.every((id) => /^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/.test(id)),
        'a fingerprint is commit:file:rule:line and nothing else');
}

for (const dir of scratch) rmSync(dir, { recursive: true, force: true });

console.log(failures === 0
    ? '\nAll secret-scan range and detection checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
