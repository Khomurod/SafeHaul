#!/usr/bin/env node
/**
 * Tests for the blocking secret scanner: the range it chooses, and what that
 * range actually catches.
 *
 * Plain assertions, no external runner, matching `scripts/test-ci-plan.mjs`.
 * Exit 0 = all pass. Run with `npm run test:secret-scan`.
 *
 * ## Why these tests are the point of the change
 *
 * The defect they exist to prevent was not a wrong regex — it was a wrong
 * *range*, chosen invisibly by a third-party action, and nothing in this
 * repository could see it. `workflow_dispatch` scanned all 256 commits and
 * reported eight known legacy values as though the release had introduced them;
 * `--first-parent` quietly skipped whole merged branches. Both are range bugs,
 * both were silent, and a rule-level test would have passed through either.
 *
 * ## Five sections, five subjects
 *
 * | file                             | asks                                      |
 * |----------------------------------|-------------------------------------------|
 * | `secret-scan/test-range.mjs`     | which range does each event compare?      |
 * | `secret-scan/test-detection.mjs` | what does that range actually catch?      |
 * | `secret-scan/test-failsafe.mjs`  | is an untrustworthy base ever widened?    |
 * | `secret-scan/test-validated.mjs` | what counts as a validated baseline?      |
 * | `secret-scan/test-pinning.mjs`   | is the scanner pinned, and the audit apart? |
 *
 * They share `secret-scan/test-support.mjs` — the assertion counter, the derived
 * synthetic secrets, the throwaway repositories and the pinned binary — and each
 * asserts as it is evaluated. The count is reported once, below.
 *
 * Imported one `await` at a time, deliberately. Static imports are evaluated in
 * declaration order, but a module that uses top-level `await` — which the
 * validated-baseline section does, since the lookup is async — SUSPENDS there and
 * lets the next module run, so its output lands after a later section's. Measured
 * when this was split: the pinning section printed before it. Sequential dynamic
 * imports make each section finish before the next starts, so the output reads in
 * the order written here.
 *
 * Split out of a single 1246-line file on 2026-08-27. Nothing was rewritten in
 * the move: the section bodies are the same lines, so the assertion count before
 * and after is identical and a diff can be read as the move it is.
 */

import { cleanup, failureCount } from './secret-scan/test-support.mjs';

for (const section of [
    './secret-scan/test-range.mjs',
    './secret-scan/test-detection.mjs',
    './secret-scan/test-failsafe.mjs',
    './secret-scan/test-validated.mjs',
    './secret-scan/test-pinning.mjs',
]) {
    // Sequential, deliberately — see above: a section that awaits must finish
    // before the next one starts, or its output lands after a later section's.
    await import(section);
}

cleanup();

const failures = failureCount();
console.log(failures === 0
    ? '\nAll secret-scan range and detection checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
