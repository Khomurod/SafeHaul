/**
 * Shared fixtures for the CI-plan test sections.
 *
 * ## Why the counter lives here
 *
 * Each section asserts as it is evaluated and reports nothing itself; the entry
 * prints the total once, at the end. That only works if every section increments
 * the *same* counter, which is why `assert` is here rather than duplicated. A
 * per-section counter would let a section fail while the run exited 0.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { ALWAYS_REQUIRED_JOBS, LANES, LANE_NAMES, selectLanes } from '../ci-plan.mjs';

/**
 * `scripts/`, NOT this directory.
 *
 * The sections were split out of `scripts/test-ci-plan.mjs` and resolve repository
 * paths relative to where that file lived. Exporting the parent keeps every one of
 * those `resolvePath(here, ...)` calls correct instead of rewriting each by hand —
 * and a rewritten path that is wrong fails at read time, deep inside a section,
 * which is a poor place to find out.
 */
export const here = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** `.github/workflows/main.yml`, read once. Most sections assert against it. */
export const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');

let failures = 0;

export function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Read by the entry after every section has run. */
export const failureCount = () => failures;

/** A tree hash that is obviously synthetic, so a real one cannot be mistaken for it. */
export const TREE = 'f'.repeat(40);
export const REPO_ID = 4321;

/** The lanes `selectLanes` turned on, as a sorted list. */
export const chosen = (files) => {
    const { lanes } = selectLanes({ changedFiles: files });
    return LANE_NAMES.filter((lane) => lanes[lane]).sort();
};

/**
 * Every job in the workflow set to one result, with the always-required jobs
 * green. The gate section builds refusals from it; the guards section reuses it
 * to prove `secret-scan` cannot be waved through.
 */
export const allJobs = (result) => {
    const jobs = Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((job) => [job, 'success']));
    for (const lane of LANE_NAMES) for (const job of LANES[lane].jobs) jobs[job] = result;
    return jobs;
};

/** A lane plan built by calling `make(lane)` for every lane. */
export const plan = (make) => Object.fromEntries(LANE_NAMES.map((lane) => [lane, make(lane)]));
