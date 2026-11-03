# Driver pages on a phone: measured speed and follow-up decisions

> **Кратко**
> 1. Замерили, как быстро открываются страницы водителя (вход, анкета, подпись, проверка работодателя) на «телефоне среднего уровня» с медленным 4G и как быстро отзывается ввод текста в анкете. В приложении ничего не менялось.
> 2. Анкета вашей компании на Testing полностью появляется примерно через 4,2 с по методу Google и через 8,4 с при честном замедлении сети, причём первые ~2,8 с экран белый. Ввод текста отзывается быстро: до 0,13 с на среднем телефоне и до 0,41 с на слабом.
> 3. Стоит делать: T3 (заставка вместо белого экрана) и раннюю загрузку кода анкеты. Не стоит: M5 (ввод и так быстрый). M4 не решён: ждём ваш замер списка заявок. Данные Google о реальных пользователях получить не удалось (лимит сервиса).

Task: [T1 in the performance plan](../performance-plan/T1-driver-pages-on-phone.md). This page holds
only aggregated numbers and local fixture URLs. The raw Lighthouse JSON stayed in the session
scratchpad and was not kept.

## Run facts

| Fact | Value |
|---|---|
| Date (UTC) | 2026-11-03. Local Lighthouse runs 12:55–13:02; Testing Lighthouse runs 13:03–13:26; typing probe 13:16–13:22 |
| Local SHA | Both builds came from `8e75190`, whose app code is identical to `11626a6` (the commits after `11626a6` change only `docs/` and `README.md`). Docs-only commits under `docs/performance-plan/` landed during the session (HEAD `2c664ad` at the end), so the app code is still `11626a6` |
| Testing `/release.json` SHA | `11626a63dff051565384699ec77e2e3813e69340`, built 2026-10-30T22:39:46Z |
| Tools | Lighthouse 13.6.0 (`npx lighthouse@13.6.0`), Chromium `/opt/pw-browsers/chromium` = Google Chrome for Testing 153.0.8010.12, Playwright 1.64.1, Node 22.22.0 |
| Host speed | B (median benchmarkIndex over all 40 Lighthouse runs) = **1,572.5**, range 1,176.5–1,980.5. B lies in 1,000–2,500, so the standard 4x runs stand and no calibrated (`-cal`) runs were made. 1,500–2,000 is the throttling docs' own bracket, where 4x lands on a mid-tier phone; B sits near its lower end |
| Simulate throttling | Lantern `mobileSlow4G`: RTT 150 ms, 1,638.4 kbit/s, CPU 4x |
| Devtools throttling | 562.5 ms request latency, 1,474.56 kbit/s down, 675 kbit/s up, CPU 4x |
| Typing probe | Pixel 7 emulation, CDP CPU throttling 1x, 4x and 10x, local harness, no network throttling |
| Runs per row | Testing `/login` simulate 5. Testing `/apply/<owner company>` simulate **9** (the spread rule added runs 6–9). Testing `/apply` devtools 3. Each local simulate row 5, local `/apply` devtools 3. Typing 3 per cell |
| Statistic | median (min–max) |
| Application page measured | `/apply/<owner company>` (the owner's own company, decision 1), opened with no query string |
| Bundle budget (`npm run build`, then `npm run check:bundle-budget`, both exit 0) | `first download: 303083 bytes gzip (ceiling 319000)` and `application page: 512981 bytes (ceiling 536000)` |
| `dist/pdf.worker.min.mjs` gzip | 288,718 B. The real `/sign` downloads it, plus the PDF, after "I Agree"; the mock never does |
| Sentry | The Testing loads (2026-11-03, 13:03–13:26 UTC) each sent 1–2 requests to Sentry's ingest host and may show as page-load or replay events |

## 1. Page load on a mid-range phone

Times are in ms and sizes in kB (transfer size / 1,024). "LCP render delay" comes from Lighthouse 13's
`lcp-breakdown-insight`, which reads the recorded trace. In simulate rows that trace is unthrottled,
so the render delay is not on the same scale as the simulated FCP and LCP. In devtools rows it is
throttled.

### Table A: Testing (real Hosting and the real backend, read-only pages)

| Page (method, runs) | FCP | LCP | LCP element (selector) | LCP render delay | TBT | Max potential FID | CLS | Speed Index | JS kB / requests | Total kB | Total requests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/login` (simulate, 5) | 1,065 (1,007–1,131) | 1,065 (1,007–3,335) | `div.max-w-sm > div.mt-12 > section.ds-card > p.text-ds-xs` | 1,170 (488–1,191) | 309 (219–458) | 201 (177–266) | 0 (0–0) | 2,527 (1,826–2,599) | 292.8 / 37 | 424.4 | 45 (45–46) |
| `/apply/<owner company>` (simulate, 9) | 1,076 (966–1,399) | 4,203 (1,032–4,638) | `button.ds-button > span.ds-button__content > span.flex > span.text-ds-sm` | 2,174 (1,244–2,198) | 364 (198–824) | 241 (171–372) | 0 (0–0) | 3,966 (2,013–4,094) | 386.6 / 75 | 521.4 | 86 (86–87) |
| `/apply/<owner company>` (devtools, 3) | 3,737 (3,711–3,789) | 8,372 (7,612–8,617) | same as above | 8,002 (7,250–8,258) | 736 (651–1,210) | 361 (267–536) | 0 (0–0) | 3,543 (3,388–3,580) | 387.5 / 75 | 521.8 | 86 (86–87) |

The simulate LCP on Testing is bimodal. On `/apply`, 4 of 9 runs fall at 1,032–1,113 ms, next to FCP,
and 5 fall at 4,203–4,638 ms. On `/login`, 4 of 5 runs equal FCP. The devtools runs throttle for real,
and they agree with each other (7.6–8.6 s).

### Table B: local harness (E2E-mode production build, HTTP/2, every external host blocked)

| Page (method, runs) | FCP | LCP | LCP element (selector) | LCP render delay | TBT | Max potential FID | CLS | Speed Index | JS kB / requests | Total kB | Total requests |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/login` (simulate, 5) | 923 (913–1,888) | 2,573 (919–3,358) | `div.max-w-sm > div.mt-12 > section.ds-card > p.text-ds-xs` | 326 (296–2,266) | 335 (286–777) | 213 (171–419) | 0 (0–0) | 927 (919–4,078) | 285.8 / 37 | 415.3 | 44 |
| `/apply/e2e-company` (simulate, 5) | 913 (906–949) | 3,374 (3,306–3,552) | `div.min-h-screen > main.ds-card > div.border-b > h1#step-title` | 718 (701–1,210) | 389 (371–621) | 178 (172–231) | 0 (0–0) | 1,958 (1,788–2,508) | 372.6 / 75 | 502.1 | 82 |
| `/apply/e2e-company` (devtools, 3) | 3,388 (3,307–3,408) | 6,292 (6,254–6,563) | same as above | 6,285 (6,236–6,556) | 839 (734–1,311) | 451 (426–529) | 0 (0–0) | 5,775 (5,735–5,989) | 372.6 / 75 | 502.1 | 82 |
| `/sign` mock (simulate, 5) | 918 (908–938) | 3,596 (3,574–3,613) | `main.flex > section.ds-card > div.ds-stack > p.text-ds-content-secondary` | 622 (614–1,546) | 263 (173–336) | 164 (123–195) | 0 (0–0) | 1,635 (1,577–2,645) | 405.5 / 53 | 537.0 | 61 |
| `/verify` mock (simulate, 5) | 926 (921–937) | 3,069 (3,008–3,098) | `section.ds-card > div.ds-notice > div.ds-notice__body > div.ds-notice__message` | 663 (632–678) | 223 (154–385) | 153 (123–215) | 0 (0–0) | 1,757 (1,707–1,929) | 294.1 / 42 | 423.6 | 49 |

Mock URLs: `/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock` and
`/verify/e2e-token-1?e2eVerify=mock`. Every local run showed the expected screen (step 1 of the
application, the login card, the signing consent text, the FMCSA verification notice), had no
`runtimeError` and had an empty `leaked` list.

### PageSpeed Insights and field data

| Call | Result |
|---|---|
| Testing `/login` (2026-11-03 13:14:45 UTC) | Refused: HTTP 429, the API's anonymous "Queries per day" quota was exhausted. No lab numbers |
| Testing `/apply/<owner company>` | Not called, because the same daily quota applies. Awaiting owner: the manual pagespeed.web.dev check (FCP, LCP, TBT, CLS on the Mobile tab) for both Testing URLs |
| Production `/login` field data (decision 3, one call, 13:15:48 UTC) | Refused: HTTP 429, same daily quota. Not retried, because the quota resets only at midnight Pacific. **Field data: not available** |

Because PSI returned no lab numbers, step 7's proxy cross-check could not run. Section 5 explains why no
verdict depends on it.

### Calibration: Testing `/login` against local `/login`

FCP 1,065 ms against 923 ms (Testing +142 ms). TBT 309 ms against 335 ms. The LCP medians (1,065 ms
against 2,573 ms) are not comparable, because both are bimodal (see Table A). HTML time to first byte is
345 ms on Testing (through the session proxy) against 8 ms locally. The vendor chunk transfer is
160,081–160,127 B on Testing and 159,997 B locally, within 0.1% (the check requires 5%). The
2026-10-30 audit recorded 160,191 B.

### What the local rows leave out

- The auth check: E2E mode skips it (`DataContext.jsx:95-118`).
- The `public_profiles` round trip on `/apply`: a fixture replaces it.
- The `getPublicEnvelope` round trip on `/sign` and the `getVerificationRequest` round trip on
  `/verify`: both mocks skip their callables.
- On `/sign`, the PDF plus the 289 kB worker (gzip) that load after "I Agree".

## 2. /apply start-up waterfall

Devtools runs (throttled request times), median (min–max) in ms from navigation start.

| Point | Testing `/apply/<owner company>` (3 runs) | Local `/apply/e2e-company` (3 runs) |
|---|---|---|
| HTML response end | 899 (896–915) | 585 (581–587) |
| Start-up end (`main`, `vendor`, `init.json`) | 3,162 (3,147–3,168) | 2,837 (2,812–2,872) |
| Route code requested (`PublicApplyHandler`) | 3,906 (3,876–4,008) | 3,433 (3,360–3,514) |
| Route code downloaded (batch end) | 5,608 (5,555–5,697) | 5,579 (5,200–5,600) |
| `routeChunks` (scripts requested within 150 ms of the route chunk) | 38 (38–38) | 38 (38–38) |
| Font requested | 3,730 (3,700–3,779) | 3,380 (3,299–3,400) |
| First Firestore request | 6,569 (5,970–6,637) | none (fixture) |
| FCP | 3,737 (3,711–3,789) | 3,388 (3,307–3,408) |
| LCP | 8,372 (7,612–8,617) | 6,292 (6,254–6,563) |
| `blank` (FCP − HTML end: white screen) | **2,841** (2,812–2,874) | 2,801 (2,726–2,824) |
| `gap` (route requested − start-up end) | **738** (729–846) | 621 (523–641) |
| `routeDownload` | 1,689 (1,680–1,701) | 2,167 (1,687–2,219) |
| `potentialSaving` = min(`gap`, `routeDownload`) | **738** | 621 |

On Testing, the first Firestore request starts about 1 s after the route code arrives (6,569 − 5,608 ms),
and LCP comes about 1.8 s after that request starts (8,372 − 6,569 ms).

## 3. Typing in the application

Local harness only. Each keystroke is 150 ms apart. `inpLike` follows the INP rule (skip one interaction
per 50). Values are in ms, median (min–max) of 3 runs.

| Scenario | CPU | Interactions | `inpLike` | Worst | Median |
|---|---|---|---|---|---|
| S1 step 1 (`#first-name`, `#last-name`, `#street`, `#city`) | 1x | 80 | 24 (16–24) | 24 (16–32) | 0 (0–0) |
| S1 | 4x | 80 | **88** (80–96) | 96 (88–104) | 40 (40–40) |
| S1 | 10x | 80 | **240** (216–336) | 296 (256–616) | 120 (120–120) |
| S2 Employment History, 6 employers, row 6 (`#emp-street-5`, `#emp-position-5`, `#emp-supervisor-5`) | 1x | 60 | 24 (24–32) | 32 (24–184) | 16 (16–16) |
| S2 | 4x | 60 | **128** (104–144) | 128 (112–144) | 72 (72–72) |
| S2 | 10x | 60 | **408** (304–464) | 560 (320–664) | 184 (176–200) |

The S2 seed (`draft_e2e-company` with `lastStep: 5` and six employers) was accepted as written: the
probe reached "Employment History" and found `#emp-street-5` in every run. The probe exited 0.

## 4. Recruiter Applications list — Firestore download

**Awaiting owner.** The owner's Chrome DevTools measurement (readings A–H, plan step 0) has not been
made yet, so none of these deltas exists. Rows will be filled in from the owner's numbers using plan
step 11.

| Action | Compressed kB ("transferred") | Uncompressed kB ("resources") | Rows |
|---|---|---|---|
| First page (B − A) | awaiting owner | awaiting owner | awaiting owner |
| Next page (C − B, D − C, E − D, and their median) | awaiting owner | awaiting owner | awaiting owner |
| Three-letter name search (F − E) | awaiting owner | awaiting owner | awaiting owner |
| Clear search (G − F) | awaiting owner | awaiting owner | — |
| One-letter search (H − G), never part of the M4 gate | awaiting owner | awaiting owner | awaiting owner |

Approximate company size: awaiting owner. M4-2's (d), opening E-Docs, is not measured by T1.

## 5. Decisions

| Follow-up | Measured value | Rule applied | Verdict |
|---|---|---|---|
| **T3** static loading placeholder in `index.html` for `/apply` | `testing-apply-dt` `blank` = 2,841 ms; `testing-apply-sim` FCP = 1,076 ms | GO when `blank` ≥ 1,000 ms **or** FCP > 1,800 ms. `blank` decides | **GO** |
| **Earlier code download for `/apply`** (route code requested during start-up) | `potentialSaving` = 738 ms (`gap` 738, `routeDownload` 1,689); LCP simulate 4,203 ms, devtools 8,372 ms | GO when `potentialSaving` ≥ 300 ms **and** either LCP > 2,500 ms. The devtools LCP alone meets the LCP half, so the bimodal simulate LCP does not matter | **GO** |
| **M4** lighter Applications list (#24) | none: the owner's deltas are awaited | M4-2's gate: OPEN when next page > 300 kB **or** three-letter search > 1,000 kB; CLOSED otherwise | **not measured**: gate neither OPEN nor CLOSED, verdict open |
| **M5** fewer re-renders while typing (#26) | `inpLike` at 4x: S1 88 ms, S2 128 ms. At 10x: S1 240 ms, S2 408 ms | NO-GO when ≤ 200 ms at 4x in both **and** ≤ 500 ms at 10x | **NO-GO** |

- None of these verdicts is borderline (±15% of a threshold). The closest value is M5's S2 at 10x, 408 ms,
  which is 18% under 500 ms.
- No calibration was needed (B = 1,572.5), so these are the standard 4x rows.
- Proxy: step 7's cross-check could not run, because PSI refused with 429. Neither GO depends on the
  Testing-only path through the session proxy. The local harness has no proxy, no CDN and no Firestore
  round trip, and on its own it gives `blank` 2,801 ms, `potentialSaving` 621 ms and devtools LCP
  6,292 ms. These meet the same GO thresholds.
- Recorded without deciding:
  - CLS: 0 on every page and run, so no page is above 0.1.
  - `/apply` simulate TBT: the median is not above 600 ms (Testing 364 ms, local 389 ms). Single runs
    reached 824 ms (Testing) and 621 ms (local).
  - `fontStart` against FCP: the font is requested at 3,730 ms on Testing (devtools), 7 ms before FCP at
    3,737 ms and 2,831 ms after the HTML response ends. Locally it is 3,380 ms against FCP 3,388 ms.

### T1-F result (local harness, devtools)

The apply screen's code is now requested by `src/app/startup/warmApplyScreen.js` as the entry's own
code starts, before React renders. Measured 2026-11-03 on the **local harness only**, `local-apply-dt`
(devtools throttling, 3 runs each), with §7 steps 3–5 unchanged: base `e3ec172` against the T1-F
change. Median (min–max) in ms. B was 1,697.5 for the base runs and 1,812.5 for the T1-F runs.

| Point | Base `e3ec172` | With T1-F |
|---|---|---|
| Route code requested | 3,503 (3,369–3,518) | 3,134 (3,071–3,383) |
| `gap` | 686 (576–702) | 327 (288–590) |
| `routeDownload` | 1,713 (1,469–1,714) | 1,445 (1,398–1,637) |
| `potentialSaving` | 686 | 327 |
| FCP | 5,573 (5,478–5,684) | 5,232 (4,969–5,240) |
| LCP | 5,573 (5,478–5,684) | 5,232 (4,969–5,240) |

- The request moved about 370 ms earlier and LCP about 340 ms. The rest of the `gap` comes before the
  entry's own code runs: in the build that code starts only after every chunk it imports has run,
  Firebase's config and SDK set-up included. Moving the request earlier still would mean changing
  `index.html` or the chunk layout.
- FCP equals LCP in every run of both columns: since T3 PR 2 the placeholder draws no words, so the
  first text painted is the step title. These rows are therefore not comparable with Table B's FCP.
- Bundle budget: first download 304,119 → 304,183 B gzip, application page 513,938 → 514,003 B.

## 6. Other observations

- Lighthouse warned "The page loaded too slowly to finish within the time limit. Results may be
  incomplete." on all 12 Testing `/apply` runs, both simulate and devtools. It gave no warning on Testing
  `/login` or on any local run. The warning appears only on the runs that make Firestore requests
  (3 per load).
- The LCP element differs between the two application pages. Testing `/apply/<owner company>` ends on a
  button on step 1 (`button.ds-button > …`), and the local fixture company ends on the step title
  (`h1#step-title`).
- Compared with the local harness, Testing `/apply` adds about 19 kB and 4 requests (Firestore and Sentry):
  521.4 kB / 86 requests against 502.1 kB / 82 requests.
- One `/apply` load requests 83 files from Testing Hosting and one `/login` load requests 45, all over
  HTTP/2. No Testing response was a 429 or 5xx.
- Testing HTML time to first byte through the session proxy was 345–362 ms (group medians), against
  about 8 ms on the local harness.
- During the local runs, Chromium's own background push-messaging service (`mtalk.google.com:5228`)
  opened connections through the session proxy. That is browser traffic, not page requests. No page
  request left 127.0.0.1: every `leaked` list was empty.
- The 2026-10-30 audit, at CPU 1x, recorded Testing `/login` at FCP 1,040 ms, LCP 3,494 ms and TBT 4 ms.
  At 4x it is now FCP 1,065 ms and TBT 309 ms.

## 7. How to repeat

Run one thing at a time, and nothing CPU-heavy while Lighthouse or the probe runs. Run long scripts in
the background with a log. Stop servers only by their saved PID. Everything lives in a scratchpad
folder `PERF`, never in the repository, and every command starts with `source <PERF>/env.sh`.

1. **Prepare.** Note `git rev-parse HEAD`. Create `$PERF/raw` and `env.sh`, holding `REPO`, `PERF`,
   `CHROME_PATH=/opt/pw-browsers/chromium`, `L=https://127.0.0.1:4320`,
   `T=https://truckerapp-system.web.app` and `APPLY_PATH=/apply/<owner company>` (or `/sandbox/apply`).
   Read `curl -sS "$T/release.json"`. Check that
   `curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1:4320` prints `000`.
2. **Static bytes.** Run `npm run build > "$PERF/build.log" 2>&1`, then
   `npm run check:bundle-budget | tee "$PERF/budget.txt"`, then `gzip -c dist/pdf.worker.min.mjs | wc -c`.
   Before the build, `git status --short -- public/pdf.worker.min.mjs` must print nothing; if it does, stop
   and keep your own edit. Only a change the build itself made may be undone afterwards, with
   `git checkout -- public/pdf.worker.min.mjs`.
3. **E2E-mode build into the scratchpad.** Run
   `env VITE_E2E_TEST_MODE=1 VITE_FIREBASE_API_KEY= VITE_FIREBASE_AUTH_DOMAIN= VITE_FIREBASE_PROJECT_ID= VITE_FIREBASE_STORAGE_BUCKET= VITE_FIREBASE_MESSAGING_SENDER_ID= VITE_FIREBASE_APP_ID= VITE_FACEBOOK_APP_ID= VITE_SENTRY_DSN= VITE_SUPER_ADMIN_EMAIL= VITE_DRIVER_APP_URL= VITE_SOCRATA_APP_TOKEN= npx vite build --outDir "$PERF/dist-e2e" --emptyOutDir`.
4. **Harness.** Create a throwaway EC P-256 certificate for `IP:127.0.0.1` with `openssl req -x509 …`,
   and append its SPKI SHA-256 (base64) as `SPKI` to `env.sh`. Start it with
   `nohup node "$PERF/serve-dist-h2.mjs" "$PERF/dist-e2e" 4320 "$REPO" "$PERF/cert.pem" "$PERF/key.pem"`
   and save the PID. Check three things: `$L/apply/e2e-company` answers `2 200` over `--http2`,
   `init.json` shows `perf-only`, and the vendor chunk with `Accept-Encoding: br` is 152,000–168,000 B.
5. **Local Lighthouse.** Run `bash "$PERF/run-local.sh" "$PERF"` (23 runs), then
   `node "$PERF/summarize-lhr.mjs" "$PERF/raw"`. Every run needs an empty `leaked` list, no
   `runtimeError` and the expected screen.
6. **Testing Lighthouse.** Run `bash "$PERF/run-testing.sh" "$PERF"` (13 loads, 5 s apart) and summarise.
   No `runtimeError`, no error or loading screen, and on `/apply` `routeChunks` > 0 and a `firestoreStart`.
7. **PSI.** Make one call per Testing URL, at least 60 s apart, and read each reply with `read-psi.cjs`.
   If PSI's `/apply` LCP differs from the simulate median by more than 30%, make two more `/apply` calls.
   On a 429 or 403, ask the owner for the pagespeed.web.dev numbers. With the owner's permission, make one
   call for `https://app.safehaul.io/login` for field data.
8. **Typing.** Run `node "$PERF/typing-probe.cjs" "$REPO" "$L" "$PERF/typing.json"` (S1 and S2 at 1x, 4x
   and 10x, 3 runs each).
9. **Calibrate and extend.** If B lies outside 1,000–2,500, compute
   R = clamp(round(4 × B / 1,750), 2, 10) and R_LOW = clamp(round(10 × B / 1,750), 3, 20), then run
   `CPU=<R> SUFFIX=-cal SKIP_LOGIN=1 bash run-testing.sh "$PERF" 5 3` and the probe with
   `RATES=1,<R>,<R_LOW>`. If a decision row's `lcpSpread` is above 30% of its median, run
   `SKIP_LOGIN=1 bash run-testing.sh "$PERF" 4 0 6` (simulate) or `… 0 2 4` (devtools). The cap is
   27 Testing loads.
10. **Clean up.** Run `kill $(cat "$PERF/server.pid")`, check that the port prints `000`, run
    `rm "$PERF/key.pem"`, and confirm `git status --short` is empty.
11. **Owner deltas.** First page = B − A. Next pages = C − B, D − C, E − D, and their median.
    Three-letter search = F − E. Clear = G − F. One-letter = H − G. Each is taken as compressed and as
    uncompressed kB, with 1 MB = 1,000 kB.
12. **Decide** with the table in section 5, using medians (the `-cal` rows if step 9 calibrated). Mark a
    value within ±15% of a threshold "(borderline)".

`serve-dist-h2.mjs`:

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

`lh.sh`:

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
  return "$rc"
}
```

`run-local.sh`:

```bash
#!/usr/bin/env bash
# Local harness only. Usage: bash run-local.sh <PERF dir>
set -eu  # a failed Lighthouse run (lhrun returns its status) stops the series
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

`run-testing.sh`:

```bash
#!/usr/bin/env bash
# Testing, read-only pages only. Usage: bash run-testing.sh <PERF dir> [sim-runs] [dt-runs] [first-run-number]
set -eu  # a failed Lighthouse run (lhrun returns its status) stops the series
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

`summarize-lhr.mjs`:

```js
// Medians per page/condition from Lighthouse 13 JSON files named <group>-<run>.json.
// Usage: node summarize-lhr.mjs <rawDir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const spread = (xs) => Math.max(...xs) - Math.min(...xs);
const files = readdirSync(dir).filter((f) => /-\d+\.json$/.test(f) && !f.startsWith('psi-'));
// A missing run makes the sample invalid too: each group must hold runs 1..N with no gap, and at least
// the planned 5 simulate or 3 devtools runs.
const runsOf = new Map();
for (const f of files) {
  const g = f.replace(/-\d+\.json$/, '');
  if (!runsOf.has(g)) runsOf.set(g, []);
  runsOf.get(g).push(Number(f.match(/-(\d+)\.json$/)[1]));
}
if (runsOf.size === 0) { console.error(`${dir}: no Lighthouse run files`); process.exit(1); }
for (const [g, ns] of runsOf) {
  const need = g.includes('-dt') ? 3 : 5;
  ns.sort((x, y) => x - y);
  if (ns[0] !== 1 || ns.length !== ns.at(-1) || ns.length < need) {
    console.error(`${g}: runs ${ns.join(',')}; expected 1..${Math.max(ns.at(-1), need)}`);
    process.exit(1);
  }
}
const groups = new Map();
for (const file of files) {
  const lhr = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  // A failed run makes the whole sample invalid: stop instead of taking a median of fewer runs.
  if (lhr.runtimeError) { console.error(`${file}: runtimeError ${lhr.runtimeError.code}`); process.exit(1); }
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

`read-psi.cjs`:

```js
// Prints the lab numbers and any field data from one PageSpeed Insights reply.
// Usage: node read-psi.cjs <psi.json>
const j = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
if (j.error) { console.log('error', j.error.code, j.error.message); process.exit(0); }
const l = j.lighthouseResult;
const v = (id) => Math.round(l.audits[id].numericValue * 1000) / 1000;
// URL-level field data first; the origin aggregate only when the URL has none, and labelled so.
const pick = (exp) => (exp?.metrics
  ? Object.fromEntries(Object.entries(exp.metrics).map(([k, m]) => [k, m.percentile]))
  : null);
const field = pick(j.loadingExperience)
  ?? (pick(j.originLoadingExperience) ? { origin: pick(j.originLoadingExperience) } : 'no field data');
console.log(JSON.stringify({
  lighthouse: l.lighthouseVersion, bench: l.environment.benchmarkIndex,
  fcp: v('first-contentful-paint'), lcp: v('largest-contentful-paint'),
  tbt: v('total-blocking-time'), cls: v('cumulative-layout-shift'), field,
}));
```

`typing-probe.cjs`:

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
