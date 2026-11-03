# M7c. Give submitGuestApplication more memory (only if M7a's numbers call for it)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #7 — Move slow tasks to a background job queue (step 3: more memory for the submit call, if the metrics show the need).
- **Size:** S · **Pull requests:** 1 · **Depends on:** M7a (do it only when M7a's decision rule says so; otherwise tick it "not needed" and quote the numbers). Merge it before M7b PR 2 starts, because both edit `guestApplication.js`. · **Owner decision needed:** "Raise submitGuestApplication from 256MB to 512MB, or to 1GB if p99 ≥ 20 s or any call timed out?" Recommended answer: **yes when the M7a rule triggers**; the cost at our volume is negligible; check billing after a week.
- **Why it matters for users:** A driver waits on Submit while the server draws the PDF. On the smallest tier that work gets one sixth of a CPU. Doubling the memory doubles the CPU, so drivers wait less and fewer PDFs are cut off at the 15 s limit.

## Current behaviour (verified at 11626a6)

- `functions/guestApplication.js:168-170`: `functions.runWith({ memory: '256MB', timeoutSeconds: 30 })` on a 1st-gen callable (`require('firebase-functions/v1')` at :6).
- Firebase docs (Context7 `/websites/firebase_google`, "Override CPU defaults"): 1st gen 256MB = 1/6 CPU, 512MB = 1/3, 1GB = 7/12. Valid 1st-gen values: '128MB', '256MB', '512MB', '1GB', '2GB', '4GB', '8GB' (`FunctionBuilder.runWith`).
- The budgets `ANSWER_WITHIN_MS = 24000` (:44) and `PDF_STEP_MS = 15000` (:50) are tied to how the browser retries (:39-43). Keep them.
- `functions/test/unit/deployedEntryPoint.test.js:31,61-68` keeps 256MB as the floor; a higher value passes. `docs/APP_BRIEF.md:1110` records only that floor.
- `functions/test/unit/guestApplication.test.js:10` and `functions/test/unit/guestApplication.snapshot.support.js:121` mock `runWith`, so no test pins the value.

## Scope

- In: the one `memory` value at `guestApplication.js:169`, with a one-line comment giving the reason.
- Out (do not do in this task): `timeoutSeconds`, `ANSWER_WITHIN_MS`, `PDF_STEP_MS`; moving the function to 2nd gen (that means deleting and recreating the callable, which risks driver submissions); any other function's memory.

## Read first

- The M7a numbers in the plan's Progress section; `AGENTS.md` §1-§3; `.claude/rules/release-pipeline.md` (merging deploys Functions to the shared backend at once); `docs/APP_BRIEF.md` §13 and line 1110.

## Implementation steps

1. Confirm the M7a rule triggered and get the owner's yes. Tell them the three Russian lines (AGENTS §1).
2. At `guestApplication.js:169`, change `memory: '256MB'` to `'512MB'`; use `'1GB'` instead if M7a showed p99 ≥ 20 s or a non-zero log count (d).
3. Add a one-line comment above `.runWith`, without history, for example `// 512MB for 1/3 of a CPU: the application PDF must fit its 15 s step.`
4. No behaviour test can show CPU speed. Say in the PR that the evidence is the M7a numbers before and the repeated reading after merge. Existing tests must still pass.
5. PR **Кратко**: «Функции, которая принимает заявление водителя, дано вдвое больше памяти и процессора, чтобы PDF заявления успевал создаваться и водитель ждал меньше. Проверено автотестами; эффект проверим по графикам через неделю. Действует сразу для обоих сайтов после слияния. От вас: через неделю повторить шаги 2 и 3 из M7a.»

## Tests

- No new test. `functions/test/unit/deployedEntryPoint.test.js` (the memory floor) and the `guestApplication*.test.js` suites must pass unchanged.

## Documentation to update in the same PR

- None in the brief: it does not state this function's memory (line 1110 states only the 256MB floor). Record the M7a numbers and the chosen value in the plan's Progress section for M7a/M7c.

## Verify before opening the PR

- In `functions/`: `npm ci` if needed, then `npm run lint` and `npm test`.
- In the root: `npm run check:function-exports` and `npm run check:source-size`.
- After committing: `DEPLOY_FUNCTIONS_DRY_RUN=1 DEPLOY_GIT_BASE=$(git merge-base origin/main HEAD) DEPLOY_GIT_HEAD=HEAD node scripts/deploy-functions-incremental.mjs`; the plan must list only `submitGuestApplication`. Paste it into the PR.
- No Playwright suite applies (no browser change).

## Verify after merge (on Testing, read-only)

- Watch the `main` run through the Functions deploy, `verify-shipped` and `release-ready`.
- After 7 days the owner repeats M7a steps 2 and 3 with a 7-day range. Expect lower p95/p99, memory under about 50% of the new size, and no new "no answer within" lines. Record the numbers.

## Risks and safeguards

- The deploy replaces the function's instances: brief cold starts. A submission in flight is retried by the browser and deduplicated by its attempt id (`guestApplication.js:323-329`).
- Cost: Google bills 1st-gen functions per 100 ms by memory tier; 512MB costs about twice 256MB per 100 ms but runs faster. Negligible at our volume; check the Billing report after a week.
- Rollback: revert the PR; the changed export redeploys at 256MB. It affects both sites at once because the backend is shared.

## Done when (acceptance criteria)

- [ ] Either M7c is ticked "not needed" with the M7a numbers quoted, or all of the following hold:
- [ ] Only the `memory` value and its one-line comment changed in `guestApplication.js`, and the deploy plan listed only `submitGuestApplication`.
- [ ] Functions lint and tests passed.
- [ ] After 7 days the new p95/p99 and memory readings are recorded, and they show an improvement or the PR/progress note explains why not.
