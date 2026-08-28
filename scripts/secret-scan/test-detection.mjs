/**
 * What those ranges actually catch, run through the real pinned scanner.
 *
 * Every case builds a throwaway git repository, resolves a plan for it, and calls
 * `performScans` — the same function `scripts/secret-scan.mjs` runs in CI, not a
 * reimplementation of it. That is the point: a range test that stops at the plan
 * proves the plan, and the two defects that mattered (a secret riding in on a
 * second parent, a secret added and deleted inside one change) are only visible
 * once something scans.
 *
 * B0 asserts the fixtures still trip the rule, so a fixture that stops matching
 * fails loudly instead of making every case below vacuously green.
 */

import {
    ALLOWED_PLACEHOLDER_KEY, ALLOWED_SLOT_KEY, FAKE_GCP_KEY, FAKE_GCP_KEY_2,
    assert, getBinary, makeRepo, scan,
} from './test-support.mjs';
import { GITLEAKS_VERSION } from './gitleaks.mjs';
import { resolveScanPlan } from './range.mjs';

/* ========================================================================== */
console.log('\nB. Detection — what those ranges actually catch');
/* ========================================================================== */

const binary = getBinary();

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
     * 2b. A `gitleaks:allow` comment must not silence anything.
     *
     * Found while answering a review finding about config-level exemptions, and
     * it is the widest one: gitleaks honours `gitleaks:allow` in a source comment
     * BY DEFAULT, so a change could exempt its own credential with a line of
     * code and no config edit at all. `--ignore-gitleaks-allow` turns it off.
     */
    {
        const repo = makeRepo().useRepoConfig();
        repo.write('src/app.js', 'export const answer = 42;');
        const base = repo.commit('clean base');
        repo.write('src/plain.js', `export const a = '${FAKE_GCP_KEY}';`);
        repo.write('src/annotated.js', `export const b = '${FAKE_GCP_KEY}'; // gitleaks:allow`);
        const head = repo.commit('one plain, one annotated');
        const result = scan(repo, resolveScanPlan({
            eventName: 'push',
            payload: { before: base, after: head },
            headSha: head,
            lastValidatedBase: () => base,
            git: repo.gitOps(),
        }), binary);
        const annotated = (findings) => findings.filter((f) => /annotated\.js$/.test(f.File)).length;
        assert('B20 (req 12). a `gitleaks:allow` comment does not silence a finding',
            !result.ok && annotated(result.range.findings) > 0 && annotated(result.tree.findings) > 0,
            `range=${annotated(result.range.findings)} tree=${annotated(result.tree.findings)} `
            + '— the default behaviour reports neither, which would let any change exempt itself');
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
            eventName: 'workflow_dispatch', headSha: head, baseOverride: base,
            isValidatedRelease: () => true, git: repo.gitOps(),
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
