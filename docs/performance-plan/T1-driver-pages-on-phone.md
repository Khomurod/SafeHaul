# T1. Measure the driver pages on a phone

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #31 — Test on slow phones and networks. The same run also produces the numbers needed before anyone decides on #24 (Select only the columns you need → M4) and #26 (Prevent unnecessary re-renders → M5). #20 (SSR/SSG) and #22 (code splitting) are context only: they explain the first-paint chain. This task plans no SSR or code-splitting work.
- **Size:** M · **Pull requests:** 1 (documentation only) · **Depends on:** none · **Owner decision needed:**
  - (1) "Which company's application link may the agent open on Testing?" Recommended: your own test company. Opening the page only reads its public profile and creates or sends nothing. With no answer, the agent uses `/sandbox/apply`.
  - (2) "Will you spend about 10 minutes measuring the Applications list in Chrome, following the Russian instructions in step 0?" Recommended: yes. The agent does not sign in, and without these numbers M4 stays undecided.
  - (3) "May PageSpeed Insights load `https://app.safehaul.io/login` once to read real users' speed data?" Recommended: yes.
- **Why it matters for users:** Drivers apply on phones over bad connections (`docs/APP_BRIEF.md:46-47`, `:63`). Nobody has measured how long the driver pages take to appear, or how quickly typing responds, on a mid-range phone. This task measures it once, the way Google does, and records which of four candidate speed fixes are worth doing, so work goes only where it helps.

## Current behaviour (verified at 11626a6)

- **No phone-speed measurement exists for the driver pages.**
  - The 2026-10-30 audit covered only `/login` and `/developers/api`, with the CPU not slowed. Unlighthouse uses `cpuSlowdownMultiplier: 1` when its config sets no throttle (`@unlighthouse/core/dist/index.mjs:1669-1692`; the audit tool and its config are outside the repo and were not kept).
  - Its saved Testing result for `/login` (a Lighthouse JSON report outside the repo, not kept) records Lighthouse 13.6.0, `simulate`, CPU 1x, benchmarkIndex 2,099.5, FCP 1,040 ms, LCP 3,494 ms, TBT 4 ms, and a vendor-chunk transfer of 160,191 B (Production: 160,077 B; both include headers).
  - Lighthouse's standard mobile setting is slow 4G plus a 4x CPU slowdown (`lighthouse/core/config/constants.js:61-63`). Lantern `mobileSlow4G` sets RTT 150 ms, 1,638.4 kbit/s and `cpuSlowdownMultiplier: 4`. The devtools variant sets 562.5 ms request latency, 1,474.56 kbit/s down and 675 kbit/s up (`@paulirish/trace_engine/models/trace/lantern/simulation/Constants.js:11-18`).
  - Lighthouse warns about a slow host only below benchmarkIndex 1,000 (`lighthouse/core/gather/driver/environment.js:28`).
- **CI checks bytes, not speed.**
  - `scripts/check-bundle-budget.mjs:32` caps the first download at 319,000 B gzip.
  - `:65` caps `/apply/:slug` at 536,000 B, font included, measured by `measureApplyPage` (`:186-226`). It prints `first download: …` and `application page: …` lines (`:234`, `:238`).
  - Nothing in `.github/` runs Lighthouse.
  - Playwright runs on the Vite dev server in E2E mode (`playwright.config.cjs:96-105`), so it cannot time production bundles.
- **First-paint chain on every public page.**
  - `index.html:23` ships an empty `<div id="root">`.
  - `src/lib/firebase/config.js:121` awaits `/__/firebase/init.json` at module top level. The build preloads it (`vite.config.js:52-62`).
  - `DataProvider` then runs the auth check (`src/context/DataContext.jsx:146`) and shows "Loading Platform..." meanwhile (`:252-260`).
  - Only then is the lazy route chunk requested (`src/app/routes/featureRegistry.jsx:63-66`). `/sandbox/apply` loads `SandboxApplyHandler` (`:78-81`), which wraps `PublicApplyHandler` (`src/features/sandbox/SandboxApplyHandler.jsx`).
  - `/apply` then queries `public_profiles` (`src/features/driver-app/services/publicProfileService.js:15-27`) before the wizard renders.
- **Opening `/apply/<slug>` in a fresh browser only reads data.**
  - The profile read is at `src/features/driver-app/components/application/publicApplyBootstrap.js:208`.
  - The invite exchange runs only with `?invite=` (`publicApplyInvite.js:143-145`).
  - A server draft save happens only on Continue or Save as Draft (`useDraftLifecycle.js:157-159`, `:302-303`).
  - The resume lookup runs before the first save (`src/features/driver-app/hooks/useApplicationResume.js:174-190`).
  - Agreements load on steps 4 and 9 only (`steps/Step4_Violations.jsx:68`, `steps/Step9_Consent.jsx:102`).
  - `src/features/driver-app` has no `visibilitychange`, `pagehide`, `beforeunload` or `setInterval` save.
  - `/sandbox/apply` reads `public_profiles/SANDBOX` and falls back to a built-in profile (`publicApplyBootstrap.js:155-173`). Its admin panel renders only after a sandbox submission (`PublicApplyScreens.jsx:331-338`) and calls its callable only for a super admin (`src/features/sandbox/SandboxActionPanel.jsx:40-58`).
  - Recruiter links add `?r=` / `?recruiter=` (`src/features/settings/components/PersonalProfileTab.jsx:88-89`) or `?ref=` (`src/features/referrals/referralLinksService.js:32`). Never open them.
- **Opening `/sign/...` or `/verify/...` writes to the shared backend, even with a wrong token.**
  - `getPublicEnvelope` runs two rate-limit transactions (`functions/publicSigning.js:69`, `:73`) that write `rate_limits` documents (`functions/shared/rateLimiter.js:13-43`).
  - `getVerificationRequest` rate-limits (`functions/employmentVerification/portal.js:19`) and marks a pending request `opened` (`:47-52`), which the recruiter sees.
  - These pages are therefore measured only locally against the E2E mocks: `/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock` (`e2e/edoc-recruiter-send-and-sign.spec.cjs:26`) and `/verify/e2e-token-1?e2eVerify=mock` (`e2e/helpers/verificationPortalHelpers.cjs:15`).
- **A local production build in E2E mode is a safe stand-in.**
  - `isE2ETestMode` is `VITE_E2E_TEST_MODE === '1'` alone (`src/lib/runtime/e2eMode.js:1`). A production build still fetches `init.json` (`config.js:79-117`), so a local server can hand it a placeholder project.
  - Fixtures replace the network: `/apply` at `publicApplyBootstrap.js:176-206`, `/sign` at `src/features/signing/hooks/useSigningEnvelope.js:110-116`, `/verify` at `src/features/verification/hooks/useVerificationPortal.js:65-67`.
  - The draft-service stand-ins are off in production builds (`src/features/driver-app/services/applicationDraftService.js:140-143`), and the closed-port Firestore trick is dev-only (`config.js:53`, `:169-171`). The harness must therefore block every external host itself.
  - Differences from the real pages:
    - E2E mode skips the auth check (`DataContext.jsx:95-118`).
    - The mock `/sign` shows the real consent screen but skips `getPublicEnvelope`. It does download the pdf.js chunk with the route (95 kB brotli in the dry run), but never the PDF or `/pdf.worker.min.mjs`, which load only after "I Agree" (`src/features/signing/SigningRoom.jsx:311-316`, `src/features/signing/components/signing-room/SigningDocumentView.jsx:66-69`, `:291-298`).
    - The mock `/verify` skips its callable.
- **Recruiter Applications list.**
  - It reads 20 full documents per page with `getDocs` (`src/features/companies/hooks/useCompanyDashboard.js:35`, `:231-232`).
  - A name search runs 5 prefix queries of up to 30 documents each (`dashboardSearch.js:33`, `:107-113`) after a 400 ms debounce (`useCompanyDashboard.js:77-82`).
  - Firestore uses the SDK's default WebChannel transport (`config.js:142-145`), so the bytes appear in DevTools under `firestore.googleapis.com`.
  - In the sidebar, "Applications" sits inside the "Driver Applications & Leads" group (`src/app/routes/companyRouteManifest.js:14-21`, `:137-143`). The search placeholder is "Search name, phone, email..." (`src/features/companies/components/DashboardToolbar.jsx:74`). Paging uses the "Next page" button (`src/design-system/components/data-table/TablePagination.jsx:45-51`).
  - Only a signed-in user can measure this, so the owner does it.
- **Typing in the application.**
  - All answers live in one state object (`PublicApplyHandler.jsx:58`).
  - Employment History has step index 5 (`src/shared/components/layout/wizardSteps.js:14-25`).
  - In E2E mode, a local draft with `lastStep` opens on that step (`publicApplyBootstrap.js:191-201`). The legacy flat draft lives under `draft_<slug>` (`applicationDraftStorage.js:33`, `:186-192`).
  - Plain inputs: `#first-name`, `#last-name`, `#street`, `#city` (`e2e/helpers/wizardHelpers.cjs:134-142`), and `#emp-street-N`, `#emp-position-N`, `#emp-supervisor-N` (`steps/Step6_Employment.jsx:218`, `:242`, `:272`). `#emp-name-N` is the FMCSA autocomplete (`:200`) and is not typed into.
- **Planning dry run and review re-check at 11626a6.** These were single runs on a noisy machine (benchmarkIndex 1,121–1,948) to prove the method. They are not the baseline.
  - The harness served the vendor chunk brotli-compressed: a 159,880 B body, about 160,000 B as a Lighthouse transfer.
  - Over HTTP/1.1, `/apply` simulated about 2 s slower than over HTTP/2 (LCP 5.8 s against 3.8 s, Lighthouse 12.6.1 runs). The harness must therefore speak HTTP/2.
  - Lighthouse 13.6.0 local `/apply/e2e-company` at simulate 4x: FCP 0.9–1.9 s, LCP 3.3–4.4 s, TBT 336–679 ms, 75 script requests.
  - At devtools 4x: vendor done at about 2.9 s, route chunk requested at about 3.5 s (641 ms gap, a 38-chunk batch that took about 1.7 s), font requested at about 3.4 s, LCP 5.7–6.5 s.
  - Typing at 4x: worst keystroke 72–152 ms. At 10x: 288–472 ms.
  - No request left 127.0.0.1, and `git status` stayed clean.

## Scope

- In:
  - Standard-mobile Lighthouse runs (4x CPU, slow 4G; simulate and devtools) of Testing `/login` and Testing `/apply/<owner test company>` (or `/sandbox/apply`).
  - Local-harness runs of `/login`, `/apply/e2e-company`, the `/sign` mock and the `/verify` mock.
  - A typing probe at CPU 1x, 4x and 10x.
  - The owner's DevTools measurement of the Applications list: pages and name searches.
  - A PageSpeed Insights cross-check.
  - One committed report, `docs/qa/mobile-speed-baseline.md`, with a verdict for each follow-up, plus one row in `README.md`.
- Out (do not do in this task):
  - Any application, config, test, CI or dependency change. No Lighthouse in `package.json`, no Lighthouse CI, no new script files in the repository.
  - Any fix for what the numbers show. No SSR or code splitting.
  - Loading `/sign`, `/verify` or `/review-change` on Testing or Production, or any URL with `?invite=`, `?r=`, `?recruiter=`, `?ref=` or `?k=`.
  - Typing into, or clicking anything on, a Testing page.
  - Measuring Production, except the single optional PageSpeed field-data call (decision 3).
  - Mobile-safari or webkit runs.

## Read first

- `AGENTS.md`:
  - §1: the Russian notice, one small PR, "Кратко".
  - §2: "Testing is not a sandbox".
  - §3: never report an unrun check.
- `docs/APP_BRIEF.md`:
  - §1 lines 46-47 and §2 line 63: why phones matter.
  - §3 lines 97-109: startup and public routes.
  - §10 lines 1133-1140: Testing shares the real backend. Lines 1169-1175: the report-only CSP goes to Sentry.
  - §13 lines 1462-1473: Playwright lanes and the first-download budget.
- `.claude/rules/testing.md` "Running suites locally":
  - Rule 1: port check.
  - Rule 2: never kill by a broad pattern.
  - Rule 3: long runs go to the background, with logs and the real exit status.
  - Rule 6: `/opt/pw-browsers/chromium` suits functional runs, not pixel lanes.
  - `.claude/rules/ui.md`, `release-pipeline.md` and `source-size.md` do not apply: nothing visual, pipeline-related or runtime changes.
- `.claude/skills/implement/SKILL.md`, all eight steps. Here §3 means writing the report, §4 means the checks that apply to a docs-only change (name the skipped ones), and §6 means re-reading the final diff.
- Lighthouse throttling docs through Context7:
  - `npx ctx7@latest library Lighthouse "CPU throttling multiplier calibration using benchmarkIndex"`, then `npx ctx7@latest docs /googlechrome/lighthouse "CPU throttling multiplier calibration using benchmarkIndex device class table"` (source `docs/throttling.md`).
  - Key facts: the default 4x moves a high-end desktop (benchmarkIndex 1,500–2,000) into mid-tier mobile, range 2–10x. Low-end mobile needs 10x (5–20x). A low-end desktop (1,000–1,500) needs 2x (1–5x) for mid-tier and 5x (3–10x) for low-end.
  - If the quota is exhausted, say so and read the installed `lighthouse/core/config/constants.js` and the Lantern `Constants.js` in the npx cache.
- `docs/qa/edoc-mobile-document-first-qa.md`, for the house style of a `docs/qa/` page.

## Implementation steps

`PERF` is a new folder `perf-t1/` in this session's scratchpad directory, never inside the repository. Shell variables do not survive between tool calls, so every command after step 1 starts with `source <PERF>/env.sh`. Run one thing at a time, and run nothing else CPU-heavy (builds, test suites) while Lighthouse or the probe runs. Run each long script with the Bash tool's background mode and a log, and wait for its completion notice instead of a foreground `sleep`. Stop servers only by their saved PID.

0. **Tell the owner before starting** (`AGENTS.md` §1), in Russian:
   ```text
   Что изменится: в приложении — ничего. Я замерю, как быстро открываются страницы водителя (анкета, подпись документов, проверка прошлого работодателя) на «медленном телефоне», и запишу итог в docs/qa/mobile-speed-baseline.md.
   Что не трогаю: код, данные и настройки Firebase. На Testing я только открываю страницу входа и анкету и ничего не отправляю; страницы подписи и проверки работодателя меряю только на своей копии с тестовыми данными.
   Нужно от вас: (1) ссылка на анкету тестовой компании; (2) 10 минут на замер списка заявок — инструкция ниже; (3) разрешение на один запрос к Google PageSpeed для app.safehaul.io/login.
   ```
   - Request (1): "Пришлите ссылку на анкету вашей тестовой компании: Settings → My profile → блок «Your Short Recruiting Link». Мне нужна только часть между /apply/ и знаком «?» — без «?» и всего, что после него." Accept it only if it matches `^[a-z0-9][a-z0-9_-]*$`; otherwise ask once more. Then run `echo 'export APPLY_PATH=/apply/<slug>' >> <PERF>/env.sh`. With no usable answer within the session, write `export APPLY_PATH=/sandbox/apply` instead and say so in the report.
   - Request (3): "Можно ли один раз попросить сервис Google PageSpeed открыть страницу входа https://app.safehaul.io/login, чтобы получить данные о скорости у ваших реальных пользователей? Ничего не меняется."
   - Request (2): send this text verbatim:
   ```text
   Замер списка заявок на Testing (около 10 минут, на компьютере, в Google Chrome)
   1. Откройте в Chrome https://truckerapp-system.web.app и войдите как обычно. Откройте компанию, в которой больше всего заявок (нужно больше 60: замер E открывает четвёртую страницу, строки 61–80).
   2. Откройте главную страницу компании (Dashboard). Список заявок пока не открывайте.
   3. Нажмите F12 (на Mac: Cmd+Option+I). Откроется панель разработчика. Вверху панели выберите вкладку «Network» («Сеть»).
   4. В поле «Filter» («Фильтр») вверху панели вставьте: firestore.googleapis.com
   5. Проверьте: круглая кнопка записи слева вверху красная, галочка «Preserve log» («Сохранять журнал») снята.
   6. В самом низу панели есть строка вида «12 / 80 requests | 35.2 kB / 900 kB transferred | 40 kB / 2.1 MB resources». Запишите первое число перед «transferred» (здесь 35.2 kB) и первое число перед «resources» (здесь 40 kB). Это замер A.
   7. В меню слева откройте раздел «Driver Applications & Leads» и нажмите «Applications». Дождитесь таблицы и подождите ещё 5 секунд, пока числа внизу перестанут меняться. Запишите оба числа — замер B — и сколько строк в таблице.
   8. Нажмите стрелку «>» (кнопка Next page) под таблицей, подождите 5 секунд — замер C. Ещё раз «>» — замер D. Ещё раз — замер E.
   9. Нажмите в поле поиска «Search name, phone, email...» и быстро, без пауз, введите три первые буквы фамилии любого водителя из таблицы. Подождите 5 секунд — замер F и сколько строк нашлось. Сами буквы не присылайте.
   10. Сотрите буквы, подождите 5 секунд — замер G. Введите одну латинскую букву a, подождите 5 секунд — замер H и сколько строк нашлось.
   11. Пришлите только числа A–H (с единицами kB или MB, как на экране), число строк и примерное общее число заявок в компании. Снимки экрана не присылайте: на них видны имена водителей.
   ```
   While waiting for answers, do steps 1–5 and 8, in order.
1. **Prepare.**
   - Create the branch `claude/mobile-speed-baseline` from up-to-date `main`. `git status --short` must be empty. Record `git rev-parse HEAD`.
   - If `node_modules` is missing, run `npm ci`. It changes no tracked file.
   - Create the folders and the shared variables:
   ```bash
   PERF=<scratchpad>/perf-t1 && mkdir -p "$PERF/raw" && cat > "$PERF/env.sh" <<EOF
   export REPO=$(git rev-parse --show-toplevel)
   export PERF=$PERF
   export CHROME_PATH=/opt/pw-browsers/chromium
   export L=https://127.0.0.1:4320
   export T=https://truckerapp-system.web.app
   EOF
   ```
   - Read the deployed Testing SHA with one static GET: `curl -sS https://truckerapp-system.web.app/release.json`. If it differs from HEAD, measure anyway and record both.
   - Check the port is free: `curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1:4320` must print `000`.
2. **Static bytes at this commit**, so the report ties timings to sizes.
   - `source <PERF>/env.sh && cd "$REPO" && npm run build > "$PERF/build.log" 2>&1; echo "exit=$?"`, then `source <PERF>/env.sh && cd "$REPO" && npm run check:bundle-budget | tee "$PERF/budget.txt"`. Copy its `first download:` and `application page:` lines into the report.
   - Record `gzip -c dist/pdf.worker.min.mjs | wc -c` (288,718 B at 11626a6). The real `/sign` downloads this, plus the PDF, after "I Agree"; the mock never does.
   - If `git status --short` now shows `public/pdf.worker.min.mjs` (the `prebuild` copy), restore it with `git checkout -- public/pdf.worker.min.mjs` and note it.
3. **E2E-mode production build into the scratchpad**, never into `dist/`. The variables are blanked as CI's `app-visual` job does (`.github/workflows/main.yml:459-469`), so no `.env` value reaches the bundle (Sentry DSN included):
   ```bash
   source <PERF>/env.sh && cd "$REPO" && env VITE_E2E_TEST_MODE=1 VITE_FIREBASE_API_KEY= VITE_FIREBASE_AUTH_DOMAIN= VITE_FIREBASE_PROJECT_ID= \
     VITE_FIREBASE_STORAGE_BUCKET= VITE_FIREBASE_MESSAGING_SENDER_ID= VITE_FIREBASE_APP_ID= VITE_FACEBOOK_APP_ID= \
     VITE_SENTRY_DSN= VITE_SUPER_ADMIN_EMAIL= VITE_DRIVER_APP_URL= VITE_SOCRATA_APP_TOKEN= \
     npx vite build --outDir "$PERF/dist-e2e" --emptyOutDir > "$PERF/build-e2e.log" 2>&1; echo "exit=$?"
   ```
4. **Local Hosting stand-in.** It serves HTTP/2 over TLS, brotli or gzip, the exact `testing` headers from `firebase.json:21-58`, the SPA rewrite, and a placeholder `init.json`.
   - Create a throwaway certificate and keep its key hash:
   ```bash
   source <PERF>/env.sh && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 7 -subj "/CN=127.0.0.1" \
     -addext "subjectAltName=IP:127.0.0.1" -keyout "$PERF/key.pem" -out "$PERF/cert.pem" \
   && echo "export SPKI='$(openssl x509 -pubkey -noout -in "$PERF/cert.pem" | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)'" >> "$PERF/env.sh"
   ```
   - Write `$PERF/serve-dist-h2.mjs`. This exact code was tested:
   ```js
   // Local stand-in for Firebase Hosting (HTTP/2 + TLS), for speed measurement only.
   // Usage: node serve-dist-h2.mjs <distDir> <port> <repoRoot> <cert.pem> <key.pem>
   import http2 from 'node:http2';
   import { readFileSync, statSync } from 'node:fs';
   import { join, extname, normalize, resolve, sep } from 'node:path';
   import zlib from 'node:zlib';

   const [distArg, portArg, repoArg, certFile, keyFile] = process.argv.slice(2);
   const dist = resolve(distArg);
   const firebase = JSON.parse(readFileSync(join(repoArg, 'firebase.json'), 'utf8'));
   const testing = firebase.hosting.find((h) => h.target === 'testing');
   const HEADERS = Object.fromEntries(testing.headers[0].headers.map((h) => [h.key, h.value]));
   // Non-secret placeholder project (the E2E project id); never the real config.
   const INIT_JSON = JSON.stringify({
     apiKey: 'perf-only', authDomain: 'safehaul-e2e.firebaseapp.com',
     projectId: 'safehaul-e2e', storageBucket: 'safehaul-e2e.appspot.com',
     messagingSenderId: '0', appId: '1:0:web:0',
   });
   const TYPES = {
     '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
     '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
     '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
   };
   const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
   const cache = new Map();

   function fileFor(urlPath) {
     const candidate = normalize(join(dist, decodeURIComponent(urlPath)));
     // `dist + sep`, so a sibling such as `dist-e2e-x/` (reachable via `..%2f`) is not served.
     if (candidate.startsWith(dist + sep)) {
       try { if (statSync(candidate).isFile()) return candidate; } catch { /* fall through */ }
     }
     return join(dist, 'index.html'); // the `**` -> /index.html rewrite
   }

   function encoded(file, ext, accept) {
     const enc = !COMPRESSIBLE.has(ext) ? 'identity' : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : 'identity';
     const key = `${enc}:${file}`;
     if (!cache.has(key)) {
       const raw = readFileSync(file);
       cache.set(key, enc === 'br' ? zlib.brotliCompressSync(raw) : enc === 'gzip' ? zlib.gzipSync(raw) : raw);
     }
     return { enc, body: cache.get(key) };
   }

   http2.createSecureServer({ allowHTTP1: true, cert: readFileSync(certFile), key: readFileSync(keyFile) }, (req, res) => {
     const { pathname } = new URL(req.url, 'http://local');
     for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
     if (pathname === '/__/firebase/init.json') {
       res.setHeader('Content-Type', 'application/json');
       res.setHeader('Cache-Control', 'no-store');
       return res.end(INIT_JSON);
     }
     const file = fileFor(pathname);
     const ext = extname(file);
     const { enc, body } = encoded(file, ext, String(req.headers['accept-encoding'] || ''));
     res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
     if (enc !== 'identity') res.setHeader('Content-Encoding', enc);
     res.setHeader('Vary', 'Accept-Encoding');
     res.end(body);
   }).listen(Number(portArg), '127.0.0.1', () => console.log(`serving ${dist} on https://127.0.0.1:${portArg} (HTTP/2)`));
   ```
   - Start it and keep its PID:
   ```bash
   source <PERF>/env.sh && (nohup node "$PERF/serve-dist-h2.mjs" "$PERF/dist-e2e" 4320 "$REPO" "$PERF/cert.pem" "$PERF/key.pem" > "$PERF/server.log" 2>&1 & echo $! > "$PERF/server.pid")
   ```
   - Sanity checks:
     - `source <PERF>/env.sh && curl -sk --http2 -o /dev/null -w "%{http_version} %{http_code}" "$L/apply/e2e-company"` prints `2 200`.
     - `source <PERF>/env.sh && curl -sk "$L/__/firebase/init.json"` shows `perf-only`.
     - `source <PERF>/env.sh && V=$(ls "$PERF/dist-e2e/assets" | grep '^vendor-.*\.js$'); curl -sk --http2 -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}' "$L/assets/$V"` prints 152,000–168,000. It was 159,880 at 11626a6.
5. **Lighthouse on the local harness: 5 simulate runs per page and 3 devtools runs for `/apply`.** Pin Lighthouse 13.6.0, the 2026-10-30 audit's version (on npm; needs Node ≥ 22.19).
   - Write `$PERF/lh.sh`:
   ```bash
   # Shared Lighthouse settings for T1. Sourced after env.sh by run-local.sh and run-testing.sh.
   LH=(npx --yes lighthouse@13.6.0)
   CPU="${CPU:-4}"
   SUFFIX="${SUFFIX:-}"
   COMMON=(--only-categories=performance --form-factor=mobile "--throttling.cpuSlowdownMultiplier=$CPU" --output=json --quiet)
   LOCAL_CHROME=("--chrome-flags=--headless=new --no-sandbox --ignore-certificate-errors-spki-list=${SPKI:-}")
   TEST_CHROME=("--chrome-flags=--headless=new --no-sandbox")
   BLOCK=(--blocked-url-patterns='*googleapis.com*' --blocked-url-patterns='*cloudfunctions.net*' --blocked-url-patterns='*sentry.io*'
          --blocked-url-patterns='*facebook.net*' --blocked-url-patterns='*facebook.com*' --blocked-url-patterns='*google.com*'
          --blocked-url-patterns='*gstatic.com*' --blocked-url-patterns='*firebaseapp.com*')
   # lhrun <group> <run> <url> <simulate|devtools> [flags...]  ->  $PERF/raw/<group><SUFFIX>-<run>.json
   lhrun() {
     local group="$1" n="$2" url="$3" method="$4"; shift 4
     "${LH[@]}" "$url" "${COMMON[@]}" --throttling-method="$method" "$@" --output-path="$PERF/raw/$group$SUFFIX-$n.json"
     local rc=$?
     echo "$(date -u +%FT%TZ) $group$SUFFIX-$n rc=$rc"
   }
   ```
   - Write `$PERF/run-local.sh`:
   ```bash
   #!/usr/bin/env bash
   # Local harness only. Usage: bash run-local.sh <PERF dir>
   set -u
   source "$1/env.sh"; source "$PERF/lh.sh"
   [[ -n "${SPKI:-}" ]] || { echo "SPKI missing from env.sh"; exit 2; }
   curl -sk -o /dev/null "$L/login" || { echo "harness not running"; exit 2; }
   for i in 1 2 3 4 5; do
     lhrun local-login-sim  "$i" "$L/login"                                                    simulate "${LOCAL_CHROME[@]}" "${BLOCK[@]}"
     lhrun local-apply-sim  "$i" "$L/apply/e2e-company"                                        simulate "${LOCAL_CHROME[@]}" "${BLOCK[@]}"
     lhrun local-sign-sim   "$i" "$L/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock" simulate "${LOCAL_CHROME[@]}" "${BLOCK[@]}"
     lhrun local-verify-sim "$i" "$L/verify/e2e-token-1?e2eVerify=mock"                        simulate "${LOCAL_CHROME[@]}" "${BLOCK[@]}"
   done
   for i in 1 2 3; do
     lhrun local-apply-dt "$i" "$L/apply/e2e-company" devtools "${LOCAL_CHROME[@]}" "${BLOCK[@]}"
   done
   echo DONE
   ```
   - Run `source <PERF>/env.sh && bash "$PERF/run-local.sh" "$PERF" > "$PERF/run-local.log" 2>&1` in the background (about 15 min). It is done when the log ends with `DONE` and holds 23 `rc=0` lines.
   - Write the summariser `$PERF/summarize-lhr.mjs`. It was tested on the dry-run files and is used again in steps 6 and 9:
   ```js
   // Medians per page/condition from Lighthouse 13 JSON files named <group>-<run>.json.
   // Usage: node summarize-lhr.mjs <rawDir>
   import { readdirSync, readFileSync } from 'node:fs';
   import { join } from 'node:path';

   const dir = process.argv[2];
   const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
   const spread = (xs) => Math.max(...xs) - Math.min(...xs);
   const groups = new Map();
   for (const file of readdirSync(dir).filter((f) => /-\d+\.json$/.test(f) && !f.startsWith('psi-'))) {
     const lhr = JSON.parse(readFileSync(join(dir, file), 'utf8'));
     if (lhr.runtimeError) { console.log(`${file}: runtimeError ${lhr.runtimeError.code}`); continue; }
     const a = lhr.audits;
     const num = (id) => a[id]?.numericValue;
     const rs = Object.fromEntries(a['resource-summary'].details.items.map((i) => [i.resourceType, i]));
     // Lighthouse 13: the LCP subparts and element live in `lcp-breakdown-insight`.
     const lcpParts = a['lcp-breakdown-insight']?.details?.items || [];
     const phases = Object.fromEntries((lcpParts.find((t) => t.type === 'table')?.items || []).map((p) => [p.subpart, p.duration]));
     const lcpNode = lcpParts.find((t) => t.type === 'node');
     const reqs = a['network-requests'].details.items;
     const local = (u) => /^https?:\/\/127\.0\.0\.1[:/]/.test(u) || u.startsWith('data:') || u.startsWith('blob:');
     const isLocalRun = reqs.some((r) => /^https?:\/\/127\.0\.0\.1[:/]/.test(r.url));
     // The run's own --blocked-url-patterns, as Chrome matches them ('*' = anything, whole URL).
     const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
     const blocked = (lhr.configSettings.blockedUrlPatterns || []).map((p) => new RegExp(`^${p.split('*').map(esc).join('.*')}$`));
     // Lighthouse marks a failed request finished with statusCode -1, so neither field proves it stayed local.
     // A leak is any non-local request off the block list, and any blocked one that still got an answer.
     const leaked = isLocalRun ? reqs.filter((r) => !local(r.url)
       && (!blocked.some((re) => re.test(r.url)) || r.statusCode > 0)).map((r) => new URL(r.url).host) : [];
     const first = (re) => reqs.filter((r) => re.test(r.url)).sort((x, y) => x.networkRequestTime - y.networkRequestTime)[0];
     // The route's code: its screen chunk (/apply or /sandbox/apply) and the chunks requested with it.
     const route = first(/\/assets\/(PublicApplyHandler|SandboxApplyHandler)-/);
     const batch = route ? reqs.filter((r) => r.resourceType === 'Script'
       && r.networkRequestTime >= route.networkRequestTime && r.networkRequestTime - route.networkRequestTime <= 150) : [];
     const startupEnd = Math.max(...reqs.filter((r) => /\/assets\/(main|vendor)-|__\/firebase\/init\.json/.test(r.url)).map((r) => r.networkEndTime));
     const routeEnd = Math.max(...batch.map((r) => r.networkEndTime));
     const doc = reqs.find((r) => r.resourceType === 'Document');
     const row = {
       bench: lhr.environment.benchmarkIndex,
       method: lhr.configSettings.throttlingMethod,
       cpu: lhr.configSettings.throttling.cpuSlowdownMultiplier,
       fcp: num('first-contentful-paint'), lcp: num('largest-contentful-paint'),
       tbt: num('total-blocking-time'), mpfid: num('max-potential-fid'),
       cls: num('cumulative-layout-shift'), si: num('speed-index'),
       jsKB: rs.script.transferSize / 1024, jsReq: rs.script.requestCount,
       totalKB: rs.total.transferSize / 1024, totalReq: rs.total.requestCount,
       vendorKB: (first(/\/assets\/vendor-/)?.transferSize ?? 0) / 1024,
       ttfb: phases.timeToFirstByte, renderDelay: phases.elementRenderDelay,
       lcpSelector: lcpNode?.selector,
       // For checking the screen only. Never copy a label from a Testing run into the report.
       lcpLabel: (lcpNode?.nodeLabel || '').slice(0, 40),
       warnings: lhr.runWarnings.length,
       leaked: leaked.join(' '),
       // Waterfall: meaningful only for -dt- runs, whose request times are throttled.
       blank: doc ? num('first-contentful-paint') - doc.networkEndTime : undefined,
       gap: route ? route.networkRequestTime - startupEnd : undefined,
       routeDownload: route ? routeEnd - route.networkRequestTime : undefined,
       routeChunks: batch.length,
       firestoreStart: first(/firestore\.googleapis\.com/)?.networkRequestTime,
       fontStart: first(/\.woff2(\?|$)/)?.networkRequestTime,
     };
     const group = file.replace(/-\d+\.json$/, '');
     if (!groups.has(group)) groups.set(group, []);
     groups.get(group).push(row);
   }
   for (const [group, rows] of groups) {
     const out = { runs: rows.length };
     for (const key of Object.keys(rows[0])) {
       const vals = rows.map((r) => r[key]);
       out[key] = typeof vals[0] === 'number' ? Math.round(median(vals) * 1000) / 1000 : [...new Set(vals)].join(' | ');
     }
     out.lcpSpread = Math.round(spread(rows.map((r) => r.lcp)));
     if (typeof out.gap === 'number') out.potentialSaving = Math.min(out.gap, out.routeDownload);
     console.log(group, JSON.stringify(out));
   }
   ```
   - Run `source <PERF>/env.sh && node "$PERF/summarize-lhr.mjs" "$PERF/raw"`. Every `local-*` group must show:
     - `leaked` empty;
     - no `runtimeError` line;
     - the expected screen as `lcpLabel`: "Step 1 of 9: Personal Information" for `/apply`, "Contact our administration team…" for `/login`, the "By clicking \"I Agree - Proceed to Sign\"…" consent text for `/sign`, and "Under FMCSA 49 CFR Part 391.23…" for `/verify`.
   - If a check fails, stop and find out why. Do not record that run.
6. **Lighthouse on Testing**: real Hosting and the real backend, read-only pages only, no blocking flags and no SPKI flag.
   - Write `$PERF/run-testing.sh`:
   ```bash
   #!/usr/bin/env bash
   # Testing, read-only pages only. Usage: bash run-testing.sh <PERF dir> [sim-runs] [dt-runs] [first-run-number]
   set -u
   source "$1/env.sh"; source "$PERF/lh.sh"
   SIM="${2:-5}"; DT="${3:-3}"; FROM="${4:-1}"
   [[ "$T" == "https://truckerapp-system.web.app" ]] || { echo "T must be Testing"; exit 2; }
   [[ "$APPLY_PATH" =~ ^/(apply/[a-z0-9][a-z0-9_-]*|sandbox/apply)$ ]] || { echo "bad APPLY_PATH"; exit 2; }
   for ((i = FROM; i < FROM + SIM; i++)); do
     [[ "${SKIP_LOGIN:-}" == 1 ]] || { lhrun testing-login-sim "$i" "$T/login" simulate "${TEST_CHROME[@]}"; sleep 5; }
     lhrun testing-apply-sim "$i" "$T$APPLY_PATH" simulate "${TEST_CHROME[@]}"; sleep 5
   done
   for ((i = FROM; i < FROM + DT; i++)); do
     lhrun testing-apply-dt "$i" "$T$APPLY_PATH" devtools "${TEST_CHROME[@]}"; sleep 5
   done
   echo DONE
   ```
   - Run `source <PERF>/env.sh && bash "$PERF/run-testing.sh" "$PERF" > "$PERF/run-testing.log" 2>&1` in the background. That is 13 page loads, 5 s apart.
   - Each Lighthouse CLI run starts a fresh Chrome profile, so no stored draft or resume token can trigger a callable.
   - Summarise again. Each `testing-*` run must have:
     - no `runtimeError`;
     - an `lcpLabel` that is not an error or loading text ("Link Error", "Company not found.", "Unable to load application.", "Loading Platform...");
     - for `testing-apply-*`, `routeChunks` > 0 and a `firestoreStart` value.
   - If Chromium cannot reach Testing (certificate, proxy 403/407, or a blocked `firestore.googleapis.com`), read `/root/.ccr/README.md` in cloud sessions. Never pass `--ignore-certificate-errors` or the SPKI flag to a Testing run. If it still fails, use step 7 as the only Testing source and say so.
7. **PageSpeed Insights cross-check.** Google's servers run the same standard mobile settings. Write `$PERF/read-psi.cjs` (tested):
   ```js
   // Prints the lab numbers and any field data from one PageSpeed Insights reply.
   // Usage: node read-psi.cjs <psi.json>
   const j = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
   if (j.error) { console.log('error', j.error.code, j.error.message); process.exit(0); }
   const l = j.lighthouseResult;
   const v = (id) => Math.round(l.audits[id].numericValue * 1000) / 1000;
   const field = j.originLoadingExperience?.metrics
     ? Object.fromEntries(Object.entries(j.originLoadingExperience.metrics).map(([k, m]) => [k, m.percentile]))
     : 'no field data';
   console.log(JSON.stringify({
     lighthouse: l.lighthouseVersion, bench: l.environment.benchmarkIndex,
     fcp: v('first-contentful-paint'), lcp: v('largest-contentful-paint'),
     tbt: v('total-blocking-time'), cls: v('cumulative-layout-shift'), field,
   }));
   ```
   Make one call per URL, at least 60 s apart:
   ```bash
   source <PERF>/env.sh
   curl -sS --max-time 120 --get https://www.googleapis.com/pagespeedonline/v5/runPagespeed --data-urlencode "url=$T/login" \
     --data-urlencode strategy=mobile --data-urlencode category=performance -o "$PERF/raw/psi-testing-login.json"
   # wait 60 s, then, in the new shell:
   source <PERF>/env.sh
   curl -sS --max-time 120 --get https://www.googleapis.com/pagespeedonline/v5/runPagespeed --data-urlencode "url=$T$APPLY_PATH" \
     --data-urlencode strategy=mobile --data-urlencode category=performance -o "$PERF/raw/psi-testing-apply-1.json"
   node "$PERF/read-psi.cjs" "$PERF/raw/psi-testing-login.json"; node "$PERF/read-psi.cjs" "$PERF/raw/psi-testing-apply-1.json"
   ```
   - Proxy check: if PSI's `/apply` LCP differs from the `testing-apply-sim` median by more than 30%, either way, call PSI twice more for `/apply` (`psi-testing-apply-2.json`, `-3.json`, 60 s apart). Then use the PSI median for every FCP/LCP condition in step 12, and label `blank`, `gap` and `routeDownload` "proxy-affected".
   - If the API refuses (an `error` with code 429 or 403), ask the owner in Russian: "Откройте https://pagespeed.web.dev, вставьте ссылку и нажмите Analyze; на вкладке Mobile пришлите четыре числа: First Contentful Paint, Largest Contentful Paint, Total Blocking Time, Cumulative Layout Shift." Do this for both URLs.
   - Only if the owner allowed it (decision 3): make one call for `https://app.safehaul.io/login` and record its `field` value, the real users' p75 for the Production origin. CrUX reports CLS ×100. If there is none, record "no field data".
8. **Typing probe, on the local harness only.** Write `$PERF/typing-probe.cjs` (tested on Playwright 1.64.1). Run `source <PERF>/env.sh && node "$PERF/typing-probe.cjs" "$REPO" "$L" "$PERF/typing.json" > "$PERF/typing.log" 2>&1` in the background (about 6–12 min) and read the real exit status.
   - S1 types into step 1.
   - S2 types into the sixth employer row of Employment History, with six employers seeded: the heaviest re-render, since each keystroke re-renders all answers.
   - Each scenario runs at CPU 1x, 4x and 10x, 3 runs each, on Pixel 7 emulation.
   ```js
   // Keystroke responsiveness in the driver application. Local harness ONLY.
   // Usage: node typing-probe.cjs <repoRoot> <baseUrl> <outJson>   (env: RATES=1,4,10 REPEATS=3)
   const [repo, BASE, out] = process.argv.slice(2);
   const { chromium, devices } = require(`${repo}/node_modules/playwright`);
   const fs = require('node:fs');

   if (!/^https?:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('local harness only');
   const TEXT = 'Christopher Johnson';
   const employer = (i) => ({
     companyName: `Artificial Freight Co ${i + 1}`, address: '1 Test Way', city: 'Springfield', state: 'TX',
     phone: '5555550100', reasonForLeaving: 'Still employed', subjectToFmcsrs: 'yes', subjectToDotTesting: 'yes',
     startDate: `${2014 + i}-01-01`, endDate: `${2015 + i}-01`,
   });
   const SCENARIOS = [
     { id: 'S1-personal', step: 'Personal Information', seed: null,
       fields: ['#first-name', '#last-name', '#street', '#city'] },
     { id: 'S2-employment-6-rows', step: 'Employment History',
       seed: { lastStep: 5, employers: Array.from({ length: 6 }, (_, i) => employer(i)) },
       fields: ['#emp-street-5', '#emp-position-5', '#emp-supervisor-5'] },
   ];
   const RATES = (process.env.RATES || '1,4,10').split(',').map(Number);
   const REPEATS = Number(process.env.REPEATS || 3);

   async function once(scenario, rate) {
     const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
     try {
       const context = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: BASE.startsWith('https:') });
       // Only the local harness is reachable: no real backend, by construction.
       await context.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
       if (scenario.seed) {
         await context.addInitScript((seed) => localStorage.setItem('draft_e2e-company', JSON.stringify(seed)), scenario.seed);
       }
       await context.addInitScript(() => {
         window.__events = [];
         new PerformanceObserver((list) => {
           for (const e of list.getEntries()) {
             if (e.interactionId) window.__events.push({ id: e.interactionId, duration: e.duration });
           }
         }).observe({ type: 'event', durationThreshold: 16, buffered: true });
       });
       const page = await context.newPage();
       await page.goto(`${BASE}/apply/e2e-company`);
       await page.locator('#step-title').filter({ hasText: scenario.step }).waitFor({ timeout: 30_000 });
       const cdp = await context.newCDPSession(page);
       await cdp.send('Emulation.setCPUThrottlingRate', { rate });
       for (const selector of scenario.fields) {
         await page.locator(selector).click();
         await page.locator(selector).pressSequentially(TEXT, { delay: 150 });
       }
       await page.waitForTimeout(1500);
       const events = await page.evaluate(() => window.__events);
       const byInteraction = new Map();
       for (const e of events) byInteraction.set(e.id, Math.max(byInteraction.get(e.id) || 0, e.duration));
       const interactions = scenario.fields.length * (TEXT.length + 1); // keystrokes + one click per field
       // Unreported interactions were under 16 ms: count them as 0 so the ranks stay right.
       const all = [...byInteraction.values(), ...Array(Math.max(0, interactions - byInteraction.size)).fill(0)]
         .sort((a, b) => b - a);
       return {
         interactions,
         inpLike: all[Math.floor(interactions / 50)], // INP rule: skip one per 50 interactions
         worst: all[0],
         median: all[Math.floor(all.length / 2)],
       };
     } finally {
       await browser.close();
     }
   }

   (async () => {
     const results = [];
     for (const scenario of SCENARIOS) {
       for (const rate of RATES) {
         for (let run = 1; run <= REPEATS; run += 1) {
           results.push({ scenario: scenario.id, cpu: rate, run, ...(await once(scenario, rate)) });
           console.log(JSON.stringify(results.at(-1)));
         }
       }
     }
     fs.writeFileSync(out, JSON.stringify(results, null, 2));
   })().catch((error) => { console.error(error); process.exit(1); });
   ```
   If S2 does not reach "Employment History", or `#emp-street-5` is missing, check that the seed was accepted. Fix the seed's shape from `steps/Step6_Employment.coverage.test.jsx:28-33` rather than typing into another field, and record the change.
9. **Calibrate and extend**, while the harness still runs.
   - Let B be the median `bench` over all CLI runs of the session.
     - If 1,000 ≤ B ≤ 2,500, the standard 4x runs stand. The lower bound is Lighthouse's own slow-host line. Record B, and note the docs' reading: 1,000–1,500 is a low-end desktop, where 4x lands a little below a mid-tier phone; 1,500–2,000 is the docs' own 4x bracket.
     - Otherwise compute R = clamp(round(4 × B / 1,750), 2, 10) and R_LOW = clamp(round(10 × B / 1,750), 3, 20). Run `source <PERF>/env.sh && CPU=<R> SUFFIX=-cal SKIP_LOGIN=1 bash "$PERF/run-testing.sh" "$PERF" 5 3` (8 loads) and the probe with `RATES=1,<R>,<R_LOW>` into `typing-cal.json`. Decide on those rows and show both.
   - Spread rule, for decision rows only:
     - If `testing-apply-sim`'s `lcpSpread` is above 30% of its LCP median, run `source <PERF>/env.sh && SKIP_LOGIN=1 bash "$PERF/run-testing.sh" "$PERF" 4 0 6` (runs 6–9).
     - If `testing-apply-dt`'s is, run `source <PERF>/env.sh && SKIP_LOGIN=1 bash "$PERF/run-testing.sh" "$PERF" 0 2 4` (runs 4–5).
   - Hard cap: 27 Lighthouse loads of Testing in total (13 base + 4 + 2 + 8).
10. **Stop and clean up.**
   - `source <PERF>/env.sh && kill $(cat "$PERF/server.pid")`, then confirm `curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1:4320` prints `000`.
   - Delete the key: `source <PERF>/env.sh && rm "$PERF/key.pem"`.
   - `git status --short` must be empty before the docs edit: `dist/` is ignored, and `dist-e2e` lives in the scratchpad.
11. **Turn the owner's numbers into M4 figures.** From A–H compute:
   - first page = B−A (M4-2's (a));
   - next pages = C−B, D−C, E−D (all three, and their median: M4-2's (b));
   - three-letter search = F−E (M4-2's (c));
   - clear search = G−F (should be close to a first page);
   - one-letter search = H−G. Record it on its own; it never enters the M4 gate. Once M4-1 (two-letter minimum) is merged, a single letter sends no query, so a delta near 0 is then expected.

   Record each as "transferred" (compressed: what a slow phone downloads) and "resources" (uncompressed), in kB; convert MB as 1 MB = 1,000 kB. The first-page delta also includes the list's count queries. T1 does not measure M4-2's (d), opening E-Docs.
   - If a delta is 0 although new rows appeared, ask the owner to repeat steps 6–8 once, waiting 10 s per step.
   - With no answer, record M4 as "not measured" and leave its verdict open.
12. **Decide.** All values are medians, from the `-cal` rows when step 9 calibrated.

   | Follow-up | Decided from | GO | NO-GO | Otherwise |
   |---|---|---|---|---|
   | **T3** static loading placeholder in `index.html` for `/apply` | `testing-apply-dt` `blank` (FCP − end of the HTML response, the white-screen time) and `testing-apply-sim` FCP | `blank` ≥ 1,000 ms **or** FCP > 1,800 ms | `blank` < 500 ms **and** FCP ≤ 1,800 ms | OWNER (recommend NO-GO) |
   | **Earlier code download for `/apply`** (route code requested during start-up) | `testing-apply-dt` `potentialSaving` = min(`gap`, `routeDownload`); LCP of `testing-apply-sim` and `-dt` | `potentialSaving` ≥ 300 ms **and** either LCP > 2,500 ms | `potentialSaving` < 150 ms, **or** both LCPs ≤ 2,500 ms | OWNER (recommend NO-GO) |
   | **M4** lighter Applications list (#24) | owner deltas, compressed: median next-page delta (b) and the three-letter search delta (c); never the one-letter delta | M4-2's gate OPEN: next page > 300 kB **or** three-letter search > 1,000 kB (300 kB ≈ 1.5 s on slow 4G) | gate CLOSED: next page ≤ 300 kB **and** three-letter search ≤ 1,000 kB | none: the gate is OPEN or CLOSED |
   | **M5** fewer re-renders while typing (#26) | typing `inpLike`, median of 3 runs | > 200 ms at 4x (or R) in S1 **or** S2 (Google's "good" INP line) | ≤ 200 ms at 4x (or R) in both **and** ≤ 500 ms at 10x (or R_LOW) | OWNER (recommend NO-GO) |

   - Mark a verdict "(borderline)" when its deciding value is within ±15% of a threshold.
   - If step 7 found proxy distortion, use the PSI medians for FCP and LCP. A verdict that would flip on a "proxy-affected" value becomes OWNER.
   - Record without deciding: any page with CLS > 0.1; `/apply` simulate TBT > 600 ms; `fontStart` against FCP.
13. **Write `docs/qa/mobile-speed-baseline.md`**, in English, Russian summary first.
    - `> Кратко`: three plain Russian lines: what was measured, how many seconds the application page takes on a mid-range phone, and which follow-ups are worth doing.
    - `## Run facts`:
      - date (UTC), local SHA and Testing `/release.json` SHA;
      - Lighthouse 13.6.0, Chromium (`/opt/pw-browsers/chromium --version`) and Playwright versions;
      - B and the benchmarkIndex range, the throttling values (simulate and devtools, as above, and R/R_LOW if used);
      - runs per row, statistic = median (min–max);
      - the step 2 budget lines and worker size.
    - `## 1. Page load on a mid-range phone`:
      - Table A, Testing: `/login`, and `/apply/<test company>` or `/sandbox/apply`.
      - Table B, local: `/login`, `/apply/e2e-company`, the `/sign` mock, the `/verify` mock.
      - Columns: FCP, LCP, LCP element (CSS selector only), LCP render delay, TBT and Max potential FID (the lab responsiveness signals during load), CLS, Speed Index, JS transferred (kB / requests), total transferred, total requests.
      - Then:
        - the PSI rows and optional field data;
        - a calibration line comparing Testing `/login` with local `/login`, and the vendor transfer of each;
        - "what the local rows leave out": the auth check, the `public_profiles` round trip, the `getPublicEnvelope` and `getVerificationRequest` round trips, and the PDF plus the 289 kB worker after "I Agree".
    - `## 2. /apply start-up waterfall`: median `-dt-` values for HTML end, start-up end, route start and end, `routeChunks`, font start, first Firestore request, FCP, LCP, `blank`, `gap` and `potentialSaving`.
    - `## 3. Typing in the application`: scenario × CPU table of interactions, `inpLike`, worst and median.
    - `## 4. Recruiter Applications list — Firestore download`: action × compressed kB × uncompressed kB × rows, plus the approximate company size.
    - `## 5. Decisions`: step 12's table with the measured values, the rule applied and a verdict (GO / NO-GO / OWNER / not measured). T3, M4 and M5 read this section.
    - `## 6. Other observations`: facts only, no plans.
    - `## 7. How to repeat`: steps 1–12 condensed, with `serve-dist-h2.mjs`, `lh.sh`, `run-local.sh`, `run-testing.sh`, `summarize-lhr.mjs`, `read-psi.cjs` and `typing-probe.cjs` verbatim in fenced blocks. No tooling is added to the repository.

    Privacy rules:
    - No company slug or name, and no driver data.
    - No `lcpLabel` from a Testing run.
    - No Testing URL beyond `/login`, `/apply/<test company>` or `/sandbox/apply`. A Storage logo URL carries a download token.
    - No screenshots and no raw Lighthouse JSON.
    - No content of Testing's real `/__/firebase/init.json`.
    - The local fixture URLs (`e2e-company`, `e2e-token`) and the harness placeholder are fine.
14. **Index it.** Add one row after `README.md:383`: `| Driver pages on a phone: measured speed and follow-up decisions | [docs/qa/mobile-speed-baseline.md](docs/qa/mobile-speed-baseline.md) |`.
15. **Report.**
    - Open one PR titled "Docs: measured speed of the driver pages on a phone".
    - The description starts with **Кратко** in Russian: nothing changes for users; what was measured; the verdicts; the owner confirms the verdicts before T3, M4 or M5 starts.
    - The rest follows `.github/pull_request_template.md`:
      - In Evidence, tick only what ran. Delete the lint, unit and browser rows with the one-line reason "no code changed", and delete the UI section.
      - "What it touches": none.
      - Name the date and time of the Testing runs, which may show in Sentry as a few page-load or replay events.
    - Then send the owner a short Russian message with the verdicts.

## Tests

- No repository test is added or changed: the PR is documentation only. `npm test`, `npm run lint:frontend` and the Playwright suites do not apply; say so in the PR.
- Checks on the measurement, all of which must hold before a number enters the report:
  - Every local run has an empty `leaked` list.
  - Every run has the expected screen (steps 5 and 6) and no `runtimeError`.
  - Local `vendorKB` is within 5% of the Testing runs' `vendorKB`.
  - Runs per row: 5 simulate (9 after a spread extension) and 3 devtools (5); 3 per typing cell.
  - `run-local.log` and `run-testing.log` end with `DONE`, with every line `rc=0`. `typing.log` has no error, and the probe exited 0.
  - Totals on live sites: at most 27 Lighthouse loads of Testing and 5 PSI calls (2 base, 2 for the proxy check, 1 optional Production).

## Documentation to update in the same PR

- New: `docs/qa/mobile-speed-baseline.md`.
  - Committed rather than untracked: T3, M4 and M5 run in later sessions, and the scratchpad does not survive. The decisions must be traceable in the repository.
  - It holds only aggregated numbers and fixture URLs.
  - `docs/qa/` already holds the signing QA page (`README.md:383`).
  - The raw JSON, about 0.5 MB per run with screenshots and full URLs, stays in the scratchpad.
- `README.md`: one documentation-map row (step 14).
- No change to `docs/APP_BRIEF.md`: no behaviour changes, and its §13 budget text stays true. It is already over its 1,500-line warning limit (1,514 lines), so it gets no link. No change to `docs/OWNER_GUIDE.md`, `docs/RELEASE_CHECKLIST.md` or the design-system roadmap: nothing they describe changes.

## Verify before opening the PR

- `npm run build`, then `npm run check:bundle-budget`: already run in step 2; quote the output in Evidence.
- `npm run check:agent-docs`: it checks the instruction files, not README or `docs/qa/`. Run it once to show the PR touched none of them.
- `git status --short` shows only `README.md` (modified) and `docs/qa/mobile-speed-baseline.md` (new).
- Content scrub of the new file:
  - `grep -nE "AIza|firebasestorage|googleusercontent|invite=|[?&](r|recruiter|k|ref)=" docs/qa/mobile-speed-baseline.md` prints nothing.
  - `grep -n "token=" docs/qa/mobile-speed-baseline.md` shows only `token=e2e-token`.
  - `grep -n "<slug>"`, with the owner's slug, prints nothing.
  - Read the file once more for any company or driver name.
- Secret scan: gitleaks is not installed locally, so CI's `secret-scan` job on the PR is the gate. If it flags the report, remove or reword the line. Never touch `.gitleaks.toml`, whose lines `check:ci-plan` pins.
- Playwright suites: none, because no app code changed. Never run `npm run test:e2e` while the harness or the probe runs.
- Read the final `git diff` in full.

## Verify after merge (on Testing, read-only)

- Nothing changes in the app. A docs-only change selects no CI lane (`scripts/ci-plan-rules.mjs:113`). Confirm the `main` run for the merge commit finished green; there is no app behaviour to check.
- Owner: read the "Кратко" lines at the top of `docs/qa/mobile-speed-baseline.md`, and confirm or override each verdict in §5 before T3, M4 or M5 starts. Nothing needs clicking on Testing.

## Risks and safeguards

- **Writing to the shared backend by accident.**
  - Testing is loaded only at `/login` and `/apply/<slug>` (or `/sandbox/apply`), which only read on load. Lighthouse only navigates.
  - `run-testing.sh` refuses any other host or path, and the slug is validated twice.
  - Typing happens only locally, where `route()` aborts every other origin and the probe refuses a non-127.0.0.1 base.
  - `/sign`, `/verify`, `/review-change` and any `?invite=`/`?r=`/`?recruiter=`/`?ref=` link are never opened live.
- **Sentry noise.** The Testing runs may send a few page-load (20% trace sample, `src/lib/monitoring/sentry.js:31`), replay (10%) or CSP report-only events. The PR names the date and time.
- **The harness differs from Hosting.** It has no CDN, no auth check and mocked callables. So `/apply` decisions use the Testing rows, and the `/login` pair calibrates the gap. Local rows serve `/sign`, `/verify` (with their missing round trips listed) and typing, which depends on CPU, not network.
- **TLS.** The SPKI flag trusts only the throwaway key, and `ignoreHTTPSErrors` is harmless because every other origin is aborted. The key is deleted afterwards. Neither flag is ever used on Testing or Production, and the session proxy's TLS is never bypassed. If a reviewer rejects this, serve plain HTTP (`node:http`) and treat local rows as relative only: HTTP/1.1 added about 2 s of simulated LCP.
- **Secret scanner.** The report copies the harness script, so its placeholder `apiKey` is deliberately under 10 characters ('perf-only') and cannot match gitleaks' generic-key rule.
- **Noisy shared CPU and proxy latency.** These are handled by medians, the calibration and spread rules, the PSI cross-check and "(borderline)" labels.
- **Shell state.** Variables vanish between tool calls, so everything goes through `env.sh`, and every long run reports its exit code in its log.
- **The E2E build reaching users.** It is built only into the scratchpad, never `dist/`, and deploys come only from CI on `main`.
- **Privacy.** The owner sends numbers only, never screenshots. The report holds no driver data, slugs or tokens.
- **Rollback.** The PR only adds documentation; reverting its commit removes it.

## Done when (acceptance criteria)

- [x] The owner received the three-line Russian notice and the three requests before measuring started.
- [x] `docs/qa/mobile-speed-baseline.md` has every section from step 13. Its Run facts name both SHAs, Lighthouse 13.6.0, the Chromium and Playwright versions, B, the benchmarkIndex range and the throttling settings.
- [x] Table A has medians with min–max for Testing `/login` (5 runs) and Testing `/apply/<test company>` or `/sandbox/apply` (5 or 9), and says which path was used.
- [x] Table B has 5-run medians for local `/login`, `/apply/e2e-company`, the `/sign` mock and the `/verify` mock. Every local run had an empty `leaked` list.
- [x] §2 has devtools medians (3 or 5 runs) for Testing `/apply`: `blank`, `gap`, `routeDownload`, `potentialSaving`, `routeChunks`, and the font and Firestore start times.
- [x] §3 has S1 and S2 at 1x, 4x and 10x (plus R/R_LOW if calibrated), 3 runs each.
- [x] §4 has the owner's deltas, or says "not measured" with M4 left open.
- [x] §5 gives T3, earlier `/apply` code download, M4 and M5 each a verdict, the measured value and the rule applied, with borderline cases marked.
- [x] No `/sign`, `/verify`, `/review-change` or invite/recruiter/referral URL was loaded on a live site. At most 27 Lighthouse loads of Testing and 5 PSI calls were made.
- [x] The harness was stopped (port check prints `000`) and `key.pem` deleted.
- [x] The scrub greps pass. No screenshots, raw JSON, slugs, company names, driver data or tokens are in the repository.
- [x] `README.md` has the new row. `git status` showed only the two docs files.
- [x] One PR is open, starting with "Кратко", with an honest Evidence table. The owner received the verdicts in Russian.
