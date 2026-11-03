# T5b. Switch Sentry off cleanly (optional)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #30 — Track real-user speed with a performance monitoring tool (follow-up: removing the old tool once T5 replaces its speed data).
- **Size:** L · **Pull requests:** 2 (PR 1: the app; PR 2: CI, the configuration registry and the configuration docs) · **Depends on:** T5, merged and showing `page_load` on Production · **Owner decision needed:**
  1. "Switching Sentry off also stops error reports from users' browsers: crashes, an application that failed to send after all retries, design-system misuse, and CSP warnings. Nothing in Firebase replaces them for a web app. Switch it off anyway?" Recommended: **only if you accept learning about browser errors from users.** Otherwise keep Sentry for errors only (a separate small task: remove tracing and Replay, keep `captureException`).
  2. "The report-only CSP will have no collector. Drop it now and plan a report endpoint only when you decide to enforce the policy?" Recommended: **yes.**
  3. Do not delete the Secret Manager secret `VITE_SENTRY_DSN` or the Sentry project until PR 2 is merged and Production has been promoted.
- **Why it matters for users:** Users would notice nothing on screen. The app downloads a little less, sends nothing to Sentry, and nothing in the code, the CI or the docs still pretends errors are being collected. The owner should know the trade-off: browser errors are no longer collected anywhere.

## Current behaviour (verified at 11626a6)

- Runtime files that use Sentry:
  - `src/lib/monitoring/sentry.js` (init, `whenIdle`, deferred attach) and `deferredIntegrations.js:11`;
  - `cspViolations.js:16,51-58`;
  - `src/app/startup/startupGuards.jsx`: imports at :19-21, init and capture on the startup error screen at :27-32, the CSP listener at :35, header bullets at :12-13;
  - `src/shared/components/feedback/ErrorBoundary.jsx:3,31` (header comment :10; the `console.error` at :30 stays) and `FeatureErrorBoundary.jsx:3,33-40` (header comment :13);
  - `src/hooks/useSubmissionQueue.js`: import :15; breadcrumbs :96-101, :157-162, :188-193; `captureMessage` :231-233; `captureException` :240 (the `console.error` at :238 stays);
  - `src/design-system/contract.js`: header :5-10, import :14, capture :24-28 (the `console.error` at :23 stays);
  - `src/features/driver-app/components/application/publicApplySubmit.js`: import :12; breadcrumbs :208-215, :339-346; final capture :406-409;
  - `src/main.jsx:8,14-19`.
- `whenIdle` lives in `sentry.js:62-68` and is used by:
  - `main.jsx` (the T5 call included);
  - `src/features/company-admin/views/CompanyCandidatesListPage.jsx:8,39`;
  - the mock in `CompanyCandidatesListPage.dossier.test.jsx:46` (`vi.mock('@lib/monitoring/sentry', () => ({ whenIdle: () => {} }))`).
- `scrub()` (`src/shared/utils/scrub.js`) has one runtime importer, `sentry.js:29`, plus its own test `src/tests/scrub.test.js`; it becomes dead code.
- Tests: 21 files reference `@sentry/react`. 20 mock it with `vi.mock('@sentry/react', …)`, and `cspViolations.sentry.test.js` uses the real SDK.
  - After deleting `sentry.test.js`, `cspViolations.test.js` and `cspViolations.sentry.test.js`, 18 files keep a mock to remove: `startupGuards.test.jsx:24`, `contract.test.js:13`, `productionFallbacks.test.jsx:13`, `CrashAndQueueSurfaces.contract.test.jsx:21`, three `useSubmissionQueue.*.test.js` and eleven `PublicApplyHandler.*.contract.test.jsx`.
  - The eleven use the helper `sentryMock` in `PublicApplyHandler.contract.support.jsx:210`.
  - Assertions on Sentry calls: `contract.test.js:34-61`, `productionFallbacks.test.jsx:37-48`, and `startupGuards.test.jsx:14-25` (mocks), `:39-45` (the CSP listener test) and `:47-70` (startup error capture).
- Build and guards:
  - `package.json:56` (`@sentry/react`; the lockfile holds nine `node_modules/@sentry/*` entries plus a nested web-vitals 6.2.3, `package-lock.json:5167-5280`);
  - `vite.config.js:21-22,69-72,106-107` (`__SENTRY_DEBUG__` define and comments);
  - `scripts/check-bundle-budget.mjs:5-8,43-45` (markers `rrweb`, `auto.pageload.browser`, `Sentry Logger`);
  - `scripts/test-bundle-budget.mjs:86-90` (B5 uses the literal `rrweb`);
  - `src/tests/viteBuildConfig.test.js:24-27`.
- CSP: `firebase.json:47,85` list `https://*.ingest.sentry.io https://*.ingest.us.sentry.io`; `src/tests/hostingConfig.test.js:283` expects a Sentry host. The comment at `:295` credits `worker-src blob:` to Replay, but tesseract.js also uses a blob worker by default (`node_modules/tesseract.js/src/constants/defaultOptions.js:9`; `src/features/company-admin/applicationPrep/extraction/ocrFallback.js:36-37`), so `blob:` must stay.
- CI: `.github/workflows/main.yml:948` loads `VITE_SENTRY_DSN` from Secret Manager and `:958` passes it to the build; `:466` and `:549` set it empty for test jobs. Deleting the secret before PR 2 would fail the deploy step at `:941-948`.
- Registry and Super Admin:
  - `functions/environmentVault/registry/entries-browser.js:41-58` (DSN and sample-rate entries);
  - `:92-98` (`VITE_RELEASE_SHA`, labelled "Sentry" with consumer `src/main.jsx`, but also read by `src/app/startup/staleBuildReload.js:46` and, after T5, by `src/app/startup/speedMonitoring.js`);
  - `src/features/super-admin/config/browserVisibleEnvironment.js:42-43`;
  - `functions/test/unit/environmentRegistry.inventory.test.js:132-153` checks both directions: every referenced key is registered, and every registered key is mentioned somewhere.
- Documents and config text that rely on Sentry:
  - `docs/APP_BRIEF.md:948` (§7 row), `:1169-1175` (§10: CSP violations go to Sentry), `:1240` (§11: contract misuse reported to Sentry), `:1469` (§13 list);
  - `docs/security-posture.md:245-263`;
  - `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md:429`; `src/design-system/README.md:165`; `src/design-system/patterns/modal/README.md:37`;
  - `docs/environment-and-integrations-runbook.md:44-45` (counts 54 and 16), `:67`, `:99-101`;
  - `README.md:91,112,222-223,229`; `.env.example:23-26`.
  - These still read true and stay: `docs/security-posture.md:182`, `docs/environment-and-integrations-runbook.md:371`, and the comments at `src/features/super-admin/hooks/useRevealedCredential.js:29` and `useRevealedValue.js:29` (each says a value is never written to a Sentry breadcrumb).

## Scope

- In:
  - Remove every Sentry call and the `@sentry/react` dependency; keep a `console.error` wherever an error was captured.
  - Move `whenIdle`; remove the CSP collector (decision 2), the Sentry CSP origins and the dead `scrub` module.
  - Lower the bundle ceilings to the new measurement.
  - Remove the DSN from CI and from the registry; update the docs.
- Out (do not do in this task):
  - A replacement error collector or CSP report endpoint (each a separate task, if wanted).
  - Enforcing the CSP; removing `blob:` from `worker-src`; changing T5's speed monitoring.
  - Deleting the Secret Manager secret or the Sentry project: those are owner actions after Production promotion.

## Read first

- `AGENTS.md` §1, §3 ("move every use"), §4, §7; `.claude/skills/implement/SKILL.md`.
- `.claude/rules/release-pipeline.md` (PR 1 edits `firebase.json`, PR 2 edits `main.yml`), `.claude/rules/testing.md`, `.claude/rules/source-size.md`.
- `.claude/rules/ui.md`, `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` (the `contract.js` behaviour row at :429) and `src/design-system/README.md`; nothing visual changes.
- `docs/APP_BRIEF.md` §7, §10, §11, §13; `docs/security-posture.md:236-263`; `docs/environment-and-integrations-runbook.md` §1-§2.

## Implementation steps

PR 1 — the app:
1. Tell the owner, in Russian and at most three lines: "Отключаю Sentry в приложении: ошибки у пользователей больше никуда не отправляются, видны только если о них сообщат. Скорость продолжает измерять Firebase. Данные, правила и вид сайта не меняются."
2. Before any edit, run `npm run build && npm run check:bundle-budget` on the base commit and note both measured numbers.
3. Move `whenIdle` to the new `src/lib/runtime/whenIdle.js`, with its tests moved from `sentry.test.js:71-103` into `src/lib/runtime/whenIdle.test.js`. Update `main.jsx`, `CompanyCandidatesListPage.jsx:8`, and the mock in `CompanyCandidatesListPage.dossier.test.jsx:46` (now `vi.mock('@lib/runtime/whenIdle', () => ({ whenIdle: () => {} }))`).
4. Update the tests first:
   - `contract.test.js:34-61` and `productionFallbacks.test.jsx:37-48`: assert `console.error` once per message (spy) instead of `captureException`.
   - `startupGuards.test.jsx`: remove the `initSentry`, `captureException` and `reportCspViolations` mocks and their `vi.mock` lines (:14-25). Delete the CSP listener test (:39-45, decision 2). In :47-70, assert that the startup screen renders and that `console.error` receives the failure once.
   - Delete the `vi.mock('@sentry/react', …)` lines from the 18 files, and `sentryMock` from `PublicApplyHandler.contract.support.jsx:210`.
   - Delete `sentry.test.js`, `cspViolations.test.js` and `cspViolations.sentry.test.js` (decision 2), and `src/tests/scrub.test.js` with `scrub.js` (step 5).
   - Add `src/tests/noSentry.test.js`. It asserts that no file under `src/` other than itself contains `from '@sentry/`, `import('@sentry/` or `vi.mock('@sentry/`, and that `package.json` has no `@sentry/` dependency. It fails until steps 5-6 are complete.
5. Runtime edits:
   - `ErrorBoundary.jsx`: remove lines 3 and 31 and fix the comment at :10.
   - `FeatureErrorBoundary.jsx`: remove the import (:3), replace :34-40 with `console.error('[feature boundary]', this.props.featureName || 'unknown', error, errorInfo)`, and fix the comment at :13.
   - `contract.js`: remove the import and the capture; the existing `console.error` (:23) keeps one log per message; fix the header (:5-10).
   - `useSubmissionQueue.js`: remove the import, the three breadcrumbs and the `captureMessage` block; remove the `captureException` at :240 (the `console.error` at :238 already logs it).
   - `publicApplySubmit.js`: remove the import and both breadcrumbs, and turn the final capture (:406-409) into `console.error('[guest application] submission failed', lastError, { stage: 'submission_failed', applicationId, companyId: company.id, queueId })`.
   - `startupGuards.jsx`: remove `initSentry`, `Sentry`, `reportCspViolations` and their header bullets. `showStartupError` logs the error with `console.error` and renders the screen.
   - Delete `src/lib/monitoring/sentry.js`, `deferredIntegrations.js`, `cspViolations.js` and `src/shared/utils/scrub.js`. In `main.jsx`, keep only `whenIdle(() => { startSpeedMonitoring(); });` and fix the comment.
6. `npm uninstall @sentry/react`; confirm `package-lock.json` holds no `@sentry/` package, and that the top-level `node_modules/web-vitals` stays 4.2.4.
7. `vite.config.js`: remove the `define` at :69-72 and fix the comments at :21-22 and :106-107.
8. Bundle guards:
   - `check-bundle-budget.mjs`: remove the three Sentry markers (:43-45) and fix the header (:5-8).
   - `test-bundle-budget.mjs:86-90`: point B5 at a marker that still exists (`fireperf`), or delete it, since the B5b loop covers every marker.
   - Run `npm run build`, then lower `FIRST_DOWNLOAD_GZIP_CEILING` (:31-32) and `APPLY_PAGE_CEILING` (:65) to the new measurements +3%, updating the "measured" numbers in their comments. The rule is "move it DOWN".
   - `viteBuildConfig.test.js:24-27`: drop the `@sentry/core` id and update the comment.
9. `firebase.json:47,85`: remove both Sentry origins, byte-identically in both targets; keep `worker-src 'self' blob:`. In `hostingConfig.test.js`, remove the Sentry URL (:283), add an assertion that `connect-src` names no `sentry.io` host, and change the comment at :295 to "tesseract.js runs in a blob worker".
10. Docs for PR 1 (below), including `README.md:91,112`. Then open PR 1. It must say that Production keeps the old Sentry bundle until it is promoted (AGENTS.md §3). Draft **Кратко**: "Sentry отключён в приложении; ошибки у пользователей больше никуда не отправляются. Скорость по-прежнему видна в Firebase. Проверено: тесты, сборка, первая загрузка стала меньше. От вас: ничего до выпуска; ключ и проект Sentry не удаляйте до второго изменения и выпуска."

PR 2 — CI, registry and configuration docs, after PR 1 is merged:
11. `main.yml`: remove `VITE_SENTRY_DSN` at :948, :958, :466 and :549. Run `npm run check:ci-plan`.
12. `functions/environmentVault/registry/entries-browser.js`: delete the entries at :41-58. Re-label `VITE_RELEASE_SHA` (:92-98): integration `SafeHaul platform`; description "Commit the bundle was built from; compared with /release.json to reload a tab a release replaced, and sent as the release of each speed trace"; consumers `['src/app/startup/staleBuildReload.js', 'src/app/startup/speedMonitoring.js']`. Run `npm test` and `npm run lint` in `functions/` (the inventory test must stay green in both directions).
13. `src/features/super-admin/config/browserVisibleEnvironment.js:42-43`: remove both keys. Its test (`browserVisibleEnvironment.test.js:52-56`) must pass.
14. `docs/environment-and-integrations-runbook.md`: the counts at :44-45 (54 → 52, 16 → 14), the sentence at :67, and the rows at :99-101 (delete the two Sentry rows; re-label `VITE_RELEASE_SHA` to "SafeHaul platform"). Also `README.md:222-223,229` and `.env.example:23-26`.
15. Open PR 2. Draft **Кратко**: "Сборка больше не берёт ключ Sentry. Проверено: проверки CI-конвейера и серверные тесты. От вас: после выпуска на настоящий сайт можно удалить секрет VITE_SENTRY_DSN в Google Secret Manager и закрыть проект в Sentry." After the merge, watch the `main` run to `release-ready` (release-pipeline rule 5); the registry change redeploys the environment-vault Cloud Functions.

## Tests

- `src/tests/noSentry.test.js`, new: **fails before** PR 1's removal, passes after.
- `src/lib/runtime/whenIdle.test.js`: the moved cases (`sentry.test.js:71-103`) pass unchanged.
- `contract.test.js`, `productionFallbacks.test.jsx`, `startupGuards.test.jsx`: the new console-based assertions.
- All 18 previously mocking files and `CompanyCandidatesListPage.dossier.test.jsx` pass without the Sentry mocks.
- `hostingConfig.test.js`: no Sentry host allowed; both targets identical.
- `test-bundle-budget.mjs` passes with the new ceilings and markers.
- PR 2: `functions` unit tests (`environmentRegistry.inventory.test.js` included), `browserVisibleEnvironment.test.js`, `npm run check:ci-plan`.

## Documentation to update in the same PR

- PR 1, `docs/APP_BRIEF.md` (net zero or fewer lines and bytes):
  - §7: delete the Sentry row (:948).
  - §10 (:1169-1175): "violations go to Sentry" → "no collector at present; enforcing the policy first needs a report collector (separate change)".
  - §11 (:1240): "reports it to Sentry" → "logs it to the console".
  - §13 (:1469-1473): drop "tracing, Replay" and update the kB figures.
  - §12: one line, "Browser errors are not collected; users must report them."
- PR 1, other docs:
  - `docs/security-posture.md:245-263`: collector removed, enforcement criterion rewritten, Sentry dropped from the service list.
  - `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md:429`, `src/design-system/README.md:165` and `src/design-system/patterns/modal/README.md:37`: "to the console" (ui.md rule 4).
  - `README.md:91,112`.
- PR 2: `docs/environment-and-integrations-runbook.md`, `README.md:222-223,229` and `.env.example`, as in step 14.
- OWNER_GUIDE: none, unless the owner wants the "report errors to the agent" line under "Если что-то сломалось" extended. Keep it at 80 lines or fewer.

## Verify before opening the PR

- PR 1:
  - `npm run lint:frontend`; `npm run typecheck`; `npm run test:coverage` (all of it, because 22 test files change).
  - `npm run build`, `npm run check:bundle-budget`, `npm run test:bundle-budget`, `npm run check:source-size`, `npm run check:agent-docs`, `npm run check:ci-plan` (`firebase.json` is in the release-pipeline rule's paths).
  - Playwright, one at a time, with port 5000 free: `npm run test:e2e -- --project=chromium e2e/login.spec.cjs`, then `e2e/public-application.spec.cjs`, `e2e/guest-offline-queue.spec.cjs` (queue capture paths), `e2e/verification-portal-closeout.spec.cjs`.
  - `npm run test:stories`: `contract.js` is design-system code; nothing renders differently.
- PR 2: `npm run check:ci-plan`; in `functions/`, `npm run lint` and `npm test`; `npx vitest run src/features/super-admin/config`.

## Verify after merge (on Testing, read-only)

- PR 1: one GET, `curl -sI https://truckerapp-system.web.app/login | grep -i report-only`; the header contains no `sentry.io`.
- Owner, in Sentry: no new events come from `truckerapp-system.web.app` after the merge time. Production keeps sending until it is promoted, which is expected.
- Owner, in Firebase console: `page_load` with `site = testing` keeps arriving (T5 still works without Sentry).
- PR 2: the `main` run reaches `release-ready`; the deploy step no longer reads `VITE_SENTRY_DSN`.
- After the owner promotes: no new Sentry events at all. Only then may the owner delete the secret and the Sentry project.

## Risks and safeguards

- Invisible browser errors. This is the owner's accepted trade-off (decision 1) and is written in §12. The `console.error` calls keep a trace in the browser console for support sessions.
- The deploy breaking. Deleting the secret before PR 2 fails `main.yml:941-948`; decision 3 and the PR text forbid that order.
- The startup error screen breaking. `startupGuards.test.jsx` keeps the screen rendering without Sentry.
- `blob:` removed by mistake would break OCR once the CSP is enforced; the test comment and the step state why it stays.
- Half-done removal. `noSentry.test.js` fails if any import, mock or the dependency remains. The registry inventory test catches a registry entry left behind or removed too early. Production keeps the old Sentry bundle until it is promoted, which the PR states (AGENTS.md §3).
- Coverage ratchet. Deleting tested files shifts the totals slightly; read the real `test:coverage` result and never lower a threshold.
- Rollback: revert PR 2, then PR 1 (Testing redeploys); Super Admin → Releases → "Roll back to previous release" if Production was promoted. Do not delete the secret until both PRs are released.

## Done when (acceptance criteria)

- [ ] The owner answered decisions 1-3, and the PRs record the answers.
- [ ] No `@sentry/` import or mock in `src/`, no `@sentry/` package in `package.json` or `package-lock.json`, and no Sentry origin in either CSP target.
- [ ] `whenIdle` lives in `src/lib/runtime/whenIdle.js`, and all three of its users (`main.jsx`, `CompanyCandidatesListPage.jsx`, its dossier test mock) are updated.
- [ ] Every former capture site still logs to the console; the error boundaries and the startup error screen still render.
- [ ] `scrub.js` and its test are gone, with nothing importing them.
- [ ] The bundle ceilings are lowered to the new measurement +3%, and the Sentry markers are gone.
- [ ] CI, the registry, `browserVisibleEnvironment.js`, README and `.env.example` no longer mention `VITE_SENTRY_DSN` or `VITE_SENTRY_TRACES_SAMPLE_RATE`; `VITE_RELEASE_SHA` is re-labelled with both consumers.
- [ ] APP_BRIEF (no net growth), security-posture, the roadmap row, both design-system READMEs and the environment runbook are true.
- [ ] All listed checks and Playwright suites passed, or each is named as not run; both `main` runs reached `release-ready`.
