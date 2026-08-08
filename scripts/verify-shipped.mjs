#!/usr/bin/env node
/**
 * Did this release actually ship?
 *
 * ## Why this job exists
 *
 * On 2026-08-08, merge a60c6dc validated in 37 seconds — every test lane skipped
 * because provenance had proved them — and then deployed nothing at all. Both
 * deploy jobs and `release-ready` were skipped, Testing stayed on the previous
 * release, and **the run reported success**. The cause was GitHub's skip
 * propagation: a skipped job's skip travels down the entire dependency chain, and
 * `always()` only un-skips the job that declares it.
 *
 * That is the shape of the problem this file addresses, and the shape is more
 * general than that one bug: **a green pipeline was never evidence that anything
 * reached users.** Every failure that day was found by a human opening a screen.
 *
 * So the pipeline now has to prove it. Two questions, both answered before a
 * release may be called ready:
 *
 *   1. Did the deploy jobs actually RUN and succeed? (this file)
 *   2. Is the live site really serving this commit?
 *      (`scripts/verify-live-release.mjs`, reused unchanged — it already retries
 *      past CDN propagation and cache-busts the edge)
 *
 * ## Why it must run when its dependencies failed
 *
 * Every other job below the gate is written to NOT run unless its dependencies
 * succeeded. This one is the exact opposite: a deploy that was skipped or failed
 * is precisely what it exists to report, so it declares `!cancelled()` and makes
 * no demand of its `needs` in the workflow. The demand is here instead, in code
 * that is unit-tested, rather than in a YAML condition that silently evaluates to
 * "don't bother".
 *
 * `release-ready` depends on THIS job, so a release nobody can see live never
 * becomes promotable.
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The deploy jobs whose outcome decides whether a release shipped, and what each
 * one failing to run actually means for the operator reading this.
 */
export const REQUIRED_DEPLOY_JOBS = Object.freeze({
    'deploy-testing': 'the Testing frontend, Firestore rules, Storage rules and indexes',
    'deploy-functions': 'the shared Cloud Functions backend that Production also runs on',
});

/** What a non-success result means, in words an operator can act on. */
function explain(job, result) {
    const what = REQUIRED_DEPLOY_JOBS[job];
    switch (result) {
        case 'skipped':
            return `${job} was SKIPPED, so ${what} never deployed. This is the failure `
                + 'mode where CI goes green and nothing reaches users — usually a job '
                + 'condition that inherited a skip from further up the chain.';
        case 'failure':
            return `${job} FAILED, so ${what} did not deploy.`;
        case 'cancelled':
            return `${job} was CANCELLED, so ${what} may have deployed only partly.`;
        case undefined:
        case null:
        case '':
            return `${job} reported no result at all, so there is no evidence ${what} `
                + 'deployed. A renamed or deleted job looks exactly like this.';
        default:
            return `${job} reported an unrecognised result "${result}", which cannot be `
                + `read as proof that ${what} deployed.`;
    }
}

/**
 * Verdict on whether the deploy jobs ran.
 *
 * Pure, so every refusal path is covered by `scripts/test-ci-plan.mjs` rather
 * than discovered on a live release.
 *
 * @param {Record<string, string|undefined>} jobResults
 * @returns {{ok: boolean, problems: string[], rows: Array<{job: string, result: string, ok: boolean}>}}
 */
export function evaluateDeployResults(jobResults) {
    const results = jobResults && typeof jobResults === 'object' ? jobResults : {};
    const problems = [];
    const rows = [];

    for (const job of Object.keys(REQUIRED_DEPLOY_JOBS)) {
        const result = results[job];
        const ok = result === 'success';
        rows.push({ job, result: result || 'nothing', ok });
        if (!ok) problems.push(explain(job, result));
    }

    return { ok: problems.length === 0, problems, rows };
}

/** GitHub-flavoured summary of a verdict. */
export function renderVerdict({ ok, problems, rows }, sha) {
    return [
        `### Did ${sha ? `\`${sha.slice(0, 8)}\`` : 'this release'} actually ship?`,
        '',
        '| Deploy | Result |',
        '| --- | --- |',
        ...rows.map(({ job, result, ok: good }) => `| \`${job}\` | ${good ? '✅' : '❌'} ${result} |`),
        '',
        ...(ok
            ? ['Both deploys ran. The live site is checked next.', '']
            : ['**This release did not ship:**', '', ...problems.map((p) => `- ${p}`), '']),
    ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const {
        DEPLOY_TESTING_RESULT: deployTesting,
        DEPLOY_FUNCTIONS_RESULT: deployFunctions,
        GITHUB_SHA: sha,
        GITHUB_STEP_SUMMARY: summaryFile,
    } = process.env;

    const verdict = evaluateDeployResults({
        'deploy-testing': deployTesting,
        'deploy-functions': deployFunctions,
    });

    const rendered = renderVerdict(verdict, sha);
    console.log(rendered);
    if (summaryFile) appendFileSync(summaryFile, `${rendered}\n`, 'utf8');

    process.exit(verdict.ok ? 0 : 1);
}
