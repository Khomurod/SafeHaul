/**
 * M — a pull request carries over only what its previous push proved and
 * nothing changed since can affect.
 *
 * The one proof a pull request accepts is its own previous push's. These are the
 * ways that could go wrong: carrying a lane a later change touched, carrying
 * anything across a cross-cutting or unreadable difference, rebuilding a tree for
 * a push that was not a follow-up, and publishing a proof for a lane the gate did
 * not count as passed.
 */

import {
    LANE_NAMES,
    carriedOverLanes,
    carryOverFromPreviousPush,
    previousPushTree,
    selectLanes,
} from '../ci-plan.mjs';
import { attestableLanes, evaluateValidation } from '../verify-release-validation.mjs';
import { REPO_ID, allJobs, assert, plan, workflow } from './test-support.mjs';

console.log('\nM. Carry-over from the previous push');
/* ========================================================================== */

// `package.json` is cross-cutting, so this pull request selects every lane.
const everything = selectLanes({ changedFiles: ['package.json'] });
const functionsOnly = selectLanes({ changedFiles: ['functions/companyAdmin.js'] });

assert('M1. a follow-up that only edits documentation carries every lane over',
    carriedOverLanes({ selection: everything, changedSince: ['docs/APP_BRIEF.md', 'README.md'] }).join()
        === LANE_NAMES.join());

{
    const carried = carriedOverLanes({ selection: everything, changedSince: ['functions/companyAdmin.js'] });
    assert('M2. a lane a later change can affect runs again, and only that lane',
        !carried.includes('functions') && carried.length === LANE_NAMES.length - 1,
        carried.join(', '));
}

assert('M3. a cross-cutting change since the previous push carries nothing over',
    carriedOverLanes({ selection: everything, changedSince: ['scripts/ci-plan.mjs'] }).length === 0);

assert('M4. a difference git could not read carries nothing over',
    carriedOverLanes({ selection: everything, changedSince: null }).length === 0
        && carriedOverLanes({ selection: everything, changedSince: undefined }).length === 0);

assert('M5. an identical tree carries over exactly the lanes the pull request selects',
    carriedOverLanes({ selection: functionsOnly, changedSince: [] }).join() === 'functions');

assert('M6. a lane the pull request does not select is never carried over',
    carriedOverLanes({ selection: functionsOnly, changedSince: ['docs/APP_BRIEF.md'] }).join() === 'functions');

{
    const [base, before, tree] = ['b', 'c', 'd'].map((c) => c.repeat(40));
    const followUp = { action: 'synchronize', before, pull_request: { base: { sha: base } } };
    const calls = [];
    const git = (...args) => { calls.push(args.join(' ')); return `${tree}\n`; };

    assert('M7. a follow-up push rebuilds its previous tree from the base and the old head',
        previousPushTree({ event: followUp, run: git }) === tree
            && calls[0] === `merge-tree --write-tree ${base} ${before}`,
        calls.join('; '));

    assert('M8. a pull request with no previous push has no previous tree',
        [
            { ...followUp, action: 'opened' },
            { ...followUp, action: 'reopened' },
            { ...followUp, before: '0'.repeat(40) },
            { ...followUp, before: undefined },
            { ...followUp, pull_request: {} },
        ].every((event) => previousPushTree({ event, run: git }) === null));

    assert('M9. a conflicted merge, or an answer that is not a tree, has no previous tree',
        previousPushTree({ event: followUp, run: () => { throw new Error('exit 1: CONFLICT'); } }) === null
            && previousPushTree({ event: followUp, run: () => 'not a tree' }) === null);
}

{
    // The whole path, with git and the GitHub API stood in for: rebuild the
    // previous tree, diff it against this one, look up its attestations.
    const [base, before, previous, current] = ['b', 'c', 'e', 'a'].map((c) => c.repeat(40));
    const followUp = { action: 'synchronize', before, pull_request: { base: { sha: base } } };
    const git = (changed) => (...args) => (args[0] === 'merge-tree' ? `${previous}\n` : changed.join('\n'));
    const run = { status: 'completed', conclusion: 'success', event: 'pull_request' };
    const proofsFor = (tree) => async (path) => {
        if (!path.startsWith('/actions/artifacts')) return run;
        const name = decodeURIComponent(path.split('name=')[1]);
        return {
            artifacts: name.startsWith(`validated-${tree}-`)
                ? [{ name, expired: false, workflow_run: { id: 9, repository_id: REPO_ID, head_repository_id: REPO_ID } }]
                : [],
        };
    };
    const carry = (changed, tree) => carryOverFromPreviousPush({
        event: followUp, selection: everything, treeSha: current, api: proofsFor(tree), repositoryId: REPO_ID, run: git(changed),
    });

    const docsOnly = await carry(['docs/APP_BRIEF.md'], previous);
    assert('M14. a docs-only follow-up carries over every lane its previous push proved',
        docsOnly.previousTree === previous && docsOnly.carried.join() === LANE_NAMES.join(),
        JSON.stringify(docsOnly));

    const noProof = await carry(['docs/APP_BRIEF.md'], current);
    assert('M15. with no proof for the previous push\'s own tree, nothing carries over',
        noProof.carried.length === 0, JSON.stringify(noProof));

    const touched = await carry(['functions/companyAdmin.js'], previous);
    assert('M16. a lane touched since runs again, though its old proof exists',
        !touched.carried.includes('functions') && touched.carried.length === LANE_NAMES.length - 1,
        JSON.stringify(touched));
}

{
    // functions carried over, rules not affected, everything else ran here.
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'skipped', 'rules-emulator': 'skipped' },
        lanePlan: {
            ...plan(() => ({ selected: true, attested: false })),
            functions: { selected: true, attested: true },
            rules: { selected: false, attested: false },
        },
    });
    const attest = attestableLanes(verdict);
    assert('M10. a lane that ran or carried over attests; one that was only irrelevant does not',
        verdict.ok && attest.includes('functions') && attest.includes('frontend_build') && !attest.includes('rules'),
        attest.join(', '));

    const refused = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'failure' },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert('M11. a verdict that refuses the release attests nothing',
        !refused.ok && attestableLanes(refused).length === 0);
}

// The workflow publishes a lane's proof on the gate's verdict for that lane, and
// on nothing else: a job result alone would miss the lanes that carried over.
for (const lane of LANE_NAMES) {
    const at = workflow.indexOf(`- name: Attest ${lane}\n`);
    const step = at === -1 ? '' : workflow.slice(at, workflow.indexOf('\n\n', at));
    assert(`M12. ${lane} attests on the gate's verdict alone`,
        step.includes(`steps.verify.outputs.attest_${lane} == 'true'`) && !/needs\.[a-z-]+\.result/.test(step),
        step.split('\n')[1]?.trim());
}

assert('M13. the step those verdicts come from is the verification step',
    /- name: Verify every lane ran or is provably covered\n\s+id: verify\n/.test(workflow));
