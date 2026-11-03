# X1a. Stop OCR from waiting forever when its engine cannot start

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** Extra task X1, outside the owner's list, first of two PRs. It came up while verifying #6 "Serve static files through a CDN" and #21 "Load third-party scripts after the page".
- **Size:** S · **Pull requests:** 1 · **Depends on:** none. No fixed order with T5b, which switches Sentry off: see the last bullet of step 3 · **Owner decision needed:** Do the extra task X1 at all? It is outside your list. Recommended: yes. This half is a small fix for a "Reading…" button that can spin forever, and it is the safety net for X1b.
- **Why it matters for users:** When a recruiter presses "Read the documents" for a scan or a photo, the browser runs OCR first. If the engine's English data cannot be downloaded, or the engine cannot start (jsDelivr is down, an office firewall blocks it, or a stricter security policy arrives later), the read never ends: the button stays on "Reading…" and the pages never reach the AI that reads images. After this change OCR gives up, within seconds when the engine reports an error and after one minute at most otherwise, and the read continues with the image-reading AI.

## Current behaviour (verified at 11626a6)

- `src/features/company-admin/applicationPrep/extraction/ocrFallback.js:36-37` awaits `createWorker('eng')` with no options and no time limit. `documentExtractionPipeline.js:102-110` falls back to page images only when that promise rejects (the `catch` is at `:107`).
- tesseract.js is 7.0.0 (`node_modules/tesseract.js/package.json`). `createWorker` rejects in two cases only: an error event from its worker script (`node_modules/tesseract.js/src/createWorker.js:44,47`) or a failed `load` job (`:213`).
- Every other start failure rejects only its own job, and the start-up chain at `createWorker.js:239-243` ends in `.catch(() => {})`, so the returned promise never settles:
  - a failed language download (`src/worker-script/index.js:142-145`, rejected at `:198-199`)
  - a failed engine initialisation (`:305-306`)
  - a WebAssembly compile that fails, which leaves `Core(...)` at `worker-script/index.js:46-59` with no answer at all
- Without an `errorHandler` option, every rejected job is also thrown on the page as an uncaught `Error(data)` (`createWorker.js:214-217`). Sentry's default global handlers are on (`src/lib/monitoring/sentry.js:42`: `integrations: []` keeps the defaults), so today these uncaught errors are the only signal Sentry gets about OCR failures.
- After a failed initialisation the worker sends `reject` and then `resolve` for the same job (`worker-script/index.js:305-312`). The second message finds no pending promise and throws `TypeError: Cannot read properties of undefined (reading 'resolve')` (`createWorker.js:206-208`). That is a library bug outside our code, and it stays after this change.
- Probe recorded during planning, in headless Chromium with a scratch Vite 8.3.5 build of tesseract.js 7.0.0, outside the repo:
  - (a) The language directory answered every request with the SPA's `index.html`, as Hosting's `**` rewrite (`firebase.json:52-57`) does for a missing file. After 20 s `createWorker` was still pending, and `errorHandler` had received `"initialization failed"`.
  - (b) The app's current policy (`firebase.json:47`), which has no `'wasm-unsafe-eval'`, was enforced. The WebAssembly compile was refused. After 60 s `createWorker` was still pending, and `errorHandler` was never called.
- `ApplicationAiPrepPanel.jsx:199-200` awaits `extractDocuments` with no timeout. The 120 s timeout at `:208` covers only the callable. While `state === 'reading'` the button is disabled and shows "Reading…" (`:289-298`).
- `documentExtractionPipeline.js:123` reads documents in parallel, so each scanned document starts its own engine.
- `ocrFallback.test.js:20,28` mocks `createWorker` and asserts the call `('eng')`. No test covers a start that never finishes. The only caller of `recognizePages` is `documentExtractionPipeline.js:4,71`.

## Scope

- In:
  - a bounded engine start in `ocrFallback.js`: an `errorHandler` plus a 60 s timer
  - terminating an engine that finishes starting after we gave up
  - one Sentry warning per failed start, replacing the uncaught error that `errorHandler` now suppresses
  - tests
  - one clause in the brief
- Out (do not do in this task):
  - where the engine files come from, and the CSP (both X1b)
  - a timeout on `worker.recognize` itself
  - reporting page-level recognition failures to Sentry
  - the one-worker-per-document parallelism (`documentExtractionPipeline.js:123`)
  - any UI or wording change in the panel
  - pinning or upgrading tesseract.js

## Read first

- `AGENTS.md` §1 and §3, and `.claude/skills/implement/SKILL.md` (follow every step).
- `.claude/rules/testing.md`, the Vitest section: defaults given at creation (`vi.fn(async () => x)`), `vi.resetAllMocks()` if any `*Once` is queued, and settle every promise a test starts.
- `docs/APP_BRIEF.md` §4 "Carrier-started applications" (heading at line 170), the document-reader paragraph at lines 194-203, and §9 lines 1080-1083.
- `node_modules/tesseract.js/src/createWorker.js:19-47,202-245` (start-up and message handling), `src/features/company-admin/applicationPrep/extraction/documentExtractionPipeline.js:65-113`, and `src/features/driver-app/components/application/publicApplySubmit.js:12,406-409` (the existing `Sentry.captureException` pattern with `tags`).
- Library docs: `npx ctx7@latest library tesseract.js "createWorker errorHandler"`, then `npx ctx7@latest docs /naptha/tesseract.js "createWorker errorHandler option"`. Context7 serves the v6.0.1 docs; the installed 7.0.0 source above is authoritative where they differ. If the ctx7 quota is exhausted, say so in the PR and cite that source.

## Implementation steps

1. Before you start, tell the owner in Russian, in at most three lines, what changes for users and what you will not touch (AGENTS.md §1). Create a branch from `main`.
2. Write the failing tests first, in `src/features/company-admin/applicationPrep/extraction/ocrFallback.test.js`:
   - Imports: `afterEach` added to the `vitest` import; `import { captureException } from '@sentry/react';`; `import { OCR_START_TIMEOUT_MS, recognizePages } from './ocrFallback';`.
   - Add `vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));`.
   - Start `beforeEach` with `vi.resetAllMocks()`, then rebuild the doubles with defaults given at creation: `` worker = { recognize: vi.fn(async (page) => ({ data: { text: `text of ${page}` } })), terminate: vi.fn(async () => undefined) } `` and `createWorker = vi.fn(async () => worker)`.
   - Add `afterEach(() => vi.useRealTimers())`. Queue no `*Once` values.
   - The new cases are:
   a. **'gives up when the engine reports that it cannot start'.** `createWorker = vi.fn((lang, oem, options) => { setTimeout(() => options?.errorHandler?.('initialization failed'), 0); return new Promise(() => {}); })`, then `await expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow(/could not start/)`. Give the case a per-test timeout of `2_000`, so on unchanged code it fails quickly instead of hanging.
   b. **'gives up after OCR_START_TIMEOUT_MS when the engine never answers'.** Call `vi.useFakeTimers()`, set `createWorker = vi.fn(() => new Promise(() => {}))`, hold `const reading = expect(recognizePages(['page-1'], { createWorker })).rejects.toThrow(/did not start in time/)`, then `await vi.advanceTimersByTimeAsync(OCR_START_TIMEOUT_MS)` and `await reading`. Per-test timeout `2_000`.
   c. **'shuts down an engine that finishes starting after it was given up on'.** Fake timers. `let resolveLate; createWorker = vi.fn(() => new Promise((resolve) => { resolveLate = resolve; }))`. Hold the rejection as in (b), advance by `OCR_START_TIMEOUT_MS`, await it, then call `resolveLate(worker)` inside the test and `await vi.advanceTimersByTimeAsync(0)`. Expect `worker.terminate` to have been called once and `worker.recognize` not at all.
   d. **'reports a failed start to Sentry once, as a warning'.** Use case (a)'s double. Expect `captureException` to have been called once, with `(expect.any(Error), expect.objectContaining({ level: 'warning', tags: { flow: 'document_reader', stage: 'ocr_start' } }))`.
   e. **'a page that fails after the start still rejects, and is not a failed start'.** `let options; createWorker = vi.fn(async (lang, oem, opts) => { options = opts; return worker; }); worker.recognize = vi.fn(async () => { options.errorHandler('bad page'); throw new Error('bad page'); })`. Expect `recognizePages` to reject, `worker.terminate` to have been called, and `captureException` not to have been called.
   - Update the existing assertion at `:28` to `expect(createWorker).toHaveBeenCalledWith('eng', undefined, expect.objectContaining({ errorHandler: expect.any(Function) }))`.
   - Run `npx vitest run src/features/company-admin/applicationPrep/extraction/ocrFallback.test.js` on the unchanged code. Record in the PR that (a) to (d) and the updated assertion fail (timeout, missing export or wrong arguments). Case (e) may already pass; it guards the new code.
3. Implement in `ocrFallback.js`:
   - Add `import * as Sentry from '@sentry/react';` (the pattern of `publicApplySubmit.js:12`; the module is in the lazy reader chunk, `ApplicationAiPrepPanel.jsx:20`, and Sentry is already loaded by then) and `export const OCR_START_TIMEOUT_MS = 60_000;`, with a one-line comment that a first OCR in a browser downloads about 4.5 MB.
   - Add a private `startWorker(createWorker)` and replace line 37 with `const worker = await startWorker(createWorker);`. Its shape:
   ```js
   async function startWorker(createWorker) {
       let started = false;
       let giveUp;
       const failed = new Promise((_, reject) => { giveUp = reject; });
       const pending = createWorker('eng', undefined, {
           // tesseract.js 7 settles createWorker only when its worker script or core
           // fails to load; a failed language download or engine start arrives here,
           // and without this option it is thrown as an uncaught error instead.
           errorHandler: (reason) => { if (!started) giveUp(new Error(`OCR could not start: ${reason}`)); },
       });
       const timer = setTimeout(() => giveUp(new Error('OCR did not start in time')), OCR_START_TIMEOUT_MS);
       try {
           const worker = await Promise.race([pending, failed]);
           started = true;
           return worker;
       } catch (reason) {
           started = true;
           const error = reason instanceof Error ? reason : new Error(`OCR could not start: ${reason}`);
           // A start that completes after we gave up still holds the WebAssembly heap.
           pending.then((late) => late?.terminate?.(), () => {});
           Sentry.captureException(error, { level: 'warning', tags: { flow: 'document_reader', stage: 'ocr_start' } });
           throw error;
       } finally {
           clearTimeout(timer);
       }
   }
   ```
   - Leave the second argument `undefined`: tesseract's default engine mode, LSTM only (`createWorker.js:19`); X1b makes it explicit. The `try/finally` that terminates a started worker (`:38-49`) stays unchanged.
   - If T5b PR 1 has merged (`package.json` has no `@sentry/react`; check again before you merge), import no Sentry here or in the test: T5b's `src/tests/noSentry.test.js` would fail, and the app has no other error reporter (`src/lib/monitoring/` holds only Sentry code). Use T5b's console pattern instead. Replace the `Sentry.captureException(...)` line with `console.error('[document reader] OCR could not start', error, { flow: 'document_reader', stage: 'ocr_start' })`. In the test, drop the `@sentry/react` import and mock, add `vi.spyOn(console, 'error').mockImplementation(() => {})` to `beforeEach`, and assert on that spy instead of `captureException`: (d) one call with `('[document reader] OCR could not start', expect.any(Error), { flow: 'document_reader', stage: 'ocr_start' })`, (e) none. Read "Sentry warning" in the rest of this file as that one log line.
4. Extend the header comment with a short "## A start that never finishes" section:
   - the cases in which tesseract.js 7 never settles, with the `createWorker.js` line references above
   - the known residue: in both never-settling cases tesseract.js returns no handle, so its worker stays alive until the tab closes; this happens only when the engine cannot start
   - that `errorHandler` also stops the library throwing uncaught errors for page failures after the start; those still reject `recognize`, and the fallback is the vision route, as before
5. In `docs/APP_BRIEF.md` §4 (line 195), change "else Tesseract OCR" to say that OCR which cannot start within a minute is skipped. The brief is already over its warning limit: 1,514 of 1,500 lines and 97,427 of 96,256 bytes (`scripts/agent-docs-limits.mjs:46`; for the brief `check:agent-docs` warns, it does not fail). Tighten the same paragraph so neither the line count nor the byte count grows. Never raise the limit.
6. Self-review against `/implement` §5: no unrelated lines, the timer is cleared on every path, and Sentry receives no document text, only the engine's status string.
7. Open the PR. The description starts with **Кратко**, then follows `.github/pull_request_template.md`. Under "What changed and why", say that start failures now reach Sentry as one tagged warning instead of an uncaught error, and that page failures after the start are no longer reported as uncaught errors. Under "What it touches": none. Delete the UI-only section. Draft:
   > Чтение сканов (OCR) больше не может зависнуть. Если движок распознавания не запустился за минуту или сообщил об ошибке, документы читаются дальше через AI по изображениям страниц.
   > Проверено: тесты распознавания (новые падали до исправления), сборка, бюджет загрузки.
   > Риск низкий: меняется только ожидание запуска OCR; сервер и данные не затронуты.
   > От владельца ничего не требуется.

## Tests

- `ocrFallback.test.js`: new cases (a) to (d) and the updated argument assertion fail before the change and pass after it. Case (e) guards that page errors after the start are not reported as start failures.
- These run unchanged and must stay green: `extraction/documentExtractionPipeline.test.js`, `ApplicationAiPrepPanel.test.jsx` and `ApplicationAiPrepPanel.lazyPipeline.test.jsx`, all under `src/features/company-admin/applicationPrep/`.
- `src/tests/mockResetHygiene.test.js` still passes: no `*Once` is queued, and the file resets with `vi.resetAllMocks()`.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md` §4 line 195: one clause, with no growth in lines or bytes.
- The `ocrFallback.js` header comment (step 4).
- `docs/OWNER_GUIDE.md`, `docs/RELEASE_CHECKLIST.md` and `docs/security-posture.md`: none. None of them describes OCR start-up. The design-system roadmap: none, nothing renders differently.

## Verify before opening the PR

- `npx vitest run src/features/company-admin/applicationPrep/`, then the full suite with `npm test -- --run` (CI runs `npm run test:coverage`).
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget`, `npm run check:source-size` and `npm run check:agent-docs`. For the last one, confirm the brief's line and byte figures did not grow.
- Browser smoke, optional: check that port 5000 is free (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`), then run `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e -- --project=chromium e2e/company-prepared-application.spec.cjs` in the background with a log and its PID. That suite renders the reader panel; it does not run OCR.

## Verify after merge (on Testing, read-only)

- Watch the `main` run to completion (`gh run list --branch main --limit 1`, then `gh run watch <id>`). Confirm the Testing deploy and `verify-shipped` succeeded.
- Nothing is visible on Testing while OCR works. The owner does not need to click anything. Production changes only when the owner promotes.

## Risks and safeguards

- Risk: a slow first download (about 4.5 MB) takes longer than 60 s, and the pages go to the vision AI instead. Several scanned documents read together start one engine each (`documentExtractionPipeline.js:123`) and share the bandwidth, which makes this likelier on a first read. Safeguard: the read still completes, only slower; the late engine is terminated as soon as it starts; and once one start succeeds, the data is in IndexedDB.
- Risk: a worker leaks in the never-settling cases. Safeguard: this happens only when the engine cannot start, at most once per document in the tab, and it is documented in the code comment.
- Risk: the Sentry signal changes shape. A failed start becomes one tagged warning; page failures after the start are no longer uncaught errors (the read falls back either way); the library's own `TypeError` after a failed initialisation still arrives as an uncaught error. That is expected: do not swallow it.
- Risk: `errorHandler` changes library behaviour. The `recognize` promise still rejects, so page errors still reach `documentExtractionPipeline.js:107`; case (e) pins this.
- Rollback: revert the PR. No data, backend or Hosting configuration changes.

## Done when (acceptance criteria)

- [ ] The new `ocrFallback.test.js` cases failed on unchanged `main` (recorded in the PR) and pass now.
- [ ] `recognizePages` rejects as soon as tesseract reports a failed start, and after at most `OCR_START_TIMEOUT_MS` when it never answers.
- [ ] Every started worker is terminated, including one that starts after the wait ended.
- [ ] One Sentry warning per failed start, tagged `flow: document_reader`, `stage: ocr_start`, with no document content.
- [ ] The brief's §4 sentence matches the behaviour, and the brief grew in neither lines nor bytes.
- [ ] Lint, unit tests, build, bundle budget, source-size and agent-docs pass. The PR description starts with **Кратко**.
