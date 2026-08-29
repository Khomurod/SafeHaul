#!/usr/bin/env node
/**
 * Tests for the CI plan and the fail-closed release-validation gate.
 *
 * Plain assertions, no external runner, matching `scripts/test-secret-scan.mjs`
 * and `scripts/test-release-promotion.mjs`. Exit 0 = all pass.
 * Run with `npm run check:ci-plan`.
 *
 * ## What these are for
 *
 * They cover the ways a "skip work we already did" optimisation could turn into
 * a hole in the release gate. Every one of them is a way unvalidated code could
 * reach Testing and then be promoted to app.safehaul.io — and the pipeline
 * shipped nothing three times, in three separate jobs, before the wiring section
 * existed to notice.
 *
 * ## Seven sections, seven subjects
 *
 * | file                          | asks                                          |
 * |-------------------------------|-----------------------------------------------|
 * | `ci-plan/test-selection.mjs`  | which lanes does a change select, and what counts as proof? (A, B, C) |
 * | `ci-plan/test-gate.mjs`       | what does the gate refuse? (D)                |
 * | `ci-plan/test-wiring.mjs`     | do the lanes, jobs, attestations and promotion checks agree? (E) |
 * | `ci-plan/test-deploy-base.mjs`| does a failed deploy widen the next window? (F) |
 * | `ci-plan/test-shipped.mjs`    | did the release actually ship, and is it healthy? (G, H) |
 * | `ci-plan/test-workflow.mjs`   | is the workflow wired as written, Playwright projects included? (I, J) |
 * | `ci-plan/test-guards.mjs`     | do the blocking guards stay blocking? (K, L)  |
 *
 * They share `ci-plan/test-support.mjs` — the assertion counter, the `main.yml`
 * text and the lane helpers — and each asserts as it is evaluated. The count is
 * reported once, below. **The counter is shared on purpose:** a per-section
 * counter would let a section fail while the run exited 0.
 *
 * ## Imported one `await` at a time, deliberately
 *
 * Static imports are evaluated in declaration order, but a module using
 * top-level `await` suspends there and lets the next one run, so its output
 * lands inside a later section's. That was measured when `test-secret-scan.mjs`
 * was split. Sequential dynamic imports make each section finish before the next
 * starts, so the output reads in the order written here — which matters, because
 * these section banners are how a failing run is read.
 */

import { failureCount } from './ci-plan/test-support.mjs';

const SECTIONS = [
    './ci-plan/test-selection.mjs',
    './ci-plan/test-gate.mjs',
    './ci-plan/test-wiring.mjs',
    './ci-plan/test-deploy-base.mjs',
    './ci-plan/test-shipped.mjs',
    './ci-plan/test-workflow.mjs',
    './ci-plan/test-guards.mjs',
];

for (const section of SECTIONS) {
    await import(section);
}

const failures = failureCount();
console.log(failures === 0 ? '\nAll CI plan and gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
