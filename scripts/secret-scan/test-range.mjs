/**
 * Which range each event compares against.
 *
 * Pure: every case drives `resolveScanPlan` against a real throwaway repository
 * through the production `gitRunner`, with no GitHub event and no scanner. The
 * defect this section exists to prevent was not a wrong regex — it was a wrong
 * *range*, chosen invisibly by a third-party action, and nothing in this
 * repository could see it.
 */

import { assert, makeRepo, throws } from './test-support.mjs';
import { resolveScanPlan } from './range.mjs';

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
