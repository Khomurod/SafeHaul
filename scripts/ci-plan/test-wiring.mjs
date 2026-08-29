/**
 * E — the lanes, the workflow jobs, the attestation steps and the promotion
 * gate's required-check list all agree with each other.
 *
 * Drift between any two of those is invisible at runtime: each half is
 * internally consistent and the pair is wrong. That is why this section reads
 * the real `main.yml` and the real `REQUIRED_RELEASE_CHECKS` rather than a
 * description of them.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';
import { ALWAYS_REQUIRED_JOBS, LANES, LANE_NAMES } from '../ci-plan.mjs';
import { assert, here, workflow } from './test-support.mjs';

// `createRequire` resolves from THIS module's URL, not from the `here` that
// test-support exports, so this path is relative to `scripts/ci-plan/` while the
// `resolvePath(here, ...)` calls below are relative to `scripts/`. The two look
// inconsistent and both are correct.
const require = createRequire(import.meta.url);
const { REQUIRED_RELEASE_CHECKS } = require('../../functions/releaseManagement/eligibility.js');

console.log('\nE. Wiring — workflow, lanes and the promotion gate agree');
/* ========================================================================== */

const GATE_JOB_NAME = 'Verify the release is fully validated';

for (const lane of LANE_NAMES) {
    for (const job of LANES[lane].jobs) {
        assert(`E1. lane ${lane} names a real job (${job})`,
            new RegExp(`^\\s{2}${job}:\\s*$`, 'm').test(workflow));
    }
}

for (const job of ALWAYS_REQUIRED_JOBS) {
    assert(`E2. ${job} exists in the workflow`,
        new RegExp(`^\\s{2}${job}:\\s*$`, 'm').test(workflow));
}

// Every lane must have somewhere to publish its proof. Without this, adding a
// lane would silently make it un-provable and every merge would re-run it —
// which is safe, but slow and confusing.
for (const lane of LANE_NAMES) {
    assert(`E3. lane ${lane} has an attestation step in the workflow`,
        workflow.includes(`-${lane}`) && new RegExp(`validated-\\$\\{\\{[^}]*\\}\\}-${lane}`).test(workflow),
        `no "validated-<tree>-${lane}" upload found`);
}

// The gate must receive the plan as the one json value the planner emitted.
// Reassembling it per-lane in YAML fails open — a missing output reads as "that
// lane was not relevant" and gets accepted with no proof. See `ci-plan.mjs`.
{
    const gate = workflow.slice(workflow.indexOf('\n  release-validation:'));
    const gateEnd = gate.indexOf('\n  deploy-testing:');
    const gateBlock = gateEnd === -1 ? gate : gate.slice(0, gateEnd);

    assert('E3b. the gate reads the lane plan from a single planner output',
        /LANE_PLAN:\s*\$\{\{\s*needs\.plan\.outputs\.lane_plan\s*\}\}\s*$/m.test(gateBlock),
        'LANE_PLAN must be exactly ${{ needs.plan.outputs.lane_plan }}');

    assert('E3c. the gate does not rebuild the lane plan from per-lane outputs',
        !/needs\.plan\.outputs\.(lane|attested)_(frontend|storybook|functions|rules)/.test(gateBlock),
        'per-lane plan outputs must not be reassembled into json in the workflow');
}

// And the planner must actually emit it, for every lane.
{
    const planner = readFileSync(resolvePath(here, './ci-plan.mjs'), 'utf8');
    assert('E3d. the planner emits a lane_plan output',
        /lane_plan:\s*JSON\.stringify\(lanePlan\)/.test(planner));
}

assert('E4. the promotion gate requires the release-validation check',
    REQUIRED_RELEASE_CHECKS.includes(GATE_JOB_NAME),
    `REQUIRED_RELEASE_CHECKS = ${JSON.stringify(REQUIRED_RELEASE_CHECKS)}`);

assert('E5. the release-validation job exists and always reports',
    new RegExp(`^\\s{4}name:\\s*${GATE_JOB_NAME}\\s*$`, 'm').test(workflow)
        && /release-validation:[\s\S]{0,600}?if:\s*always\(\)/.test(workflow),
    'the gate must run even when upstream jobs fail, or a failure would read as "no verdict"');

// Both deploy jobs, and therefore the release record and everything downstream
// of it, must sit behind the gate.
//
// The two clauses are a PAIR and neither may be dropped:
//
//   `!cancelled()` — a skip propagates down the WHOLE chain, and `always()` on
//   `release-validation` only un-skips that job, not its dependents. Without
//   this, a run where provenance proved every lane skips the deploy entirely
//   and main ships nothing. That happened on a60c6dc.
//
//   the explicit success check — `!cancelled()` also switches OFF the implicit
//   "all needs succeeded" rule, so this clause becomes the only thing stopping
//   a deploy after a FAILED gate.
//
// Dropping the first silently stops deployments; dropping the second silently
// permits an unvalidated one. Both are asserted.
// Applied to the WHOLE release chain rather than job by job, because this bug
// recurred three times: fixing `deploy-testing` alone left `deploy-functions`
// broken, and fixing both left `release-ready` broken one level further down.
// The taint keeps propagating past jobs that opted out, so every job below the
// gate needs the same pair.
//
// TWO CATEGORIES, and they need opposite rules:
//
//   GATED jobs must not run unless their dependencies succeeded. They do the
//   irreversible work — deploying, and declaring a release promotable.
//
//   REPORTER jobs must run EVEN WHEN their dependencies failed, because reporting
//   on that failure is their entire purpose. `verify-shipped` exists to say "the
//   deploy did not run"; a condition demanding a successful deploy would silence
//   it in exactly the case it was written for. Their checks live in their scripts,
//   where they are unit-tested, and are asserted separately below.
//
// Applying the gated rule to a reporter would silence the alarm; applying the
// reporter rule to a gated job would deploy after a failure. Hence two lists.
const RELEASE_CHAIN = ['deploy-testing', 'deploy-functions', 'release-ready'];
const REPORTER_JOBS = ['release-validation', 'verify-shipped'];

for (const jobId of RELEASE_CHAIN) {
    const block = workflow.slice(workflow.indexOf(`\n  ${jobId}:`));
    const header = block.slice(0, block.indexOf('\n    steps:'));
    // `needs:` entries are the `      - name` lines before the first key at
    // four-space indent that follows them.
    const needsBlock = header.slice(header.indexOf('\n    needs:'));
    const needs = [...needsBlock.matchAll(/^ {6}- ([a-z][a-z0-9-]*)$/gm)].map((m) => m[1]);

    assert(`E6. ${jobId} declares what it depends on`,
        needs.length > 0, 'expected a needs: list');

    assert(`E6b. ${jobId} opts out of the inherited skip`,
        /!\s*cancelled\(\)/.test(header),
        'without !cancelled() a run whose lanes were all proven skips this job, '
        + 'and main silently stops releasing');

    // `!cancelled()` disables the implicit "all needs succeeded" rule, so every
    // dependency has to be checked by hand. Missing one lets this job run after
    // that dependency FAILED.
    const unchecked = needs.filter((need) => !header.includes(`needs.${need}.result == 'success'`));
    assert(`E6c. ${jobId} checks every dependency explicitly`,
        unchecked.length === 0,
        `!cancelled() turns off the implicit success check, so these are unguarded: ${unchecked.join(', ')}`);
}

// Reporter jobs: the opposite rule. They must be able to run when their
// dependencies did not.
for (const jobId of REPORTER_JOBS) {
    const block = workflow.slice(workflow.indexOf(`\n  ${jobId}:`));
    const header = block.slice(0, block.indexOf('\n    steps:'));

    assert(`E6d. ${jobId} can still run when its dependencies failed`,
        /!\s*cancelled\(\)/.test(header) || /if:\s*always\(\)/.test(header),
        'a reporter that inherits the skip cannot report the thing it exists to report');

    assert(`E6e. ${jobId} does not gate itself on its dependencies succeeding`,
        !/needs\.(deploy-testing|deploy-functions|frontend-quality)\.result == 'success'/.test(header),
        'demanding a successful dependency would silence this job in exactly the case '
        + 'it was written for; the check belongs in its script, where it is unit-tested');
}

// E6f. Anything reachable by `workflow_dispatch` must be unsatisfiable off `main`.
//
// The `push` arm of these conditions was always pinned; the `workflow_dispatch`
// arm was pinned to nothing. A manual dispatch from a feature branch therefore
// deployed that branch to Testing and rolled out Cloud Functions that Production
// shares. It had never fired by accident only because a pull request cannot
// reach this path — `pull_request` matches neither arm — so nothing routine
// exercised it.
//
// This EVALUATES the condition instead of matching strings on it. The first
// version of this assertion checked that the header contained
// `github.ref == 'refs/heads/main'`, and a mutation test walked straight through
// it: the buggy form contains that exact string too, nested inside the push arm
// where it guards nothing. Substring checks cannot see structure. Substituting a
// hostile context and asking whether the job would run can.
//
// The job list is DERIVED from the workflow. A hardcoded list is how this file's
// other rules were learned the hard way — a new job with the same shape slips
// past a list, and the point of this rule is that the next one cannot.
//
// Deliberately NOT covered: `promote-production.yml`, which is dispatch-only with
// no branch guard. That is correct — it promotes an exact SHA resolved against
// the recorded Testing release rather than building whatever the ref points at,
// and rollback has to work from any ref. The rule is "a job that ships the
// current ref must be pinned to main", not "everything must be pinned".
{
    // Turn a GitHub `if:` expression into something JS can evaluate under a
    // supplied context. Only the operators these workflows actually use.
    const evaluateCondition = (expression, context) => {
        const js = expression
            .replace(/!\s*cancelled\(\)/g, String(!context.cancelled))
            .replace(/\bsuccess\(\)/g, 'true')
            .replace(/\balways\(\)/g, 'true')
            .replace(/github\.event_name/g, JSON.stringify(context.event_name))
            .replace(/github\.ref_name/g, JSON.stringify(context.ref.replace('refs/heads/', '')))
            .replace(/github\.ref/g, JSON.stringify(context.ref))
            .replace(/github\.repository/g, JSON.stringify(context.repository))
            .replace(/needs\.[a-z0-9-]+\.result/g, '"success"')
            .replace(/inputs\.[a-z_]+/g, '""')
            .replace(/'/g, '"');
        // eslint-disable-next-line no-new-func
        return Boolean(new Function(`return (${js});`)());
    };

    const dispatchJobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)]
        .map((match) => {
            const rest = workflow.slice(match.index + 1);
            const nextJob = rest.search(/^ {2}[a-z][a-z0-9-]*:$/m);
            const block = nextJob === -1 ? rest : rest.slice(0, nextJob);
            const stepsAt = block.indexOf('\n    steps:');
            const header = stepsAt === -1 ? block : block.slice(0, stepsAt);
            // `if: >-` folded scalar: the indented lines under it, joined.
            const ifAt = header.indexOf('\n    if: >-');
            if (ifAt === -1) return null;
            const lines = header.slice(ifAt).split('\n').slice(2);
            const body = [];
            for (const line of lines) {
                if (!/^ {6}\S/.test(line)) break;
                body.push(line.trim());
            }
            return { id: match[1], condition: body.join(' ') };
        })
        .filter((job) => job && job.condition.includes("github.event_name == 'workflow_dispatch'"));

    // If the scan finds nothing, the parser broke — that is not a clean result.
    assert('E6f. the dispatch-reachable job scan found jobs to check',
        dispatchJobs.length > 0,
        'no job mentions workflow_dispatch; the job-block parser is probably broken');

    const base = { cancelled: false, repository: 'Khomurod/SafeHaul' };

    const shippable = dispatchJobs.filter((job) => evaluateCondition(job.condition, {
        ...base, event_name: 'workflow_dispatch', ref: 'refs/heads/some-feature-branch',
    })).map((job) => job.id);

    assert('E6f. no dispatch-reachable job can run off main',
        shippable.length === 0,
        `these would run — and ship — from a dispatch on any branch: ${shippable.join(', ')}`);

    // And the fix must not have simply switched manual dispatch off: the
    // intended path, a dispatch on main, still has to reach these jobs.
    const brokenOnMain = dispatchJobs.filter((job) => !evaluateCondition(job.condition, {
        ...base, event_name: 'workflow_dispatch', ref: 'refs/heads/main',
    })).map((job) => job.id);

    assert('E6f. a dispatch on main still reaches them',
        brokenOnMain.length === 0,
        `pinning went too far — these can no longer be dispatched at all: ${brokenOnMain.join(', ')}`);

    // The set above is derived, so it cannot notice a job that drops out of it.
    // Removing `workflow_dispatch` from a deploy job would silently remove the
    // ability to re-run a deploy by hand — the same shape of failure as the
    // inherited-skip bug this file was written for, where nothing is red and
    // nothing ships. `RELEASE_CHAIN` is the list of jobs that must stay
    // manually runnable.
    const dispatchable = new Set(dispatchJobs.map((job) => job.id));
    const unreachable = RELEASE_CHAIN.filter((jobId) => !dispatchable.has(jobId));

    assert('E6g. the release chain can still be re-run by hand',
        unreachable.length === 0,
        `these no longer respond to workflow_dispatch at all: ${unreachable.join(', ')}`);
}

// `verify-shipped` is what turns "CI is green" into "it is actually live", so the
// promotion gate has to require it by name.
assert('E7a. the promotion gate requires proof the release shipped',
    REQUIRED_RELEASE_CHECKS.includes('Confirm the release actually shipped'),
    `REQUIRED_RELEASE_CHECKS = ${JSON.stringify(REQUIRED_RELEASE_CHECKS)}`);

// And it has to read the live site, not just trust the deploy job's exit code.
{
    const block = workflow.slice(workflow.indexOf('\n  verify-shipped:'));
    const job = block.slice(0, block.indexOf('\n  release-ready:'));
    assert('E7b. verify-shipped reads the deployed release back off the live site',
        job.includes('scripts/verify-live-release.mjs')
            && job.includes('https://truckerapp-system.web.app'),
        'a successful firebase exit code is not evidence the CDN is serving the new bundle');
    assert('E7c. verify-shipped checks that the deploy jobs actually ran',
        job.includes('scripts/verify-shipped.mjs'));
}

assert('E7. every required release check names a real job',
    REQUIRED_RELEASE_CHECKS.every((check) => {
        const escaped = check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s{4}name:\\s*['"]?${escaped}['"]?\\s*$`, 'm').test(workflow)
            || new RegExp(`^\\s{2}${escaped}:\\s*$`, 'm').test(workflow);
    }),
    'a renamed job would make every promotion refuse');

/* ========================================================================== */
