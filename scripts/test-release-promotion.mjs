#!/usr/bin/env node
/**
 * Test harness for the production-promotion gate.
 *
 * No external test runner; plain assertions, matching
 * scripts/test-deploy-incremental.mjs. Exit 0 = all pass, 1 = failures logged.
 *
 * These are the release system's FAILURE modes, and they matter more than the
 * happy path: every one of them is a way the wrong code could reach
 * app.safehaul.io. They are asserted here rather than discovered in production.
 *
 * Scenarios covered:
 *   1. A full, successfully-released Testing SHA resolves to its pinned version.
 *   2. A short SHA is refused (ambiguous — could match several commits).
 *   3. A branch name is refused (not a release identity).
 *   4. A SHA with no Testing deployment is refused — this is the "newer untested
 *      commit on main" case, and the one that must never succeed.
 *   5. A FAILED Testing deployment is not promotable.
 *   6. A Testing deployment with no pinned Hosting version is not promotable.
 *   7. A commit whose checks later went red is not promotable — including a
 *      SKIPPED required check, which is not a passed check, and a red individual
 *      test lane even though lanes are no longer in the required set.
 *   8. A repeat promotion of the live release reports already_live (idempotent,
 *      so a double-clicked button does not redeploy).
 *   9. Promoting an OLDER release while a newer one is live is allowed — that is
 *      rollback, and it must stay possible.
 *  10. The resolver reads pinned versions from the deployment payload, never
 *      from "whatever is currently live on Testing".
 *  11. A release whose backend rollout has not been confirmed (deployment still
 *      `in_progress`) is not promotable.
 *  12. QUEUED or IN-PROGRESS required checks refuse the promotion. "No completed
 *      failure yet" is not the same as "green".
 *  13. A required check that never ran at all refuses the promotion.
 *  14. Foreign deployment records sharing the `production` environment name (this
 *      repository has a long tail of Vercel-created ones) are ignored rather
 *      than mistaken for the live SafeHaul release.
 *  15. The required-check list matches the job names in main.yml, so a renamed
 *      job is caught in CI rather than at release time, and the check that
 *      vouches for the skippable lanes reports unconditionally.
 *  16. `readReleaseStatus` reports blockers instead of throwing, and never marks
 *      an unfinished release eligible.
 */


import { failureCount } from './release-promotion-tests/harness.mjs';
import { runGateScenarios } from './release-promotion-tests/gateScenarios.mjs';
import { runWorkflowPins } from './release-promotion-tests/workflowPins.mjs';
import { runStatusView } from './release-promotion-tests/statusView.mjs';

console.log('Production promotion gate');

await runGateScenarios();
await runWorkflowPins();
await runStatusView();

const failures = failureCount();
console.log(failures === 0 ? '\nAll promotion-gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
