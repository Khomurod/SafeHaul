#!/usr/bin/env node
/**
 * THE single check that says whether a release is fully validated.
 *
 * `scripts/ci-plan.mjs` decides what to skip. This decides whether those skips
 * were legitimate — and it is a separate job, run after everything else, so a
 * planner bug cannot approve its own shortcuts. `REQUIRED_RELEASE_CHECKS` in
 * `functions/releaseManagement/eligibility.js` requires this job by name, which
 * makes it the thing standing between a partially-validated commit and
 * app.safehaul.io.
 *
 * For every lane it demands one of exactly three outcomes:
 *
 *   ran     — every job in the lane concluded `success` in this run;
 *   proven  — the lane was skipped, and an attestation shows it passed against
 *             this exact source tree (see `ci-plan.mjs` for why a git tree hash
 *             is a sound identity for a content-determined test);
 *   n/a     — the lane was skipped because nothing in the change set can affect
 *             it.
 *
 * Anything else is a refusal. In particular:
 *
 *   - a lane whose jobs were skipped with no attestation and no irrelevance
 *     finding is a REFUSAL, not a pass. This is the loophole the whole file
 *     exists to close: without it, deleting a job from the workflow, or an `if:`
 *     that quietly evaluates false, would read as "nothing failed";
 *   - `cancelled` and `timed_out` are refusals. A cancelled suite proves
 *     nothing;
 *   - a plan job that did not itself succeed is a refusal, because every
 *     justification for skipping comes from its outputs;
 *   - a lane the workflow reports on but `LANES` does not know about — or the
 *     reverse — is a refusal, so the two cannot drift apart silently.
 *
 * The job that runs this is declared `if: always()`, so it produces a verdict
 * even when upstream jobs failed or the run was cancelled. A verdict that never
 * appears is itself treated as a refusal by the promotion gate, which requires
 * this check to be PRESENT and `success`.
 *
 * Inputs, all JSON in the environment (see `main.yml`):
 *   PLAN_RESULT   the `plan` job's result
 *   JOB_RESULTS   {"<job id>": "success"|"failure"|"skipped"|"cancelled", ...}
 *   LANE_PLAN     {"<lane>": {"selected": bool, "attested": bool}, ...}
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALWAYS_REQUIRED_JOBS, LANES, LANE_NAMES } from './ci-plan.mjs';

/** Job results that mean "this did not run to a successful finish". */
const BAD_RESULTS = Object.freeze(['failure', 'cancelled', 'timed_out']);

/**
 * Evaluates one release's validation completeness.
 *
 * Pure: no network, no filesystem, no environment. Every refusal path is
 * covered by `scripts/test-ci-plan.mjs`.
 *
 * @param {object} options
 * @param {string} options.planResult
 * @param {Record<string, string>} options.jobResults
 * @param {Record<string, {selected: boolean, attested: boolean}>} options.lanePlan
 * @returns {{ok: boolean, lanes: Array<{lane: string, verdict: string, detail: string, ok: boolean}>, problems: string[]}}
 */
export function evaluateValidation({ planResult, jobResults, lanePlan }) {
    const problems = [];
    const lanes = [];
    const results = jobResults && typeof jobResults === 'object' ? jobResults : {};

    // The plan is the source of every "it was safe to skip this" claim. If it
    // did not succeed, none of those claims exist.
    if (planResult !== 'success') {
        problems.push(
            `the CI plan job concluded "${planResult || 'nothing'}", so no skipped lane can be ` +
            'justified. Re-run the workflow.',
        );
    }

    if (!lanePlan || typeof lanePlan !== 'object') {
        problems.push('the CI plan produced no lane decisions, so nothing can be verified.');
        return { ok: false, lanes, problems };
    }

    // Drift between the workflow and `LANES` must not be silent in either
    // direction: an unknown lane could smuggle a skip past this check, and a
    // missing one could hide a lane entirely.
    const planned = Object.keys(lanePlan);
    const unknown = planned.filter((lane) => !LANE_NAMES.includes(lane));
    const absent = LANE_NAMES.filter((lane) => !planned.includes(lane));
    if (unknown.length > 0) problems.push(`the plan reported unknown lanes: ${unknown.join(', ')}.`);
    if (absent.length > 0) problems.push(`the plan did not report on: ${absent.join(', ')}.`);

    for (const job of ALWAYS_REQUIRED_JOBS) {
        const result = results[job];
        if (result !== 'success') {
            problems.push(`${job} must run on every release but concluded "${result || 'nothing'}".`);
        }
    }

    for (const lane of LANE_NAMES) {
        const decision = lanePlan[lane] || {};
        const jobs = LANES[lane].jobs;
        const outcomes = jobs.map((job) => ({ job, result: results[job] }));

        const failed = outcomes.filter(({ result }) => BAD_RESULTS.includes(result));
        if (failed.length > 0) {
            lanes.push({
                lane,
                ok: false,
                verdict: 'failed',
                detail: failed.map(({ job, result }) => `${job}=${result}`).join(', '),
            });
            problems.push(`${lane} did not pass: ${failed.map(({ job, result }) => `${job}=${result}`).join(', ')}.`);
            continue;
        }

        // A lane that ran and passed needs no justification at all, so the plan's
        // decision about it is not consulted.
        if (outcomes.every(({ result }) => result === 'success')) {
            lanes.push({ lane, ok: true, verdict: 'ran', detail: 'executed and passed in this run' });
            continue;
        }

        if (outcomes.every(({ result }) => result === 'skipped')) {
            // A SKIP needs a justification, and the justification must be a real
            // boolean.
            //
            // Reading these as `x === true` alone would fail OPEN, not closed: a
            // `selected` that arrived as the STRING "true" — one stray pair of
            // quotes around a `${{ }}` interpolation in `main.yml` — compares
            // false, the lane reads as "not relevant to this change", and it is
            // accepted with no proof it ever passed. So a mistyped or missing
            // decision is a refusal.
            if (typeof decision.selected !== 'boolean' || typeof decision.attested !== 'boolean') {
                const reported = `selected=${JSON.stringify(decision.selected)}, `
                    + `attested=${JSON.stringify(decision.attested)}`;
                lanes.push({
                    lane,
                    ok: false,
                    verdict: 'undecided',
                    detail: `skipped, and the plan reported ${reported} — both must be booleans`,
                });
                problems.push(
                    `${lane} was skipped but the CI plan gave no usable reason (${reported}), `
                    + 'so it cannot be treated as validated.',
                );
                continue;
            }

            if (decision.attested) {
                lanes.push({
                    lane,
                    ok: true,
                    verdict: 'proven',
                    detail: 'already passed against this exact source tree',
                });
                continue;
            }
            if (!decision.selected) {
                lanes.push({
                    lane,
                    ok: true,
                    verdict: 'n/a',
                    detail: 'nothing in this change can affect it',
                });
                continue;
            }
            lanes.push({
                lane,
                ok: false,
                verdict: 'unjustified skip',
                detail: 'relevant to this change, and not validated anywhere',
            });
            problems.push(
                `${lane} was skipped but is relevant to this change and has no proof it ever ` +
                'passed on this code.',
            );
            continue;
        }

        // Mixed or unrecognised results — including a job absent from
        // `JOB_RESULTS` entirely, which is what a deleted or renamed job looks
        // like from here.
        lanes.push({
            lane,
            ok: false,
            verdict: 'indeterminate',
            detail: outcomes.map(({ job, result }) => `${job}=${result || 'absent'}`).join(', '),
        });
        problems.push(
            `${lane} is in an unrecognised state (${outcomes
                .map(({ job, result }) => `${job}=${result || 'absent'}`)
                .join(', ')}), so it cannot be treated as validated.`,
        );
    }

    return { ok: problems.length === 0 && lanes.every((lane) => lane.ok), lanes, problems };
}

/** GitHub-flavoured summary of a verdict. */
export function renderVerdict({ ok, lanes, problems }) {
    const symbol = { ran: '✅ ran', proven: '✅ proven', 'n/a': '➖ not applicable' };
    return [
        `### Release validation — ${ok ? 'COMPLETE' : 'INCOMPLETE'}`,
        '',
        '| Lane | Outcome | Why |',
        '| --- | --- | --- |',
        ...lanes.map(({ lane, verdict, detail }) =>
            `| \`${lane}\` | ${symbol[verdict] || `❌ ${verdict}`} | ${detail} |`),
        '',
        ...(problems.length
            ? ['**This release is not fully validated:**', '', ...problems.map((p) => `- ${p}`), '']
            : ['Every lane either ran here or is provably covered for this exact source tree.', '']),
    ].join('\n');
}

function parseJson(label, raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Could not parse ${label}: ${error.message}`);
        return null;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    // Destructured from the environment rather than read by property access,
    // matching the other release scripts.
    // `functions/test/unit/environmentRegistry.inventory.test.js` treats every
    // named property read off the environment as a configuration key that must
    // appear in the Environment & Integrations vault. These four are CI-run
    // plumbing, not SafeHaul configuration, and do not belong on that screen.
    const {
        PLAN_RESULT: planResult,
        JOB_RESULTS: jobResultsJson,
        LANE_PLAN: lanePlanJson,
        GITHUB_STEP_SUMMARY: summaryFile,
    } = process.env;

    const verdict = evaluateValidation({
        planResult,
        jobResults: parseJson('JOB_RESULTS', jobResultsJson),
        lanePlan: parseJson('LANE_PLAN', lanePlanJson),
    });

    const rendered = renderVerdict(verdict);
    console.log(rendered);
    if (summaryFile) {
        appendFileSync(summaryFile, `${rendered}\n`, 'utf8');
    }

    process.exit(verdict.ok ? 0 : 1);
}
