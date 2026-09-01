/**
 * Promotion-gate scenarios 15, 17 and 18 — the assertions that read
 * `main.yml` itself, verbatim from `test-release-promotion.mjs`: the
 * required-check list must name real jobs, a merge to main must never be able
 * to deploy the Production frontend, and the release callables redeploy on
 * every main push.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { REQUIRED_RELEASE_CHECKS } from '../resolve-testing-release.mjs';
import { assert } from './harness.mjs';

export async function runWorkflowPins() {
// 15 — the required-check list must match the workflow's real job names
{
    // One directory deeper than the original test-release-promotion.mjs, so
    // the workflow paths gain one '..'.
    const here = dirname(fileURLToPath(import.meta.url));
    const workflow = readFileSync(resolvePath(here, '../../.github/workflows/main.yml'), 'utf8');
    const missing = REQUIRED_RELEASE_CHECKS.filter((name) => {
        // A job contributes its `name:` when set, otherwise its job id.
        const asJobName = new RegExp(`^\\s{4}name:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm');
        const asJobId = new RegExp(`^\\s{2}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm');
        return !asJobName.test(workflow) && !asJobId.test(workflow);
    });
    assert('15. every required check names a real job in main.yml',
        missing.length === 0,
        `not found in main.yml: ${missing.join(', ')}`);

    // 15b — A REQUIRED CHECK MUST NOT BE SKIPPABLE BY THE CI PLAN.
    //
    // `main.yml` skips test lanes it can prove were already validated, using
    // `if: needs.plan.outputs.run_<lane> == 'true'`. A required check wired to one
    // of those conditions would be skippable — and while `evaluateRequiredChecks`
    // now refuses a skipped required check, that would mean every optimised
    // release was un-promotable. Either way it is wrong, so the two sets are kept
    // disjoint here rather than by memory.
    const jobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match, index, all) => {
        const start = match.index;
        const end = index + 1 < all.length ? all[index + 1].index : workflow.length;
        const block = workflow.slice(start, end);
        const stepsAt = block.indexOf('\n    steps:');
        return {
            id: match[1],
            header: stepsAt === -1 ? block : block.slice(0, stepsAt),
        };
    });

    const planGated = REQUIRED_RELEASE_CHECKS.filter((check) => {
        const job = jobs.find(({ id, header }) => id === check
            || new RegExp(`^ {4}name:\\s*['"]?${check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(header));
        return job ? /needs\.plan\.outputs\.(run|lane|attested)_/.test(job.header) : false;
    });

    assert('15b. no required check can be skipped by the CI plan',
        planGated.length === 0,
        `these required checks are gated on the plan: ${planGated.join(', ')}`);
}

// 17 — a merge to main must NEVER be able to update the Production frontend.
//
// This is the load-bearing property of the whole two-channel architecture, and
// it is currently true only because nothing in main.yml names a production
// Hosting target. That is one careless copy-paste away from being false, and the
// failure would be silent: the pipeline would go green while every merge shipped
// straight to app.safehaul.io. So it is asserted rather than assumed.
{
    // One directory deeper than the original test-release-promotion.mjs, so
    // the workflow paths gain one '..'.
    const here = dirname(fileURLToPath(import.meta.url));
    const mainWorkflow = readFileSync(resolvePath(here, '../../.github/workflows/main.yml'), 'utf8');

    const forbidden = [
        'hosting:production',
        'safehaul-app-production',
        'landing-production',
        'safehaul-landing-production',
    ].filter((needle) => mainWorkflow.includes(needle));

    assert('17. main.yml cannot deploy the Production frontend',
        forbidden.length === 0,
        `main.yml references production Hosting: ${forbidden.join(', ')}`);

    // And the promotion workflow must stay manual-only — a `push:` trigger there
    // would reintroduce automatic production releases by the other door.
    const promoteWorkflow = readFileSync(resolvePath(here, '../../.github/workflows/promote-production.yml'), 'utf8');
    const triggers = promoteWorkflow.slice(promoteWorkflow.indexOf('\non:'), promoteWorkflow.indexOf('\njobs:'));

    assert('17b. the promotion workflow is dispatch-only',
        triggers.includes('workflow_dispatch') && !/\n\s{2}(push|schedule|pull_request):/.test(triggers),
        `promote-production.yml triggers: ${triggers.replace(/\s+/g, ' ').slice(0, 200)}`);

    // 18 — a rotated release credential must actually reach runtime.
    //
    // A Functions deploy pins each bound secret to the version that existed at
    // deploy time, and the incremental planner only redeploys functions whose
    // source changed — which rotating a credential never does. Without these
    // three on the always-include list, a rotated GitHub App key would sit in
    // Secret Manager doing nothing, and the only symptom would be the Releases
    // screen quietly reporting that it is not connected.
    const alwaysInclude = mainWorkflow.match(/DEPLOY_FUNCTIONS_ALWAYS_INCLUDE:\s*(\S+)/)?.[1] || '';
    const releaseCallables = ['getReleaseStatus', 'promoteTestingToProduction', 'rollbackProductionRelease'];
    const notForced = releaseCallables.filter((name) => !alwaysInclude.split(',').includes(name));

    assert('18. the release callables redeploy on every main push',
        notForced.length === 0,
        `missing from DEPLOY_FUNCTIONS_ALWAYS_INCLUDE: ${notForced.join(', ')}`);
}

}
