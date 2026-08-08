#!/usr/bin/env node
/**
 * Is what is RUNNING still what we think we released?
 *
 * ## Why a monitor as well as a pipeline check
 *
 * `verify-shipped` proves a release went live at the moment it was released. That
 * cannot catch two things:
 *
 *   - something that breaks LATER — a function deleted in the console, a Hosting
 *     rollback, a release record left half-written;
 *   - something a successful run never noticed in the first place.
 *
 * The second one is not hypothetical. `surveyHistoricalReconstruction` was added
 * on 2026-08-07 and never deployed, because the merge that introduced it failed
 * mid-deploy and the next merge measured its changes from *after* that commit. It
 * stayed missing across several green runs, and was found only when a human opened
 * the Super Admin screen and saw "Something went wrong / internal". Twelve hours,
 * with nothing red anywhere.
 *
 * Checking what is actually live, on a schedule, is the only thing that finds that
 * class of problem. It asks four questions:
 *
 *   1. Does every callable the frontend calls exist in Cloud?
 *   2. Is Testing serving the release we last confirmed?
 *   3. Did main's newest commit actually ship?
 *   4. Is Production serving the release we last promoted?
 *
 * ## The callable probe is deliberately an OPTIONS preflight
 *
 * A POST would work, but `onCall` runs the handler before the auth check inside
 * it, so probing 85 functions would invoke 85 of them — with whatever side effects
 * any one of them has before it looks at `request.auth`. An OPTIONS preflight is
 * answered by the Functions framework itself and never reaches user code.
 *
 * Verified against live infrastructure: **204 for a deployed callable, 404 for one
 * that does not exist.** Only a definitive 404 is treated as missing; a timeout, a
 * 5xx or a network error is reported as "could not check" and does NOT raise an
 * alarm, because a monitor that cries wolf gets muted and then it protects nothing.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFrontendCallables } from './check-callable-contract.mjs';

const require = createRequire(import.meta.url);
const { createGithubApi, isSafeHaulRelease } = require('../functions/releaseManagement/eligibility.js');

const TESTING_ORIGIN = 'https://truckerapp-system.web.app';
const PRODUCTION_ORIGIN = 'https://app.safehaul.io';
const FUNCTIONS_ORIGIN = 'https://us-central1-truckerapp-system.cloudfunctions.net';

/**
 * How long a commit may sit on main without a confirmed release before that is
 * worth reporting. Long enough that a merge in progress never trips it.
 */
export const SHIP_GRACE_MS = 2 * 60 * 60 * 1000;

/** Where the findings are left for `scripts/report-release-health.mjs` to file. */
export const REPORT_FILE = 'release-health-report.md';

/** A finding an operator should act on. */
const problem = (title, detail) => ({ title, detail });

/* -------------------------------------------------------------------------- */
/* Checks — each pure over its inputs, so every verdict is unit-tested         */
/* -------------------------------------------------------------------------- */

/**
 * 1. Every callable the frontend calls exists in Cloud.
 *
 * @param {Array<{name: string, status: number|null}>} probes
 */
export function judgeCallables(probes) {
    const missing = probes.filter((p) => p.status === 404).map((p) => p.name);
    const unchecked = probes.filter((p) => p.status === null).map((p) => p.name);

    const problems = [];
    if (missing.length > 0) {
        problems.push(problem(
            `${missing.length} callable(s) the app uses do not exist in Cloud`,
            `The app calls these, and Firebase answers 404 — so the buttons that use them fail with `
            + `"internal": ${missing.join(', ')}. This usually means a deploy was skipped or failed `
            + 'and the function was never published.',
        ));
    }
    // Reported, never alarmed on: see the note at the top about crying wolf.
    return { problems, missing, unchecked };
}

/**
 * 2 & 4. A live site is serving the release its record claims.
 *
 * @param {string} label human name of the channel
 * @param {string|null} recordedSha newest CONFIRMED release for that channel
 * @param {string|null} liveSha what the site is actually serving
 */
export function judgeChannel(label, recordedSha, liveSha) {
    if (!recordedSha) return { problems: [] };
    if (!liveSha) {
        return {
            problems: [problem(
                `${label} did not report which release it is serving`,
                `Could not read release.json from ${label}. The site may be down, or serving a build `
                + 'that predates release manifests.',
            )],
        };
    }
    if (recordedSha !== liveSha) {
        return {
            problems: [problem(
                `${label} is not serving the release we recorded`,
                `The last confirmed ${label} release is ${recordedSha}, but the site is serving `
                + `${liveSha}. Something changed ${label} outside the pipeline, or a deploy only `
                + 'partly succeeded.',
            )],
        };
    }
    return { problems: [] };
}

/**
 * 3. main's newest commit actually shipped.
 *
 * @param {{sha: string, committedAtMs: number}} head
 * @param {string[]} confirmedShas every SHA with a confirmed Testing release
 * @param {number} nowMs
 */
export function judgeMainShipped(head, confirmedShas, nowMs) {
    if (!head?.sha) return { problems: [] };
    if (confirmedShas.includes(head.sha)) return { problems: [] };

    const ageMs = nowMs - head.committedAtMs;
    if (ageMs < SHIP_GRACE_MS) return { problems: [] };

    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    return {
        problems: [problem(
            'The newest commit on main was never released to Testing',
            `${head.sha} has been on main for about ${hours} hour(s) and still has no confirmed `
            + 'Testing release. Its pipeline run either failed, was cancelled, or deployed nothing.',
        )],
    };
}

/* -------------------------------------------------------------------------- */
/* Live readers                                                               */
/* -------------------------------------------------------------------------- */

async function probeCallable(name, fetchImpl = fetch) {
    try {
        const response = await fetchImpl(`${FUNCTIONS_ORIGIN}/${name}`, {
            method: 'OPTIONS',
            headers: {
                Origin: TESTING_ORIGIN,
                'Access-Control-Request-Method': 'POST',
            },
            signal: AbortSignal.timeout(20_000),
        });
        return { name, status: response.status };
    } catch {
        // Unreachable is not the same as absent.
        return { name, status: null };
    }
}

async function readLiveSha(origin, fetchImpl = fetch) {
    try {
        const response = await fetchImpl(`${origin}/release.json?at=${Date.now()}`, {
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) return null;
        if (!(response.headers.get('content-type') || '').includes('json')) return null;
        return (await response.json())?.sha ?? null;
    } catch {
        return null;
    }
}

/** Every SHA with a CONFIRMED release on a channel, newest first. */
export async function readConfirmedReleases(api, environment) {
    const deployments = await api(`/deployments?environment=${environment}&per_page=100`);
    const confirmed = [];
    for (const deployment of Array.isArray(deployments) ? deployments : []) {
        if (!isSafeHaulRelease(deployment)) continue;
        const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=100`);
        if ((Array.isArray(statuses) ? statuses[0]?.state : undefined) !== 'success') continue;
        if (deployment.sha) confirmed.push(deployment.sha);
    }
    return confirmed;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/** Renders findings as the issue body / job summary an operator reads. */
export function renderReport(problems, notes) {
    if (problems.length === 0) {
        return ['## Release health: OK', '', ...notes.map((n) => `- ${n}`), ''].join('\n');
    }
    return [
        '## Release health: PROBLEMS FOUND',
        '',
        'Something that is supposed to be live is not. Each item below was read from the',
        'running system, not from a build log.',
        '',
        ...problems.flatMap(({ title, detail }) => [`### ${title}`, '', detail, '']),
        '---',
        '',
        ...notes.map((n) => `- ${n}`),
        '',
    ].join('\n');
}

async function main() {
    const {
        GITHUB_TOKEN: token,
        GITHUB_REPOSITORY: repository = 'Khomurod/SafeHaul',
        GITHUB_STEP_SUMMARY: summaryFile,
    } = process.env;

    const problems = [];
    const notes = [];

    // 1 — callables
    const names = readFrontendCallables();
    const probes = [];
    for (const name of names) probes.push(await probeCallable(name));
    const callables = judgeCallables(probes);
    problems.push(...callables.problems);
    notes.push(`Checked ${names.length} callables the app uses; `
        + `${probes.filter((p) => p.status !== 404 && p.status !== null).length} present, `
        + `${callables.missing.length} missing, ${callables.unchecked.length} unreachable.`);

    // 2, 3, 4 — release records vs what is actually live
    if (token) {
        const api = createGithubApi({ token, repository });
        try {
            const [testing, production] = await Promise.all([
                readConfirmedReleases(api, 'testing'),
                readConfirmedReleases(api, 'production'),
            ]);
            const [liveTesting, liveProduction] = await Promise.all([
                readLiveSha(TESTING_ORIGIN),
                readLiveSha(PRODUCTION_ORIGIN),
            ]);

            problems.push(...judgeChannel('Testing', testing[0] || null, liveTesting).problems);
            problems.push(...judgeChannel('Production', production[0] || null, liveProduction).problems);
            notes.push(`Testing is serving ${liveTesting || 'an unreadable release'}; `
                + `Production is serving ${liveProduction || 'an unreadable release'}.`);

            const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
            const headAt = Number(
                execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' }).trim(),
            ) * 1000;
            problems.push(...judgeMainShipped(
                { sha: headSha, committedAtMs: headAt }, testing, Date.now(),
            ).problems);
        } catch (error) {
            notes.push(`Could not read the release records: ${error.message}`);
        }
    } else {
        notes.push('No credentials, so only the callable check ran.');
    }

    const report = renderReport(problems, notes);
    console.log(report);

    const { appendFileSync, writeFileSync } = await import('node:fs');
    if (summaryFile) appendFileSync(summaryFile, `${report}\n`, 'utf8');
    // Handed to `scripts/report-release-health.mjs`, which files it as an issue.
    // A file rather than an output because the report is multi-line prose.
    writeFileSync(REPORT_FILE, report, 'utf8');

    process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(`Release health check could not complete: ${error.message}`);
        process.exit(1);
    });
}
