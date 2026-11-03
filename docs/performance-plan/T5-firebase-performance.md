# T5. Measure real-user speed with Firebase Performance Monitoring (Option A)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #30 — Track real-user speed with a performance monitoring tool. (#18, OpenTelemetry, is context only and is not planned.)
- **Size:** M · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** "Which tool measures speed for real users? A) Firebase Performance Monitoring (this task; T5b later if Sentry goes). B) Keep Sentry (do T5-alt instead; skip T5 and T5b)." Recommended: **A**. You plan to switch Sentry off; Firebase Performance is free, sits in the same Firebase project and is already installed with `firebase`. A second, smaller question: may the signing page (`/sign/<companyId>/<requestId>`) be measured? Its address carries two internal document IDs, but never its access key. Recommended: **yes** (see open questions).
- **Why it matters for users:** Drivers open the application and signing pages on phones over mobile data. Today nobody knows how fast those pages really load for them, because lab numbers are only an estimate. This task records real load and response times for every page load and splits them by page type and by site (Testing or Production), without recording any secret link.

## Current behaviour (verified at 11626a6)

- The only real-user speed measurement is Sentry tracing, attached once the page is idle: `src/main.jsx:18-19`, `src/lib/monitoring/sentry.js:84-91`, `src/lib/monitoring/deferredIntegrations.js:11`. It samples 20% of page loads (`sentry.js:31-34,43`), and the CI build passes no `VITE_SENTRY_TRACES_SAMPLE_RATE` (`.github/workflows/main.yml:954-960`). Nobody has verified that Sentry's speed data arrives (item-30 verifier note).
- Nothing in `src/` imports `firebase/performance` or `web-vitals`. `@firebase/performance` 0.7.7 comes with `firebase` 11.10.0 (`package-lock.json:1689-1700`; `firebase/package.json` exports `./performance`) and depends on `web-vitals ^4.2.4`, installed at the top level at 4.2.4 (`package-lock.json:16843-16848`) but not a direct dependency (`package.json:55-74`). A second, unrelated copy, web-vitals 6.2.3, is nested under `@sentry/browser-utils` (`package-lock.json:5198-5203`).
- What the SDK records. Read from `node_modules/@firebase/performance/dist/esm/index.esm2017.js`; Context7 `/websites/firebase_google` confirms the documented parts (URLs kept without parameters, `instrumentationEnabled` controls automatic traces and network monitoring, custom traces allow 5 attributes, and a restricted API key must allow the Firebase Installations API and the Firebase Remote Config API).
  - The automatic page-load trace is named `_wt_` + the page URL (`:1254-1259`). That URL is `location.href` with the query cut off and the path and hash kept (`:155`), so `/verify/<token>` would become a trace name.
  - Automatic network traces record every resource-timing URL with the query cut off and the path kept (`:967-990`): Storage object paths, callable names. The SDK reads resource timing; it never patches `fetch`. With automatic traces off it still observes resource entries (`:1337-1344`) and drops them at `:873`.
  - **Every event, automatic or custom, carries `web_app_info.page_url`**, the address at the moment the event is queued (`:935-947`, line 941). `instrumentationEnabled: false` stops the automatic page-load and network traces (`:831-836`, `:870-874`). It does not keep the path out of custom traces; only not recording on such pages does.
  - Any `performance.measure()` becomes a custom trace (`:1386-1404`). No production code calls it: 0 calls in `src/`, `react-dom-client.production.js`, `react-router` or the other runtime dependencies.
  - Nothing is sent until `loggingEnabled` is true. It starts `false` (`:313`) and is set only by `processConfig` (`:567-581`), from a POST to `https://firebaseremoteconfig.googleapis.com` (`:529-560`, URL at `:535`) or from the SDK's 12-hour copy in localStorage (`:486-492`, keys at `:45-46`).
  - Endpoints: `https://firebaseinstallations.googleapis.com` (`node_modules/@firebase/installations/dist/esm/index.esm2017.js:28`), `https://firebaseremoteconfig.googleapis.com` (`:535`), and `https://firebaselogging-pa.googleapis.com`. The last is assembled by `mergeStrings` at `:321` and sent with `navigator.sendBeacon`, or `fetch` as a fallback (`:763-772`).
  - Queued events leave on a timer: first after 5.5 s, then every 10 s (`:703-728`). The only immediate send is the SDK's once-per-page flush after the first `visibilitychange` to hidden or `pagehide` (`:1345-1358`). `sendOobTrace` defers it with `setTimeout(…, 0)` (`:1406-1417`), and `createOobTrace` then calls `flushLogs()` (`:1289-1290`) even when automatic traces are off. So a trace recorded synchronously inside a listener for the same event is already queued when the flush runs.
  - `trace().record()` copies attributes without the checks `putAttribute` applies (`:1139-1141` vs `:1195-1210`), and throws when the start time or duration is not positive (`:1126-1136`).
- Addresses that carry a secret: `/verify/:token` and `/review-change/:token` (`src/app/routes/appRouteManifest.js:32-43`; links built at `functions/employmentVerification/emailTemplates.js:84` and `functions/applicationChanges.js:205`). The signing room `/sign/:companyId/:requestId` keeps its access key in `?token=` (`src/features/signing/SigningRoom.jsx:57`; link built at `src/features/signing/utils/signingRequestWrite.js:63` and `functions/notifySigner.js:16`), and the SDK cuts queries off. The apply page's invite token and applicant key are query parameters too (`src/features/driver-app/components/application/publicApplyInvite.js:144,154`). No app code rewrites the URL to hide a token (no `replaceState`/`pushState` in `src/`).
- Routes: the public and Super Admin manifests are in `src/app/routes/appRouteManifest.js:11-81`. The company workspace children are in a different file, `src/app/routes/companyRouteManifest.js:5` (`COMPANY_ROUTE_MANIFEST`, relative paths such as `drivers/applications`). `App.jsx` itself declares `/login` (:52), `/company` (:97, index redirect :107), `/company/*` (:145), `/` (:150) and `*` (:151).
- **Type-check boundary.** `npm run typecheck` checks `src/lib/**/*.js` (`jsconfig.json:3,27-32`), and every file those import. `appRouteManifest.js` imports `src/app/auth/roles.js`, which fails `tsc` with three TS2339 errors (`roles.js:22,36`). This was verified with a scratch config outside the repository, and the baseline `npm run typecheck` passes. No file under `src/lib` imports `@app/…` today. So route-aware code must live under `src/app/`, and the module in `src/lib/` must take the route check as a parameter.
- Both hosts run the same build: Production is a clone of the tested Testing version (`.github/workflows/promote-production.yml:148`). `CANONICAL_APP_HOST` is `src/app/startup/searchIndexing.js:12`; the other hosts are listed in `searchIndexing.test.js:18-23`. Testing is `truckerapp-system.web.app` and `truckerapp-system.firebaseapp.com`; Production is `app.safehaul.io` and the `safehaul-app-production` site (`.firebaserc`), which Hosting also serves at `.web.app` and `.firebaseapp.com`.
- Production reads its Firebase config from `/__/firebase/init.json` (`src/lib/firebase/config.js:79-117`), with `apiKey`, `projectId` and `appId` required (`:26-33`). The SDK needs all three (`index.esm2017.js:438-460`) and the `[DEFAULT]` app, which `config.js:130` creates.
- The report-only CSP `connect-src` lists none of the three endpoints (`firebase.json:47` and `:85`; the two strings are byte-identical today). `src/tests/hostingConfig.test.js:256-262` requires identical policies on both targets, and `:275-297` lists the services that must be allowed.
- The first download is capped at 319,000 bytes gzip (`scripts/check-bundle-budget.mjs:31-32`), and the apply page at 536,000 (`:65`). Markers for code that loads later are at `:42-49`, and every marker is driven by the B5b loop at `scripts/test-bundle-budget.mjs:92-101`. The vendor chunk takes only `STARTUP_LIBRARIES` (`vite.config.js:26-43`), pinned by `src/tests/viteBuildConfig.test.js:22-31`.
- `whenIdle` (`sentry.js:62-68`) is the existing "after load, when idle" helper, also used by `src/features/company-admin/views/CompanyCandidatesListPage.jsx:8,39`.
- `VITE_RELEASE_SHA` is set by CI (`main.yml:956`) and already registered (`functions/environmentVault/registry/entries-browser.js:92-98`); this task adds no environment variable.

## Scope

- In: load Firebase Performance Monitoring after the page is idle, with automatic traces off; record one custom `page_load` trace per page load, with Core Web Vitals as metrics and route pattern, site, release and navigation type as attributes; record nothing on token pages; add the CSP origins; add bundle guards; add a test that pins the SDK behaviour; update docs; write the owner's console steps.
- Out (do not do in this task): any Sentry change (T5b or T5-alt); network-request timing; timing of in-app navigations after the first page; a sample-rate setting; OpenTelemetry (#18); backend timing; Remote Config templates; any data migration; Firebase rules or indexes (no Firestore query is added); fixing the types in `src/app/auth/roles.js`; any UI change (so `.claude/rules/ui.md` does not apply).

## Read first

- `AGENTS.md` §1, §3, §4, §7; `.claude/skills/implement/SKILL.md`.
- `docs/APP_BRIEF.md` §3 "Startup" (lines 97-103), §7 table (936-950), §10 CSP and cache bullets (1169-1180), §13 bundle budget (1466-1473).
- `.claude/rules/testing.md`, `.claude/rules/release-pipeline.md` (its paths include `firebase.json`), `.claude/rules/source-size.md`.
- `jsconfig.json` (what `npm run typecheck` covers); `docs/security-posture.md:245-263`; the header comments of `src/lib/monitoring/sentry.js`, `src/app/startup/startupGuards.jsx`, `scripts/check-bundle-budget.mjs` and `vite.config.js:10-43`.
- Library docs: Context7 `/websites/firebase_google` (Performance Monitoring web; "API key restrictions" table). If the quota is exhausted, say so in the PR; the installed source cited above is the reference.

## Implementation steps

1. Tell the owner, in Russian and at most three lines: "Сайт начнёт измерять скорость открытия страниц у настоящих пользователей (Firebase Performance). На страницах с секретными ссылками (/verify, /review-change) ничего не записывается. Sentry, данные и правила базы не трогаю."
2. Baseline, before any edit: on the branch's base commit run `npm run build && npm run check:bundle-budget` and write down the first-download and apply-page gzip numbers it prints. They are the reference for step 15 and the PR.
3. Write the failing tests first: extend `src/tests/hostingConfig.test.js` and add the new test files listed under Tests. Run them and confirm they fail.
4. `firebase.json`: in **both** app targets (lines 47 and 85), append `https://firebaseinstallations.googleapis.com https://firebaseremoteconfig.googleapis.com https://firebaselogging-pa.googleapis.com` to `connect-src`, right after `https://us-central1-truckerapp-system.cloudfunctions.net`. Keep the two strings byte-identical.
5. New `src/app/routes/routePattern.js` (app layer, next to the manifests; it must not live under `src/lib`, see the type-check boundary above):
   - Import `matchPath` from `react-router-dom` (already in the vendor chunk); `PUBLIC_FEATURE_ROUTE_MANIFEST`, `PROTECTED_FEATURE_ROUTE_MANIFEST`, `COMPANY_WORKSPACE_ROUTE` from `./appRouteManifest`; `COMPANY_ROUTE_MANIFEST` from `./companyRouteManifest`. Never import `featureRegistry.jsx`, which pulls in the lazy screens.
   - Build one frozen list. Exact patterns first: every public manifest path, `/login`, `/`, `COMPANY_WORKSPACE_ROUTE.path` (`/company`), and each company child as `` `${COMPANY_WORKSPACE_ROUTE.path}/${route.path}` ``. Splat patterns last: the protected manifest's `/super-admin/*`, then `/company/*`.
   - `routePatternOf(pathname)` returns the first pattern for which `matchPath({ path, end: true }, pathname)` matches, else `'unmatched'`.
   - `isSecretPattern(pattern)` is true when any segment equals `':token'`.
   - `isSecretPath(pathname)` is true when `isSecretPattern(routePatternOf(pathname))`, or when the lower-cased pathname starts with the static prefix of a secret pattern followed by `/` (`/verify/`, `/review-change/`, derived from the list, not hard-coded). The prefix check covers a link such as `/verify/<token>/x`, which matches no route and would otherwise count as `unmatched`.
6. New `src/app/startup/site.js`: `siteOf(hostname)` lower-cases the host. It returns `'production'` for `CANONICAL_APP_HOST` (imported from `./searchIndexing`), `safehaul-app-production.web.app` and `safehaul-app-production.firebaseapp.com`; `'testing'` for `truckerapp-system.web.app` and `truckerapp-system.firebaseapp.com`; and `null` otherwise. Decide at runtime, because the same build is promoted.
7. New `src/app/startup/speedMonitoring.js`, static and tiny, imported by `main.jsx` (never by `startupGuards.jsx`):
   - `export const LANDING_PATH = globalThis.location?.pathname ?? '/'`, captured at module evaluation. `main.jsx` evaluates all its imports before `ReactDOM.createRoot(…).render` (line 24), so React Router has not redirected yet.
   - `export function startSpeedMonitoring({ env = import.meta.env, hostname = globalThis.location?.hostname, landingPath = LANDING_PATH, load = () => import('@lib/monitoring/pageLoadTrace') } = {})` returns `Promise<boolean>`.
   - Resolve `false` **without calling `load`** when `!env.PROD`, when `env.VITE_E2E_TEST_MODE === '1'` (same test as `src/lib/runtime/e2eMode.js:1`), when `siteOf(hostname)` is null, or when `isSecretPath(landingPath)`.
   - Otherwise return `load().then((m) => m.startPageLoadTrace({ route: routePatternOf(landingPath), site, release: String(env.VITE_RELEASE_SHA || 'unknown').slice(0, 7) }, { isSecretPath })).catch(() => false)`. It never throws, the same contract as `attachDeferredIntegrations`.
8. New `src/lib/monitoring/pageLoadTrace.js`, loaded only through step 7. It is type-checked (`jsconfig.json`), so it imports nothing from `@app/…`. Its header comment states the privacy design with the SDK line references above.
   - Imports: `initializePerformance` and `trace` from `firebase/performance`; `onCLS, onFCP, onINP, onLCP, onTTFB` from `web-vitals/attribution` (the module the SDK itself imports at its line 3, so the bundle holds one copy); `app` from `@lib/firebase/config`.
   - Export `startPageLoadTrace({ route, site, release }, { isSecretPath, doc = document, win = globalThis, perfApi = performance } = {})`, returning a boolean. It runs once per page (module-level flag) and does everything in `try/catch`, returning `false` on any error.
   - Return `false` before touching the SDK when `doc.visibilityState !== 'visible'`: a tab loaded in the background has no meaningful load time, and this avoids creating an installation for it.
   - Call `initializePerformance(app, { instrumentationEnabled: false, dataCollectionEnabled: true })`. Then register the five vitals with `{ reportAllChanges: true }`, keeping the latest `value` of each. CLS starts observing only after FCP (`node_modules/web-vitals/dist/modules/onCLS.js:52`) and LCP/INP finalise later, so `reportAllChanges` is what keeps every value current when the page is hidden.
   - Register one `finish` handler twice: `doc.addEventListener('visibilitychange', …)` (acting only when `doc.visibilityState === 'hidden'`) and `win.addEventListener('pagehide', …)`. `finish` runs once:
     - Return when `isSecretPath(win.location.pathname)`, because the SDK attaches the *current* address.
     - Read the navigation entry: `/** @type {PerformanceNavigationTiming | undefined} */ const nav = perfApi.getEntriesByType('navigation')[0]` (the cast keeps `tsc` happy). Set `duration = Math.round(nav?.loadEventEnd ?? 0)`; return unless `duration > 0`.
     - Call `trace(perf, 'page_load').record(perfApi.timeOrigin, duration, { attributes, metrics })`, synchronously inside the handler so the SDK's deferred flush (`:1406-1417`) sends it.
     - `attributes`: `route`, `site`, `release`, `nav: nav.type`. Each is `String(value).slice(0, 100)`, and empty values are dropped, because `record()` validates nothing (`:1139-1141`). The names are these four constants (≤5 allowed; no `firebase_`/`google_`/`ga_` prefix).
     - `metrics`: `lcp_ms`, `fcp_ms`, `ttfb_ms`, `inp_ms` (`Math.round`) and `cls_x1000` (`Math.round(value * 1000)`). Leave out any metric that never reported.
   - Never call `performance.mark`, `performance.measure`, `trace().start()` or `trace().stop()`.
9. `src/main.jsx`: import `startSpeedMonitoring` from `@app/startup/speedMonitoring` and change line 19 to `whenIdle(() => { attachDeferredIntegrations(); startSpeedMonitoring(); });`. Update the comment at lines 14-17. The first import must stay `import '@app/startup/startupGuards';` (`startupGuards.test.jsx:73-77`).
10. `package.json`: add `"web-vitals": "^4.2.4"` to `dependencies` with `npm install web-vitals@^4.2.4`; 4.2.4 is the locked version. Confirm in the `package-lock.json` diff that only the root `packages[""].dependencies` gains `web-vitals`. The top-level `node_modules/web-vitals` entry must stay 4.2.4; the nested `@sentry/browser-utils/node_modules/web-vitals` 6.2.3 entry is unrelated and must not change.
11. `src/tests/viteBuildConfig.test.js`, test "leaves out what loads later" (:22-31): add `nm('@firebase/performance/dist/esm/index.esm2017.js')`, `nm('@firebase/installations/dist/esm/index.esm2017.js')` and `nm('web-vitals/dist/web-vitals.attribution.js')` to the ids that must not be `vendor`. `vite.config.js` itself does not change.
12. `scripts/check-bundle-budget.mjs`, `FIRST_DOWNLOAD_MUST_NOT_CONTAIN` (:42-49), add:
    - `{ marker: 'fireperf', why: 'Firebase Performance Monitoring loads once the page is idle (src/app/startup/speedMonitoring.js)' }`;
    - `{ marker: 'firebaseinstallations.googleapis.com', why: 'Firebase Installations loads only with Performance Monitoring, after the first screen' }`.
    Update the header list (:5-8). The B5b loop in `test-bundle-budget.mjs` covers the new markers automatically.
13. Add the SDK pin test (see Tests).
14. Update the docs listed below.
15. Run everything under "Verify before opening the PR". Then open the PR. Its description starts with **Кратко**, e.g.: "Сайт измеряет, как быстро открываются страницы у настоящих пользователей; данные — в Firebase console → Performance → page_load. Проверено: тесты, сборка, первая загрузка выросла не больше чем на 1 кБ. Риск низкий: на страницах с секретными ссылками ничего не записывается, до полной загрузки страницы запросов не прибавилось. От вас: три шага в консоли (ниже)." Under "What it touches" add the three owner console steps in Russian (from Verify after merge), the baseline and new bundle numbers, and the lazy chunk's gzip size.

## Tests

- `src/tests/hostingConfig.test.js`: add the three endpoint URLs to the list in "allows the Firebase services the app talks to" (:276-287). **Fails before step 4.** "ships the same policy to testing and production" (:256-262) must stay green.
- `src/app/routes/routePattern.test.js`, new:
  - `/verify/abc` → `/verify/:token` and `/review-change/x` → `/review-change/:token`, both secret.
  - `/verify/abc/extra` and `/Verify/abc` are secret paths (prefix rule; matching is case-insensitive).
  - `/sign/c1/r1` → `/sign/:companyId/:requestId`, not secret.
  - `/apply/acme` and `/apply/acme/` → `/apply/:slug`.
  - `/company/drivers/applications` → itself; `/company` → `/company`; `/company/zzz` → `/company/*`; `/super-admin/companies/x/y` → `/super-admin/*`.
  - `/login` and `/` map to themselves; `/nope` → `unmatched`, not secret.
  - Every manifest path (public, protected, and every `COMPANY_ROUTE_MANIFEST` child under `/company/`) maps to itself, and every manifest path with a `:token` segment is secret. This guards future routes.
- `src/app/startup/site.test.js`, new: the five hosts map as above (also in upper case); `localhost`, `truckerapp-system--pr1-abc.web.app` and `example.com` → `null`.
- `src/app/startup/speedMonitoring.test.js`, new:
  - With a `load` spy, nothing is loaded in dev, in E2E mode, on another host, or when landing on `/verify/x` or `/review-change/x/y`.
  - Otherwise it loads once and passes `{ route: '/apply/:slug', site: 'testing', release: 'abc1234' }` plus `isSecretPath`. A rejected import resolves `false`.
  - Read `src/main.jsx` as text (the pattern of `startupGuards.test.jsx:73-77`) and assert it calls `startSpeedMonitoring()` inside `whenIdle(`. Read `startupGuards.jsx` and assert it does not import `speedMonitoring`.
- `src/lib/monitoring/pageLoadTrace.test.js`, new:
  - `vi.mock('firebase/performance', …)` with `initializePerformance: vi.fn(() => ({}))` and `trace: vi.fn(() => ({ record }))`; `vi.mock('web-vitals/attribution', …)` with five `vi.fn` that capture their callbacks; `vi.mock('@lib/firebase/config', () => ({ app: {} }))`, because the real module awaits the Hosting config at top level. Pass fake `doc`, `win` and `perfApi`.
  - The module-level once-flag needs `vi.resetModules()` and a fresh `await import('./pageLoadTrace')` in each test.
  - Give mock defaults at creation (`vi.fn(() => x)`); if any `*Once` is queued, reset with `vi.resetAllMocks()` (`.claude/rules/testing.md`).
  - Assert:
    - The settings are exactly `{ instrumentationEnabled: false, dataCollectionEnabled: true }`.
    - A page that is not visible at start initialises nothing.
    - The first hidden event records exactly one `page_load`, with `performance.timeOrigin`, `Math.round(loadEventEnd)`, the four attributes and integer metrics.
    - A later hidden event or `pagehide` records nothing more. A `pagehide` that comes first also records exactly once.
    - Nothing is recorded when the current address is `/verify/x`, or when `loadEventEnd` is 0.
    - Metrics that never reported are absent; values longer than 100 characters are truncated.
    - Fakes that throw are swallowed (the function returns `false`, and nothing propagates).
- `src/lib/monitoring/firebasePerformanceSdk.contract.test.js`, new (`// @vitest-environment node`). It reads the installed SDK files, and every assertion's message reads "@firebase/performance changed: re-check the privacy design in pageLoadTrace.js before updating this test". It asserts:
  - `getUrl` still cuts the query (`href.split('?')[0]`).
  - `page_url: Api.getInstance().getUrl()` is still present, which is why token pages are skipped.
  - Automatic and network logging are still gated by `instrumentationEnabled` (`!settingsService.instrumentationEnabled && trace.isAuto` and `if (!settingsService.instrumentationEnabled) {`).
  - `sendOobTrace` still defers with `/setTimeout\(\(\) => \{\s*Trace\.createOobTrace\(/`, and `createOobTrace` still matches `/logTrace\(trace\);\s*flushLogs\(\);/`. Together these are why a synchronous record in the hidden handler is flushed.
  - The SDK still imports `web-vitals/attribution`, and the installed `node_modules/web-vitals/package.json` major version equals the major of `@firebase/performance`'s `web-vitals` range. A Dependabot major bump of the direct dependency would then fail here instead of shipping two copies.
  - `https://firebaseremoteconfig.googleapis.com/v1/projects/` is in the performance file, and `https://firebaseinstallations.googleapis.com/v1` is in `node_modules/@firebase/installations/dist/esm/index.esm2017.js`.
  - The two `flTransportEndpointUrl = mergeStrings('…', '…')` arguments (`:321`), read by regex and merged in the test, still decode to `https://firebaselogging-pa.googleapis.com/v1/firelog/legacy/log`.
  - **Never read, print or copy the `transportKey` arguments (`:322`) into the test or any repository file.** They decode to a Google `AIza…` key, and the gitleaks-based secret scan (`gcp-api-key`) would refuse the change.
- `src/tests/viteBuildConfig.test.js`: the three new ids.
- `scripts/test-bundle-budget.mjs`: no edit; the B5b loop proves both new markers in the entry and in a preload.
- Which fail before the change: the hosting test (missing origins) and the four new behaviour test files (modules missing). The pin test passes against the current SDK by design.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md`. It is over its warning limit (1,514 of 1,500 lines; 97,427 of 96,256 bytes), and AGENTS.md §7 says to shorten the text either way. Make the three edits below, and tighten wording in the same sections so the file ends with **no more lines and no more bytes** than at the base commit:
  - §7 Firebase row (line 940): "(Auth, Firestore, Storage, Functions, Hosting, Performance Monitoring)".
  - §10, folded into the CSP bullet (1169-1175) or replacing words in it: "Speed data carries no secret: Firebase Performance records one `page_load` per page load, named by route pattern with `site` (by hostname) and `release`. Its automatic traces are off, and nothing is recorded on `/verify/:token` or `/review-change/:token`, because the SDK attaches the page address to every trace. In-app navigations are not measured."
  - §13 line 1469: add "speed monitoring" to the list of code that loads later.
- `docs/security-posture.md:247-248`: add Firebase Performance Monitoring to the list of services the policy allows.
- `docs/FIREBASE_HOSTING_RUNBOOK.md` "Provider ownership" (452-462): one bullet saying Firebase Performance Monitoring holds real-user speed data, plus the console setup steps (Performance enabled; Installations and Remote Config APIs enabled; browser key not restricted away from them), where the data appears, and the accepted loss (a page closed within seconds of becoming idle may not report).
- `docs/OWNER_GUIDE.md` is at its 80-line limit. Add one Russian line under "Как всё устроено" ("Скорость у настоящих пользователей: Firebase console → Performance → Custom traces → `page_load`, фильтр `site`") and merge it into an existing line, so the file stays at 80 lines or fewer.

## Verify before opening the PR

- `npm run lint:frontend`; `npm run typecheck` (must pass; it proves no `src/lib` file pulls in `src/app/auth/roles.js`); `npm run check:source-size`; `npm run check:agent-docs`; `npm run check:ci-plan` (the release-pipeline rule covers `firebase.json`).
- `npx vitest run src/app/routes src/app/startup src/lib/monitoring src/tests/hostingConfig.test.js src/tests/viteBuildConfig.test.js`, then `npm run test:coverage`. This is the full suite and the ratchet; read the real exit status.
- `npm run build`, then `npm run check:bundle-budget` and `npm run test:bundle-budget`.
  - Compare with the step-2 baseline: the first download and the apply page may each grow by at most 1,000 bytes gzip.
  - `grep -l fireperf dist/assets/*.js` and `grep -l firebaseinstallations.googleapis.com dist/assets/*.js` must each list at least one file; `check:bundle-budget` proves none of them is in the first download.
  - Record the gzip size of the lazy chunk(s) holding them (about 15 kB expected; measure it).
- Playwright, one suite at a time, after checking that port 5000 is free (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`), with `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` locally:
  - `npm run test:e2e -- --project=chromium e2e/login.spec.cjs`
  - `npm run test:e2e -- --project=chromium e2e/public-application.spec.cjs`
  - `npm run test:e2e -- --project=chromium e2e/verification-portal-closeout.spec.cjs`
  These run the dev server with `VITE_E2E_TEST_MODE=1` (`playwright.config.cjs:96-105`), where speed monitoring is off by design, so they prove only that startup did not change.
- State in the PR that the production path against the real Firebase project could not be exercised locally. Dev mode is off by design, and `vite preview` has no `/__/firebase/init.json`.

## Verify after merge (on Testing, read-only)

- Watch the `main` run through `verify-shipped` and `release-ready` (release-pipeline rule 5).
- One GET: `curl -sI https://truckerapp-system.web.app/login | grep -i content-security-policy-report-only` must list the three new hosts.
- The agent must **not** drive a browser against Testing: every visit registers a Firebase installation, a record in the shared project. The owner's normal visits are enough.
- Owner console setup (Russian steps in the PR):
  1. Firebase console → project `truckerapp-system` → Performance → "Get started" if shown.
  2. Google Cloud console → APIs & Services → Enabled APIs: make sure "Firebase Installations API" and "Firebase Remote Config API" are enabled.
  3. APIs & Services → Credentials → the browser key: if "API restrictions" lists APIs, add those two.
  Without steps 2 and 3 the SDK silently sends nothing (index.esm2017.js:313, 567-581).
- Owner: on a phone and on a computer, open `https://truckerapp-system.web.app/login` and a public application link (do not submit it), wait about 15 seconds, then switch to another app or tab.
- The next day, open Firebase console → Performance → Custom traces → `page_load` and filter `site = testing`. If the console lists more than one web app, check each, because Hosting's `init.json` may give the Production site a different app. Check that `route` values look like `/apply/:slug`. Where the console shows page addresses, check that none contains `/verify/` or `/review-change/`.
- After the owner promotes a release, repeat the check with `site = production`.

## Risks and safeguards

- `npm run typecheck` breaking. Route code in `src/lib` would pull `roles.js` into the checked program (3 errors, verified). The plan keeps every `@app` import under `src/app/` and passes `isSecretPath` into the lib module; `npm run typecheck` is a required check.
- Larger downloads.
  - The SDK loads only through a dynamic import after idle. The bundle markers, the vendor-chunk test and `check:bundle-budget` refuse a regression.
  - Every page except the token pages downloads about 15 kB gzip more once idle; the size is recorded in the PR.
- Secrets in what is recorded. The SDK attaches the current address to every trace, so nothing is recorded when the landing or current path is secret, including unmatched paths under a secret prefix, and queries are never sent (`:155`). The pin test fails if an SDK update changes any of this, so a Dependabot bump cannot silently re-open the leak.
- Lost samples. A page hidden before the SDK has initialised, closed within seconds of becoming idle, or loaded in a background tab does not report. This is accepted and written in the runbook. Firebase is free, so all other page loads are recorded (no sampling).
- No data at all. A restricted API key or a disabled API makes the SDK send nothing, silently. The owner's console steps cover it, and the post-merge check catches it.
- A new client identifier. The SDK creates a Firebase installation ID per browser (IndexedDB) and stores its settings in localStorage (`@firebase/performance/config`). The privacy policy already covers device identifiers and aggregate reliability analysis (`web/privacy.html:104-108,127-128`).
- The app breaking. Every call is wrapped and a failure resolves `false`. Sentry keeps running unchanged until T5b. The SDK observes resource timings even with automatic traces off; the cost is negligible, and it patches nothing.
- CSP. The policy is report-only, so a missing origin would only produce reports. The hosting test pins both targets as identical, which promotion requires.
- Rollback: revert the PR, and Testing redeploys. Production changes only when promoted; if it was, Super Admin → Releases → "Roll back to previous release".

## Done when (acceptance criteria)

- [ ] The owner chose Option A, and the PR says so.
- [ ] Both app targets in `firebase.json` list the three Firebase Performance origins, byte-identical, and `hostingConfig.test.js` passes.
- [ ] Unit tests prove exactly one `page_load` per page load, with `route`, `site`, `release`, `nav` and only the vitals that reported, and settings `{ instrumentationEnabled: false, dataCollectionEnabled: true }`.
- [ ] Unit tests prove nothing is loaded or recorded on `/verify/…` or `/review-change/…` (unmatched variants included), off the five known hosts, in dev or E2E builds, or in a tab that starts hidden.
- [ ] No file under `src/lib` imports `@app/…`, and `npm run typecheck` passes.
- [ ] Firebase Performance, Installations and web-vitals are only in lazy chunks: both markers are found in `dist/assets` and refused in the first download.
- [ ] The first download and the apply page each grew by ≤ 1,000 bytes gzip against the step-2 baseline, with the numbers in the PR.
- [ ] The SDK pin test exists, contains no API-key material, and CI's secret scan passes.
- [ ] Lint, typecheck, `test:coverage`, build, both bundle checks, `check:source-size`, `check:agent-docs`, `check:ci-plan` and the three Playwright suites passed, or each is named in the PR as not run.
- [ ] APP_BRIEF (lines and bytes not above the base commit), security-posture, the hosting runbook and OWNER_GUIDE (≤ 80 lines) are updated.
- [ ] After merge, the Testing CSP header lists the hosts, and the owner sees `page_load` with `site = testing` in the console within a day. If not, the APIs and the key restriction are re-checked.
