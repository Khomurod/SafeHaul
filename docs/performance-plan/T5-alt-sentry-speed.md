# T5-alt. Keep Sentry as the speed tool: name page loads by route, tag the site, remove tokens (Option B)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #30 — Track real-user speed with a performance monitoring tool.
- **Size:** M · **Pull requests:** 1 · **Depends on:** none (mutually exclusive with T5 and T5b) · **Owner decision needed:** "Do this only if Sentry stays (answer B in T5)." Recommended: **no** (choose A). If B: first check Sentry → Explore → Traces (last 7 days) for spans named `Pageload`. If there are none, speed data is not arriving, and the agent must find out why before continuing.
- **Why it matters for users:** Sentry already measures page speed for one load in five, but every page load lands in a single group called "Pageload". So nobody can see whether the driver's application page or the signing page is slow. Testing and Production traffic are also mixed together, and links with secret tokens reach Sentry in plain text. This task makes the data readable per page and per site, and safe.

## Current behaviour (verified at 11626a6)

- Tracing is attached once the page is idle, with no options: `src/lib/monitoring/sentry.js:84-91`, `deferredIntegrations.js:11`. `Sentry.init` sets no `environment`, no `traceLifecycle` and no `beforeSendSpan` (`sentry.js:35-53`). `initSentry` is called from two places: `src/main.jsx:18` and the startup error screen (`src/app/startup/startupGuards.jsx:29`).
- **Correction to the item-30 finding.** `@sentry/core` 11.8.0 defaults `traceLifecycle` to `"stream"` (`node_modules/@sentry/core/build/esm/client.js:95-100`). With streaming on, `node_modules/@sentry/browser/build/npm/esm/prod/tracing/browserTracingIntegration.js:268` names every page load `Pageload` and `:290` every navigation `Navigation` (`@sentry/core/build/esm/tracing/spans/spanNames.js:3-4`); the pathname is not used. So all page loads fall into one group, and the route survives only in the raw `url.path` attribute.
- The raw path is still sent:
  - `url.path` and `url.full` on route spans (`browserTracingIntegration.js:72-84`). `beforeStartSpan` is applied at `:75`, before these attributes are added.
  - **The scope's transaction name.** For a fallback span name, `startBrowserTracingPageLoadSpan` sets it to the raw `location.pathname` (`:345-346`); navigations do the same (`:366-368`). It is set from the original span options, so a `beforeStartSpan` rename does not change it, and every error event then carries `transaction: "/verify/<token>"`.
  - `url.full` and the `Referer` header on segment spans (`prod/integrations/httpcontext.js:25-49`); the header is governed by `dataCollection.httpHeaders`, not by `urlQueryParams`.
  - `request.url` on error events (`httpcontext.js:8-24`).
- Queries are filtered only by the default deny-list: `dataCollection.urlQueryParams` defaults to `true` (`@sentry/core/build/esm/utils/data-collection/resolveDataCollectionOptions.js:6`; `filtering-snippets.js`: `token`, `key`, …). So `?token=` is masked, but `?invite=` and `?k=` (`publicApplyInvite.js:144,154`) are sent. Breadcrumb URLs pass the same filter (`prod/integrations/breadcrumbs.js:113,153,163,205-206`).
- `beforeSendTransaction` does nothing in v11: it is ignored under streaming (`@sentry/core/build/esm/utils/warnAboutIgnoredTransactionOptions.js:3-12`; Context7 `/getsentry/sentry-javascript/11.6.0` MIGRATION.md: "no transaction events are produced"). Streamed spans run a plain, unwrapped `beforeSendSpan` (`tracing/spans/captureSpan.js:28-33`); one wrapped with `withStaticSpan` is skipped. None is set, so `scrub()` never sees a span.
- `scrub()` masks only SSN, email and phone patterns and keys named like `token` (`src/shared/utils/scrub.js:11-27`). It deep-walks every string of the object it is given (`:30-48`), but never touches URL paths. Only CSP reports strip page context (`cspViolations.js:40-45`). The repository's own test notes that the token reaches Sentry otherwise (`cspViolations.sentry.test.js:4-7`).
- `environment` is unset, so both hosts report as `production` (`@sentry/core/build/esm/constants.js:1`). Production is a cloned Testing build (`promote-production.yml:148`), so the environment must be decided from the hostname at runtime.
- The sample rate is 0.2 in production builds (`sentry.js:31-34`); CI passes no override (`main.yml:954-960`).
- Session Replay recordings carry the page address in rrweb Meta events (`node_modules/@sentry/replay/build/npm/esm/index.js:4312-4317`) and in navigation entries (`:6238-6247`). Neither `beforeSend` nor `beforeSendSpan` reaches them; only `beforeAddRecordingEvent` does (`:5853`).
- **Type-check boundary.** `src/lib/**/*.js` is type-checked (`jsconfig.json:3,27-32`). Importing `src/app/routes/appRouteManifest.js` from `sentry.js` would pull in `src/app/auth/roles.js`, which fails `tsc` with three errors (verified with a scratch config). So the route-aware pieces live under `src/app/`, and the app-layer callers pass them to `sentry.js`.
- `src/lib/monitoring/sentry.test.js:38-41` asserts the exact `dataCollection` object with `toEqual`.

## Scope

- In:
  - Name page-load and navigation spans by route pattern.
  - Set `environment` from the hostname.
  - Drop every URL query and the `Referer` header from what the SDK collects.
  - Replace secret path segments in error events, breadcrumbs, the transaction name and spans.
  - Add a test with the real SDK.
- Out (do not do in this task):
  - Session Replay recording payloads (follow-up; see open questions).
  - The sample rate and `VITE_SENTRY_TRACES_SAMPLE_RATE` wiring.
  - Sentry's React Router integration (it needs `App.jsx` changes; the manifests are enough).
  - Firebase Performance; CSP (no new origin); the types in `roles.js`.

## Read first

- `AGENTS.md` §1, §3, §4, §7; `.claude/skills/implement/SKILL.md`; `.claude/rules/testing.md`; `.claude/rules/source-size.md`.
- `docs/APP_BRIEF.md` §7 Sentry row (line 948) and §10 CSP bullet (1169-1175); `docs/security-posture.md:245-263`.
- `jsconfig.json`; `src/lib/monitoring/sentry.js`, `cspViolations.js`, `cspViolations.sentry.test.js` (the real-SDK test pattern to reuse), `src/shared/utils/scrub.js`, `src/app/startup/startupGuards.jsx`.
- Context7 `/getsentry/sentry-javascript/11.6.0` (MIGRATION.md: `beforeSendSpan`, `ignoreSpans`, streamed spans). If the quota is exhausted, say so and cite `node_modules/@sentry/*` instead.

## Implementation steps

1. Tell the owner, in Russian and at most three lines: "Отчёты Sentry о скорости будут разделены по страницам и по сайту (тестовый/настоящий), из адресов уберу секретные ключи ссылок. Замедленную запись сессий (Replay), данные и правила не трогаю."
2. Write the failing test first. New `src/lib/monitoring/sentry.privacy.test.js`, using the real SDK as `cspViolations.sentry.test.js` does:
   - Set the URL with `window.happyDOM.setURL('https://app.safehaul.io/verify/<LINK>?invite=<INV>&k=<KEY>')`.
   - Set `document.referrer` with `Object.defineProperty(document, 'referrer', { value: 'https://app.safehaul.io/apply/acme?invite=<INV>', configurable: true })`.
   - Call `initSentry({ PROD: true, VITE_SENTRY_DSN: 'https://public@o1.ingest.us.sentry.io/1' }, monitoringContext())`.
   - Replace the transport with `vi.spyOn(Sentry.getClient().getTransport(), 'send').mockResolvedValue({})`, collecting the envelopes. `mockResolvedValue` is what keeps the network out.
   - Add a navigation breadcrumb, call `Sentry.getCurrentScope().setTransactionName('/verify/<LINK>')`, capture an exception, run `Sentry.startSpan({ name: 'x', op: 'pageload' }, () => {})`, then `await Sentry.flush(2000)`.
   - Assert that `JSON.stringify` of every envelope contains none of `<LINK>`, `<INV>`, `<KEY>`.
   - Close the client in `afterEach`, as the existing test does.
   - It **fails today**: `request.url` and `transaction` carry `/verify/<LINK>`.
3. Create `src/app/routes/routePattern.js` and `src/app/startup/site.js` exactly as in T5 steps 5-6, with the same tests. Add to `routePattern.js` `redactSecretPaths(text)`:
   - For every secret pattern, replace `/<static prefix>/<one segment>` anywhere in a string with the pattern (`/verify/:token`, `/review-change/:token`).
   - Build the regexes from the pattern list, case-insensitive, without lookbehind, which breaks iOS Safari < 16.4 (`scrub.js:15-18`).
   - Return non-strings unchanged, and never throw.
4. New `src/app/startup/monitoringContext.js` (app layer; it imports no `@lib/firebase`, so `startupGuards.jsx` may import it):
   - `const LANDING_PATH = globalThis.location?.pathname ?? '/'` at module top. `startupGuards.jsx` is the first import of `main.jsx`, so this runs before any redirect.
   - `export function monitoringContext({ loc = globalThis.location } = {})` returns `{ environment: siteOf(loc.hostname) ?? 'development', redact: redactSecretPaths, nameRoute: (op) => routePatternOf(op === 'pageload' ? LANDING_PATH : loc.pathname) }`.
5. `src/shared/utils/scrub.js`: add an optional second argument `{ mapString }`, applied after `scrubString` inside `scrubValue`. Without it, behaviour is unchanged.
6. `src/lib/monitoring/sentry.js` (it imports nothing from `@app/…`):
   - `initSentry(env = import.meta.env, { environment, redact } = {})` sets:
     - `environment` (omitted when undefined);
     - `dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, httpHeaders: { request: { deny: ['referer'] }, response: true } }` (the deny form is read by `filterKeyValueData.js:6-21`);
     - `const clean = (v) => scrub(v, redact ? { mapString: redact } : undefined)`, used by `beforeSend` and `beforeBreadcrumb`;
     - `beforeSendSpan: clean`, as a **plain function**. Never wrap it in `Sentry.withStaticSpan`, which streaming ignores (`client.js:114-121`). It rewrites spans and cannot drop them.
   - Do not set `traceLifecycle` and do not add `beforeSendTransaction`.
   - `attachDeferredIntegrations({ load, nameRoute } = {})`: `lazy.browserTracingIntegration(nameRoute ? { beforeStartSpan: (o) => ({ ...o, name: nameRoute(o.op) }) } : undefined)`. Tracing attaches after idle, so without the landing path the page load would carry the name of a redirect target.
   - Rewrite header point 3 (lines 20-26) to describe naming, environment and redaction. Keep the file under 150 lines.
7. Callers:
   - `src/main.jsx:18-19`: `const context = monitoringContext(); initSentry(undefined, context); whenIdle(() => { attachDeferredIntegrations({ nameRoute: context.nameRoute }); });`.
   - `src/app/startup/startupGuards.jsx:29`: `initSentry(undefined, monitoringContext());`, so the startup error screen reports with the same environment and redaction.
   - Update `startupGuards.test.jsx:60` (`initSentry` is now called with two arguments; keep `toHaveBeenCalledTimes(1)`).
8. `src/lib/monitoring/sentry.test.js`: update the option assertions (:19-29) and the exact `dataCollection` assertion (:38-41), and add the cases listed under Tests.
9. Update the docs listed below.
10. Open the PR. Draft **Кратко**: "В Sentry скорость теперь видна по каждой странице и отдельно для тестового и настоящего сайта; из ошибок и отчётов убраны секретные части ссылок. Проверено: тесты на настоящем Sentry SDK, сборка. Риск низкий; старые фильтры в Sentry по environment могут показывать меньше. От вас: после выпуска выбрать в Sentry фильтр environment."

## Tests

- `src/lib/monitoring/sentry.privacy.test.js`, new: **fails before**, passes after.
- `src/lib/monitoring/sentry.test.js`:
  - `environment` is passed through, and omitted when not given.
  - `urlQueryParams === false`; the referer deny-list is set.
  - `beforeSendSpan` has no `_static` property and redacts `url.path` `/verify/abc` to `/verify/:token` when `redact` is given.
  - `browserTracingIntegration` receives `beforeStartSpan` only when `nameRoute` is given, and it names the span by `nameRoute(op)`.
- `src/app/startup/monitoringContext.test.js`, new:
  - `environment` is `production` for `app.safehaul.io`, `testing` for `truckerapp-system.web.app`, and `development` for `localhost`.
  - `nameRoute('pageload')` uses the landing path; `nameRoute('navigation')` uses the current path.
- `src/app/routes/routePattern.test.js`, as in T5, plus `redactSecretPaths`: token segments are replaced inside full URLs, relative paths and free text; other paths are unchanged; non-strings pass through; nothing throws.
- `src/tests/scrub.test.js`: `mapString` is applied; the existing cases are unchanged.
- `src/app/startup/site.test.js` as in T5. `startupGuards.test.jsx` stays green with the new call.
- `cspViolations.sentry.test.js` and `cspViolations.test.js`: unchanged, and must pass.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md`. It is over its warning limit, so keep its line and byte counts at or below the base commit by tightening the touched text:
  - §7 Sentry row (line 948), in the same line: "speed: page loads by route pattern; `environment` testing or production by host; URL queries, Referer and token path segments removed".
  - §12: one line, "Session Replay recordings still carry the page address".
- `docs/security-posture.md` after line 256: one sentence saying every Sentry event and span drops URL queries, the Referer and token path segments, not only CSP reports.
- OWNER_GUIDE: none (no new owner step).

## Verify before opening the PR

- `npm run lint:frontend`; `npm run typecheck` (must pass; it proves `sentry.js` imports nothing from `@app`).
- `npx vitest run src/lib/monitoring src/app/routes src/app/startup src/tests/scrub.test.js`; then `npm run test:coverage`.
- `npm run build`, `npm run check:bundle-budget` (the first download may grow by at most 1,000 bytes gzip against a build of the base commit; record both numbers), `npm run test:bundle-budget`, `npm run check:source-size`, `npm run check:agent-docs`.
- Playwright, one at a time, with port 5000 free: `npm run test:e2e -- --project=chromium e2e/login.spec.cjs`, then `e2e/verification-portal-closeout.spec.cjs`, then `e2e/public-application.spec.cjs`. The DSN is empty in E2E (`main.yml:466,549`), so these prove only that startup still works.

## Verify after merge (on Testing, read-only)

- Watch the `main` run through `verify-shipped` and `release-ready`.
- Owner, in Sentry:
  - Explore → Traces, filter `environment:testing`. Span names should read `/login`, `/apply/:slug`, `/company/dashboard`… instead of `Pageload`.
  - Search span attributes and issue transactions for `verify/`: only `/verify/:token` may appear.
  - Issues, filter `environment:testing`: new errors from Testing are listed there and no longer under `production`.
- After promotion, the same checks with `environment:production`. Saved searches that assume everything is `production` may need updating.

## Risks and safeguards

- A redaction bug could drop telemetry or leak data. `scrub` never throws (`scrub.js:55-60`). A throwing `beforeSendSpan` makes the SDK send the span unmodified (`tracing/spans/beforeSendSpan.js:15-21`), so `redactSecretPaths` has a no-throw test.
- Stream mode. `beforeSendTransaction` would be silently ignored; the test asserts `beforeSendSpan` is a plain function.
- The transaction name leaking despite `beforeStartSpan`. It is set from the raw path (`:345-346`); the redaction in `beforeSend` (deep string walk) removes it, and the privacy test sets it explicitly.
- `npm run typecheck` breaking if `sentry.js` imported the route code; the plan passes it in from `src/app/`.
- Name cardinality. Route patterns are a fixed set, so streamed span names stay low-cardinality, as the SDK requires.
- Replay still leaks. This is listed as a known limitation and as an open question; the PR does not claim Replay is clean.
- Rollback: revert the PR. Production changes only on promotion.

## Done when (acceptance criteria)

- [ ] The owner chose B, and the PR says so.
- [ ] Page-load and navigation spans are named by route pattern; `environment` is `testing` or `production` by host, on both `initSentry` call sites.
- [ ] The real-SDK test shows no token, invite or applicant key in any error, breadcrumb, transaction name, Referer or span envelope.
- [ ] `beforeSendSpan` is a plain function; `urlQueryParams: false`; the Referer is denied.
- [ ] No file under `src/lib` imports `@app/…`; `npm run typecheck` passes.
- [ ] Lint, typecheck, `test:coverage`, build, bundle checks, source-size, agent-docs and the three Playwright suites passed, or each is named as not run.
- [ ] The APP_BRIEF §7 and §12 lines (no net growth) and the security-posture sentence are updated.
- [ ] After merge, the owner sees route-named spans under `environment:testing` in Sentry.
