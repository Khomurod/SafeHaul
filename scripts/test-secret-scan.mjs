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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GITLEAKS_SHA256,
    GITLEAKS_VERSION,
    ScanPlanError,
    ensureGitleaks,
    gitRunner,
    performScans,
    resolveScanPlan,
} from './secret-scan.mjs';
import { evaluateAudit } from './secret-history-audit.mjs';

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

    // 6. A push to main scans what the push introduced.
    const push = resolveScanPlan({
        eventName: 'push',
        payload: { before: b, after: e },
        headSha: e,
        git,
    });
    assert('A4 (req 6). push uses the event\'s previous tip as the base',
        push.base === b && push.source === 'push-before',
        `${push.source}: ${String(push.base).slice(0, 8)}`);

    // 10. A push with no usable "before" falls back to a bounded range, never to everything.
    const created = resolveScanPlan({
        eventName: 'push',
        payload: { before: '0'.repeat(40), after: d },
        headSha: d,
        defaultBranchRef: 'main',
        git,
    });
    assert('A5. a branch-creation push (before = all zeros) falls back to the default-branch merge base',
        created.base === b && created.source === 'push-default-branch-merge-base',
        `${created.source}: ${String(created.base).slice(0, 8)}`);

    // 8 + 9. Manual re-verification of an already-merged commit.
    const dispatch = resolveScanPlan({ eventName: 'workflow_dispatch', headSha: e, git });
    assert('A6 (req 8). workflow_dispatch compares against the previous first-parent state',
        dispatch.base === b && dispatch.source === 'previous-first-parent',
        `${dispatch.source}: ${String(dispatch.base).slice(0, 8)}`);
    assert('A7 (req 8). and never against the whole history',
        dispatch.logOpts.includes('..') && !dispatch.logOpts.includes('--all'),
        dispatch.logOpts);

    const again = resolveScanPlan({ eventName: 'workflow_dispatch', headSha: e, git });
    assert('A8 (req 9). repeating the same manual run produces the identical range',
        again.logOpts === dispatch.logOpts,
        `${dispatch.logOpts} vs ${again.logOpts}`);

    assert('A9. schedule is treated like a manual re-verification, not a full sweep',
        resolveScanPlan({ eventName: 'schedule', headSha: e, git }).logOpts === dispatch.logOpts,
        'the full sweep is the separate audit workflow, which gates nothing');

    // 7. A merge must not be able to hide a second parent.
    repo.checkout('main');
    const merge = repo.merge('feature', 'merge feature into main');
    const mergePush = resolveScanPlan({
        eventName: 'push',
        payload: { before: e, after: merge },
        headSha: merge,
        git,
    });
    assert('A10 (req 7). a merge push scans everything the merge introduced',
        mergePush.base === e,
        `${String(mergePush.base).slice(0, 8)}`);
    assert('A11 (req 7). no range ever uses --first-parent or --no-merges',
        [pr, push, created, dispatch, mergePush]
            .every((p) => !/--first-parent|--no-merges/.test(p.logOpts)),
        'those two flags are what let a secret ride in on a second parent');
    assert('A12 (req 7). every range passes -m so merge commits are diffed against each parent',
        [pr, push, created, dispatch, mergePush].every((p) => p.logOpts.startsWith('-m ')),
        'without -m, git prints no patch for a merge and a conflict resolution is invisible');

    const dispatchOnMerge = resolveScanPlan({ eventName: 'workflow_dispatch', headSha: merge, git });
    assert('A13 (req 8). dispatching on a merge commit compares against the previous branch tip',
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
        const validated = repo.commit('a previous, already-validated release');
        repo.write('src/app.js', 'export const answer = 43;');
        const head = repo.commit('the change under test — nothing sensitive');

        const git = repo.gitOps();
        const dispatch = resolveScanPlan({ eventName: 'workflow_dispatch', headSha: head, git });
        const manual = scan(repo, dispatch, binary);
        assert('B1 (req 1, 9). a manual run passes when the only secrets are in ancient history',
            manual.ok,
            `range=${manual.range.findings.length} tree=${manual.tree.findings.length} — ${manual.problems.join('; ')}`);
        assert('B2 (req 8, 23). that manual run scanned 1 commit, not the whole history',
            dispatch.base === validated,
            `base was ${String(dispatch.base).slice(0, 8)}, expected ${validated.slice(0, 8)}`);

        // The same repository, scanned the way the old action did on dispatch.
        const everything = scan(repo, {
            base: null, head, source: 'full-history', logOpts: '--all',
        }, binary);
        assert('B3 (req 1, 17). and the OLD full-history behaviour would have failed it',
            !everything.ok && everything.range.findings.length > 0,
            'this is exactly run #159: legacy findings failing an unrelated release');
        assert('B4 (req 9). repeating the manual run gives the same clean verdict',
            scan(repo, resolveScanPlan({ eventName: 'workflow_dispatch', headSha: head, git }), binary).ok,
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
            eventName: 'push', payload: { before: base, after: head }, headSha: head, git: repo.gitOps(),
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
            eventName: 'push', payload: { before: base, after: head }, headSha: head, git: repo.gitOps(),
        });
        const result = scan(repo, plan, binary);
        assert('B7 (req 6). a secret added and then deleted in the same change still FAILS',
            !result.ok && result.range.findings.length > 0,
            'the commit is in history and the value is disclosed; deleting the file does not undo that');
        assert('B8 (req 6). and the tree scan alone would NOT have caught it',
            result.tree.findings.length === 0,
            'which is why both protections exist rather than just the tree scan');
    }

    // 4. Present in the tree, but not added by this range.
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/legacy.js', `const key = '${FAKE_GCP_KEY}';`);
        const base = repo.commit('a secret that predates the change');
        repo.write('README.md', 'unrelated edit');
        const head = repo.commit('the change under test touches nothing sensitive');

        const plan = resolveScanPlan({
            eventName: 'push', payload: { before: base, after: head }, headSha: head, git: repo.gitOps(),
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
            eventName: 'push', payload: { before: mainTip, after: merge }, headSha: merge, git: repo.gitOps(),
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
            eventName: 'push', payload: { before: base, after: merge }, headSha: merge, git: repo.gitOps(),
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
            eventName: 'push', payload: { before: base, after: head }, headSha: head, git: repo.gitOps(),
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
    throws('C3 (req 10). a push with no before and no reachable default branch refuses',
        () => resolveScanPlan({
            eventName: 'push',
            payload: { before: '0'.repeat(40) },
            headSha: second,
            defaultBranchRef: 'origin/does-not-exist',
            git,
        }));
    throws('C4 (req 10). an unknown event refuses rather than guessing',
        () => resolveScanPlan({ eventName: 'issue_comment', headSha: second, git }));
    throws('C5 (req 10). a head that is not a full SHA refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'HEAD', git }));
    throws('C6 (req 10). a head that is not in the clone refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'a'.repeat(40), git }));

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

    // A repository with a single commit has no "previous state" to compare to.
    const fresh = makeRepo();
    fresh.write('only.txt', 'x');
    const root = fresh.commit('root');
    const rootPlan = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: root, git: fresh.gitOps(),
    });
    assert('C10. a root commit is scanned as exactly itself, not as "everything"',
        rootPlan.source === 'root-commit' && rootPlan.logOpts.includes('--max-count=1'),
        rootPlan.logOpts);
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

assert('D3 (req 10). the audit refuses to enforce without a recorded baseline',
    evaluateAudit(null, { findings: 3, gitleaksVersion: GITLEAKS_VERSION }).ok === false,
    'no baseline means nothing to compare against, which is not the same as "clean"');
assert('D4 (req 10). a history that grew fails the audit',
    evaluateAudit({ findings: 67, gitleaksVersion: '8.30.1' }, { findings: 68, gitleaksVersion: '8.30.1' }).verdict === 'regressed',
    'something entered history that the inventory does not know about');
assert('D5. an unchanged history passes and says so',
    evaluateAudit({ findings: 67, gitleaksVersion: '8.30.1' }, { findings: 67, gitleaksVersion: '8.30.1' }).ok,
    'the known legacy findings are recorded, not re-litigated on every run');
assert('D6. a cleaned history passes, and asks for the baseline to be updated',
    evaluateAudit({ findings: 67, gitleaksVersion: '8.30.1' }, { findings: 2, gitleaksVersion: '8.30.1' }).verdict === 'improved',
    'fewer findings must not read as a failure');
assert('D7. a scanner upgrade reports instead of failing',
    evaluateAudit({ findings: 67, gitleaksVersion: '8.24.3' }, { findings: 90, gitleaksVersion: '8.30.1' }).ok
    && evaluateAudit({ findings: 67, gitleaksVersion: '8.24.3' }, { findings: 90, gitleaksVersion: '8.30.1' }).verdict === 'version-changed',
    'rule sets differ between versions; a bump is not a breach');

for (const dir of scratch) rmSync(dir, { recursive: true, force: true });

console.log(failures === 0
    ? '\nAll secret-scan range and detection checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
