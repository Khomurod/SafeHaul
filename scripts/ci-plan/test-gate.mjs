/**
 * D — the fail-closed gate.
 *
 * A skipped lane with no justification, a failed lane, a cancelled run, a broken
 * planner and workflow/lane drift are all refusals. This is the section that
 * decides whether "skip work we already did" can become a hole in the release
 * gate, so every case here is a way unvalidated code could have reached Testing.
 */

import { ALWAYS_REQUIRED_JOBS, LANE_NAMES } from '../ci-plan.mjs';
import { evaluateValidation } from '../verify-release-validation.mjs';
import { allJobs, assert, plan } from './test-support.mjs';

console.log('\nD. The fail-closed gate');
/* ========================================================================== */


const everythingRan = {
    planResult: 'success',
    jobResults: allJobs('success'),
    lanePlan: plan(() => ({ selected: true, attested: false })),
};

assert('D1. a run in which every lane executed and passed is complete',
    evaluateValidation(everythingRan).ok === true,
    JSON.stringify(evaluateValidation(everythingRan).problems));

assert('D2. a lane that was skipped because it is irrelevant is complete',
    evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'skipped' },
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: { selected: false, attested: false } },
    }).ok === true);

assert('D3. a lane that was skipped because it is already proven is complete',
    evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('skipped'), ...Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((j) => [j, 'success'])) },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    }).ok === true,
    JSON.stringify(evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('skipped'), ...Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((j) => [j, 'success'])) },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    }).problems));

/* -- THE loophole this file exists to close -------------------------------- */
{
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'frontend-e2e': 'skipped' },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert('D4. a RELEVANT lane skipped with no proof is a refusal, not a pass',
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'frontend_e2e' && l.verdict === 'unjustified skip'),
        JSON.stringify(verdict.lanes.find((l) => l.lane === 'frontend_e2e')));
}

for (const bad of ['failure', 'cancelled', 'timed_out']) {
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'rules-emulator': bad },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert(`D5. a lane that concluded "${bad}" is a refusal even when attested`,
        verdict.ok === false);

    const stillRefused = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'rules-emulator': bad },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    });
    assert(`D5b. an attestation cannot rescue a lane that concluded "${bad}"`,
        stillRefused.ok === false);
}

{
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'frontend-quality': undefined },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert('D6. a required job missing from the results entirely is a refusal',
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'frontend_unit' && l.verdict === 'indeterminate'),
        'a deleted or renamed job must not read as "nothing failed"');
}

assert('D7. a planner that did not succeed refuses the whole release',
    evaluateValidation({ ...everythingRan, planResult: 'failure' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: 'skipped' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: 'cancelled' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: undefined }).ok === false);

assert('D8. a planner that succeeded but reported nothing refuses the release',
    evaluateValidation({ planResult: 'success', jobResults: allJobs('success'), lanePlan: null }).ok === false
        && evaluateValidation({ planResult: 'success', jobResults: allJobs('success'), lanePlan: 'nonsense' }).ok === false);

assert('D9. a lane the planner never reported on refuses the release',
    evaluateValidation({
        planResult: 'success',
        jobResults: allJobs('success'),
        lanePlan: Object.fromEntries(
            LANE_NAMES.filter((lane) => lane !== 'rules').map((lane) => [lane, { selected: true, attested: false }]),
        ),
    }).ok === false,
    'a lane dropped from the plan must not disappear from the verdict');

assert('D10. an unknown lane in the plan refuses the release',
    evaluateValidation({
        ...everythingRan,
        lanePlan: { ...everythingRan.lanePlan, smuggled_lane: { selected: false, attested: true } },
    }).ok === false);

for (const job of ALWAYS_REQUIRED_JOBS) {
    assert(`D11. ${job} must run on every release`,
        evaluateValidation({
            ...everythingRan,
            jobResults: { ...allJobs('success'), [job]: 'skipped' },
        }).ok === false);
}

for (const malformed of [
    { selected: 'false', attested: 'true' },
    { selected: 'true', attested: 'false' },
    { selected: undefined, attested: undefined },
    { selected: 1, attested: 0 },
    {},
]) {
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'skipped' },
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: malformed },
    });
    assert(`D12. a SKIPPED lane whose decision is ${JSON.stringify(malformed)} is a refusal`,
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'functions' && l.verdict === 'undecided'),
        'a stray pair of quotes around a workflow output must not read as "not relevant"');
}

assert('D13. a lane that ran green needs no decision from the planner',
    evaluateValidation({
        planResult: 'success',
        jobResults: allJobs('success'),
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: { selected: 'oops' } },
    }).ok === true,
    'a malformed decision must not fail a lane that demonstrably passed in this run');

/* ========================================================================== */
