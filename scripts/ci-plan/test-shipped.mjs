/**
 * G, H — proof that a release actually shipped, and stays healthy.
 *
 * A green run is not evidence that anything shipped: every failure in the
 * 2026-08-08 round was found by a human opening a screen. G replays a release
 * where every lane was proven and the deploys still had to run; H replays the
 * `surveyHistoricalReconstruction` incident, where a callable the app calls was
 * not deployed at all.
 */

import { REQUIRED_DEPLOY_JOBS, evaluateDeployResults } from '../verify-shipped.mjs';
import {
    SHIP_GRACE_MS, judgeCallables, judgeChannel, judgeMainShipped,
} from '../check-release-health.mjs';
import { assert } from './test-support.mjs';

console.log('\nG. Proof that a release actually shipped');
/* ========================================================================== */

// Replays a60c6dc: every lane proven, gate green, and all three deploy jobs
// silently skipped. The run reported success and nothing reached users.
{
    const verdict = evaluateDeployResults({
        'deploy-testing': 'skipped',
        'deploy-functions': 'skipped',
    });
    assert('G1. deploys that were SKIPPED are not a shipped release',
        verdict.ok === false && verdict.problems.length === 2,
        JSON.stringify(verdict.problems));
    assert('G1b. and it says so in words an operator can act on',
        verdict.problems.every((p) => /never deployed|did not deploy/.test(p)),
        JSON.stringify(verdict.problems));
}

assert('G2. both deploys succeeding is a shipped release',
    evaluateDeployResults({
        'deploy-testing': 'success', 'deploy-functions': 'success',
    }).ok === true);

for (const bad of ['failure', 'cancelled', undefined, '', 'something-new']) {
    for (const job of Object.keys(REQUIRED_DEPLOY_JOBS)) {
        const verdict = evaluateDeployResults({
            'deploy-testing': 'success', 'deploy-functions': 'success', [job]: bad,
        });
        assert(`G3. ${job} = ${JSON.stringify(bad)} is not a shipped release`,
            verdict.ok === false);
    }
}

assert('G4. a missing results object is a refusal, not a pass',
    evaluateDeployResults(undefined).ok === false
        && evaluateDeployResults(null).ok === false
        && evaluateDeployResults({}).ok === false,
    'absent evidence must never read as evidence of shipping');

/* ========================================================================== */
console.log('\nH. Release health monitoring');
/* ========================================================================== */

// Replays the surveyHistoricalReconstruction incident: a callable the app calls
// that simply is not in Cloud. It survived several green runs.
{
    const { problems, missing } = judgeCallables([
        { name: 'getReleaseStatus', status: 204 },
        { name: 'surveyHistoricalReconstruction', status: 404 },
    ]);
    assert('H1. a callable the app calls that returns 404 is reported',
        problems.length === 1 && missing.includes('surveyHistoricalReconstruction'),
        JSON.stringify({ problems, missing }));
}

assert('H2. callables that exist raise nothing',
    judgeCallables([{ name: 'a', status: 204 }, { name: 'b', status: 204 }]).problems.length === 0);

// A monitor that cries wolf gets muted, and a muted monitor protects nothing.
{
    const { problems, unchecked } = judgeCallables([
        { name: 'a', status: 204 }, { name: 'b', status: null },
    ]);
    assert('H3. an unreachable callable is reported but does NOT raise an alarm',
        problems.length === 0 && unchecked.includes('b'),
        'a timeout is not evidence a function is missing');
}

assert('H4. a channel serving something other than its recorded release is reported',
    judgeChannel('Testing', 'a'.repeat(40), 'b'.repeat(40)).problems.length === 1);

assert('H5. a channel serving exactly its recorded release is fine',
    judgeChannel('Testing', 'a'.repeat(40), 'a'.repeat(40)).problems.length === 0);

assert('H6. a channel that cannot say what it serves is reported',
    judgeChannel('Testing', 'a'.repeat(40), null).problems.length === 1);

assert('H7. a channel with no recorded release yet raises nothing',
    judgeChannel('Production', null, null).problems.length === 0,
    'a brand new channel is not a fault');

// "main merged but never deployed" — with a grace period so a merge in progress
// never trips it.
{
    const head = { sha: 'c'.repeat(40), committedAtMs: 1_000_000_000_000 };
    const long = head.committedAtMs + SHIP_GRACE_MS + 60_000;
    const short = head.committedAtMs + 60_000;

    assert('H8. a commit that has sat unreleased for hours is reported',
        judgeMainShipped(head, [], long).problems.length === 1);
    assert('H9. a commit merged moments ago is not',
        judgeMainShipped(head, [], short).problems.length === 0,
        'a deploy still in flight must not raise an alarm');
    assert('H10. a commit with a confirmed release is fine at any age',
        judgeMainShipped(head, [head.sha], long).problems.length === 0);
}

/* ========================================================================== */
