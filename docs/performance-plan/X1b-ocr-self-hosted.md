# X1b. Serve the OCR engine and its English data from our own site

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** Extra task X1, outside the owner's list, second of two PRs. Evidence comes from #6 "Serve static files through a CDN" and #21 "Load third-party scripts after the page".
- **Size:** M · **Pull requests:** 1 · **Depends on:** X1a. No fixed order with T5b, which switches Sentry off: the items marked (T5b) apply only if T5b PR 1 merged first · **Owner decision needed:** Should the OCR language file (2.9 MB, once per browser) also come from our own site instead of jsDelivr? Recommended: yes. Nothing outside our site remains, the CSP needs no exception, and the browser test runs offline. The cost is about 15 MB more per release on Hosting. If you answer no, jsDelivr stays for that one file only and `https://cdn.jsdelivr.net` is added to `connect-src`; the steps marked (lang) then change as noted.
- **Texts assume the recommended answer.** The drafted texts below (the `ocrAssets.js` and `ocrFallback.js` headers, the `docs/APP_BRIEF.md` §9 replacement and the PR description) assume `(lang)=yes`, as the batch plan does. If the owner answers no, rewrite each of them to say the English data still comes from jsDelivr, and keep jsDelivr in the CSP for it.
- **Why it matters for users:** Scanned documents and photos are read in the recruiter's browser by an OCR engine that today is downloaded from jsDelivr, an outside free CDN. When jsDelivr is slow, down or blocked by a company network, scans cannot be read in the browser; with X1a they then go to the slower AI route. The same dependency would break OCR the day our security policy is enforced. After this change everything comes from our own site, as the PDF viewer's worker already does.

## Current behaviour (verified at 11626a6)

- What the code does:
  - `ocrFallback.js:37` (after X1a: inside `startWorker`) passes no `workerPath`, `corePath` or `langPath`.
  - tesseract.js 7.0.0 therefore loads its worker from `https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js` (`node_modules/tesseract.js/src/worker/browser/defaultOptions.js:11`).
  - It loads its WebAssembly core from `https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0` (`src/worker-script/browser/getCore.js:14`). For LSTM-only mode it picks `relaxedsimd-lstm`, `simd-lstm` or `lstm` (`:26-42`); a `corePath` ending in `js` is used as one file (`:21-22`).
  - It loads English data from `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int` (`src/worker-script/index.js:130`), without a package version in the path.
  - The local build `dist/assets/src-BmUdCsRu.js` (17,252 B, tesseract's main-thread code) still carries the `tesseract.js@v` default.
  - No other source file names a CDN (grep for `jsdelivr`, `unpkg` and `cdnjs` under `src/` finds nothing).
- Where the comments are wrong:
  - `ocrFallback.js:18-22` says the worker and core are served from this origin. They are not.
  - It calls the data 11 MB. The file actually used is `4.0.0_best_int/eng.traineddata.gz`, 2,952,873 B; the 10.9 MB file is the legacy one, never requested in LSTM-only mode.
  - `ocrFallback.js:12` and `docs/APP_BRIEF.md:1082-1083` say the engine is about 2 MB. tesseract's main-thread code is 17 kB.
- How the worker runs: it starts from a `blob:` URL that calls `importScripts(workerPath)` (`node_modules/tesseract.js/src/worker/browser/spawnWorker.js:12-16`), so it runs under the page's own CSP. The three paths are made absolute against `window.location.href` before the worker starts (`src/utils/resolvePaths.js:5-13`). Image data URLs are decoded without a fetch (`src/worker/browser/loadImage.js:36-41`).
- The CSP today, at `firebase.json:47` (testing) and `:85` (production), identical: `script-src 'self' https://connect.facebook.net`. It has no `'wasm-unsafe-eval'`, and jsDelivr is in no directive. `src/tests/hostingConfig.test.js:256-262` pins identical targets, `:264-273` the script-src shape, `:295-296` `worker-src`, and `:299-322` reads the hardcoded addresses of three named files.
- Probe results recorded during planning (headless Chromium, scratch Vite 8.3.5 project outside the repo):
  - **Current policy enforced:** the WebAssembly compile is refused and OCR hangs.
  - **Report-only:** OCR works. The violation (`script-src`, `wasm-eval`) is dispatched inside the worker only; a listener on `document`, which is what `src/lib/monitoring/cspViolations.js:63-89` installs, received none. So Sentry has never shown OCR's violations.
  - **Self-hosted, policy enforced:** with the worker, the three LSTM cores and the best_int data on the same origin, under `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'`, OCR returned `ACME TRUCKING USDOT 123456` in about 1 s with no off-origin request. Chromium chose `tesseract-core-relaxedsimd-lstm.wasm.js`.
  - **Build and dev server:** `this.emitFile({ type: 'asset', fileName })` in `generateBundle` wrote the exact paths; a `configureServer` middleware served the same URLs on the dev server, and OCR worked there too.
  - **Playwright:** request events saw the worker's `importScripts` and `fetch` requests.
- Sizes (measured in `node_modules`):
  - `tesseract.js/dist/worker.min.js` is 111,307 B (33,569 B gzip).
  - Each `tesseract.js-core/*-lstm.wasm.js` core is about 3.9 MB (1.46 MB gzip); the WebAssembly is inlined as base64, so no separate `.wasm` fetch happens.
  - The data file is 2.95 MB. About 14.8 MB would be added to `dist` (7.2 MB today).
- Caching: Hosting serves app files on its one-hour default (`docs/APP_BRIEF.md` §10, lines 1176-1180, pinned by `hostingConfig.test.js:340-350`). tesseract caches the language data in IndexedDB under `./eng.traineddata` whatever `langPath` is (`src/worker-script/index.js:112,181`; `browser/cache.js:3-11`), and detects gzip by its magic bytes (`index.js:161-166`).
- The precedent: the pdf.js worker is a committed copy in `public/` (`src/lib/pdf/pdfWorker.js:9-10,20`), refreshed by `prebuild` (`package.json:11`) and version-pinned by `src/tests/pdfWorkerWiring.test.js:56-59`. It is the only source-size exclusion (`scripts/source-size-scope.mjs:193-199`). Committing about 15 MB of tesseract files would need a second exclusion and a new tracked format (`.gz`). So this task keeps pdf.js's rules (own origin, versioned with the dependency, pinned by a test) but copies the files at build time instead of committing them.
- The language package: `@tesseract.js-data/eng` is not installed. On npm it has versions 0.1.0 and 1.0.0 (latest), MIT, 13.9 MB unpacked, 5 files, `main: index.js` and no `exports` map, so a deep file can be resolved.
- `tesseract.js-core` 7.0.0 is installed at the top of `node_modules` as a dependency of tesseract.js (`tesseract.js/package.json`: `"tesseract.js-core": "^7.0.0"`).
- `.storybook/main.js:15-17,76-77` drops app-only plugins by name. The Playwright web server is the dev server (`playwright.config.cjs:96-104`, `npm run dev`).
- No `e2e/*.spec.cjs` exercises OCR.
- Context7 `/naptha/tesseract.js` (v6.0.1 docs): `corePath` must be a directory holding the core builds, and pointing it at one file is "strongly discouraged"; `langPath` takes no trailing slash; `errorHandler` and `workerBlobURL` are options; `cachePath` only changes the IndexedDB key in a browser.

## Scope

- In:
  - Serve under `/ocr/tesseract-<tesseract.js version>/`, from `node_modules`, in both the build and the dev server: `worker.min.js`, the three LSTM-only cores, and (lang) `eng.traineddata.gz`.
  - Pass those paths and the engine mode to `createWorker`.
  - Add `'wasm-unsafe-eval'` to `script-src` on both app targets.
  - Keep the Storybook catalog free of these files.
  - Unit, config and E2E tests; the code comments; the brief §9; `security-posture.md`.
- Out (do not do in this task):
  - enforcing the CSP, or forwarding worker violations to Sentry
  - any `Cache-Control` rule (the §10 one-hour decision stays)
  - upgrading tesseract.js or tesseract.js-core
  - the non-LSTM (legacy) cores and data
  - pdf.js's own handling
  - one worker per document
  - any UI change

## Read first

- `AGENTS.md` §1-§3, `.claude/skills/implement/SKILL.md`, `.claude/rules/release-pipeline.md` (this task touches `firebase.json`: rules 4 and 5), `.claude/rules/source-size.md` and `.claude/rules/testing.md` (one Playwright suite at a time, the port check, `PW_CHROMIUM_EXECUTABLE`, background runs).
- `docs/APP_BRIEF.md` §9 lines 1080-1083, §10 lines 1169-1180 (the CSP and the one-hour cache) and §13.
- `docs/security-posture.md` lines 228-264, "Browser headers on the application sites".
- `src/lib/pdf/pdfWorker.js`, `src/tests/pdfWorkerWiring.test.js`, `vite.config.js` (the inline `preloadFirebaseConfig` plugin at lines 45-62 and the plugin list at 64-68), `src/tests/viteBuildConfig.test.js:34-43`, `src/tests/hostingConfig.test.js:210-355`, `.storybook/main.js:10-17,61-77` and `.github/dependabot.yml`.
- E2E patterns:
  - `e2e/company-prepared-application.spec.cjs:245-292`: reaching the reader with `?e2eAuth=company_admin&e2eUnfinished=mock`, "Start an application", then `mode-ai`.
  - `e2e/guest-cdl-autofill.spec.cjs:69-73,121`: `setInputFiles` with a buffer, and waiting for `data-upload-state`.
  - `e2e/guest-referral-intake.spec.cjs:10-18`: capturing a callable's body with the CORS preflight answered.
  - `src/features/driver-app/hooks/useGuestFileUpload.js:51,65-86`: the E2E upload double. No Storage write happens in E2E mode.
- Library docs: `npx ctx7@latest library tesseract.js "self-host workerPath corePath langPath"`, then `npx ctx7@latest docs /naptha/tesseract.js "self-hosting worker, core and language data: workerPath, corePath, langPath"`. The installed 7.0.0 source wins where they differ. If the quota is exhausted, say so and cite `node_modules/tesseract.js/src/**`.

## Implementation steps

1. Before you start, tell the owner in Russian, in at most three lines, what changes for users and what you will not touch. Confirm X1a is merged (`startWorker` exists in `ocrFallback.js`). Create a branch from `main`.
2. (lang) Run `npm install @tesseract.js-data/eng@^1.0.0`. It goes in `dependencies`, next to `tesseract.js`; only `package.json` and `package-lock.json` change. Check that `node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` exists, is 2,952,873 bytes and starts with the gzip bytes `1f 8b` (`xxd -l 2`). If the file or its path differs, stop and report: the plan's paths depend on it.
3. Write the first failing test, `src/features/company-admin/applicationPrep/extraction/ocrAssets.test.js` (new), with `// @vitest-environment node`, `createRequire(import.meta.url)` and `readFileSync`:
   - `OCR_ASSET_BASE === '/ocr/tesseract-' + require('tesseract.js/package.json').version`.
   - `OCR_ENGINE_MODE === require('tesseract.js/src/constants/OEM.js').LSTM_ONLY`.
   - Every core name that `tesseract.js/src/worker-script/browser/getCore.js` builds for LSTM-only mode (match `/tesseract-core[A-Za-z-]*-lstm[.]wasm[.]js/g`; expect at least 3 distinct names) is a key `core/<name>` of `OCR_ASSET_FILES`. Use `toHaveProperty([key])`, the array form, because the keys contain dots.
   - (lang) `tesseract.js/src/worker-script/index.js` contains `@tesseract.js-data/` and `4.0.0_best_int`, and the `lang/` entry's source lives in that directory.
   - Every source path resolves (`require.resolve`) and exists.
   - `ocrFallback.js` and `ocrAssets.js` contain no `https://`, and the three paths start with `OCR_ASSET_BASE`. (lang)=no: `ocrAssets.js` names exactly one `https://` origin, in `OCR_LANG_PATH` only.
   Run it: it fails because the module is missing. Record that.
4. Create `src/features/company-admin/applicationPrep/extraction/ocrAssets.js`. It holds plain constants and no imports, because `vite.config.js` reads it in Node. Its header comment states the no-CDN rule and points to `pdfWorker.js`, the Vite plugin and the test. The module:
   ```js
   export const OCR_ASSET_BASE = '/ocr/tesseract-7.0.0';
   export const OCR_WORKER_PATH = `${OCR_ASSET_BASE}/worker.min.js`;
   /** A directory: tesseract.js picks the build this browser supports. */
   export const OCR_CORE_PATH = `${OCR_ASSET_BASE}/core`;
   export const OCR_LANG_PATH = `${OCR_ASSET_BASE}/lang`;
   /** tesseract.js OEM.LSTM_ONLY, its default: the cores below are the LSTM-only builds. */
   export const OCR_ENGINE_MODE = 1;
   /** Each served file under OCR_ASSET_BASE, by the installed file it is copied from. */
   export const OCR_ASSET_FILES = {
       'worker.min.js': 'tesseract.js/dist/worker.min.js',
       'core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
       'core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
       'core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
       'lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
   };
   ```
   (lang)=no: drop the `lang/` entry and set `OCR_LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'`. Run `ocrAssets.test.js` again: it passes.
5. Write the remaining failing tests, and run each on the unchanged app to see it fail:
   a. `ocrFallback.test.js`: change the argument assertion to `('eng', OCR_ENGINE_MODE, expect.objectContaining({ workerPath: OCR_WORKER_PATH, corePath: OCR_CORE_PATH, langPath: OCR_LANG_PATH, errorHandler: expect.any(Function) }))`, importing the constants from `./ocrAssets`.
   b. `src/tests/viteBuildConfig.test.js`, a new case 'serves the OCR engine from this site, in the build and on the dev server':
      - Find `plugins.find((p) => p?.name === 'safehaul:ocr-assets')`.
      - Call `generateBundle.call({ emitFile })` with a collecting `emitFile`. Expect exactly the keys of `OCR_ASSET_FILES` as `fileName`s under `OCR_ASSET_BASE.slice(1)`, each with `type: 'asset'` and bytes equal (`Buffer.compare(...) === 0`) to the installed file.
      - Call `configureServer({ middlewares: { use: (fn) => { handler = fn; } } })`. A request for `${OCR_WORKER_PATH}?v=1` gets `Content-Type` `text/javascript; charset=utf-8` and a body; a request for `/src/main.jsx` calls `next()`.
      - `buildStart.call({ error: (message) => { throw new Error(message); } })` does not throw.
   c. `src/tests/hostingConfig.test.js`, inside the "application sites: framing and Content Security Policy" block, a new case: `expect(reportOnly['script-src']).toContain("'wasm-unsafe-eval'")`, and `allows(reportOnly[d], 'https://cdn.jsdelivr.net')` is `false` for `script-src` and `connect-src`. Comment: the OCR blob worker inherits this policy and compiles WebAssembly, and its violations fire inside the worker, where `cspViolations.js` never hears them. (T5b) `cspViolations.js` is gone: end the comment after "compiles WebAssembly". The existing case at `:264-273` keeps passing, because `'unsafe-eval'` is a different token. (lang)=no: assert `connect-src` allows it instead, and add `['src/features/company-admin/applicationPrep/extraction/ocrAssets.js', 'connect-src']` to the expectations list of 'allows every external address the app hardcodes' (`:304-308`), the existing pattern.
   d. A new E2E spec, `e2e/application-prep-ocr.spec.cjs`. Its header comment says all text is artificial, the upload is the E2E double, and the callable is answered by the test:
      - `test.describe.configure({ timeout: 90_000 })`. In `beforeEach({ context })`: `context.route('https://cdn.jsdelivr.net/**', (route) => route.abort())`, and a watcher on `context.on('request', …)` that keeps the pathnames starting with `/ocr/` and every URL on host `cdn.jsdelivr.net`.
      - Helper `artificialScan(context)`: open a second page, `setContent` ten lines of artificial report text, at least 400 characters in total (well above `MIN_CHARS_PER_DOCUMENT = 200`, `pdfTextLayer.js:25`, so OCR losses cannot drop it below), in black 32px Arial on white. Take `screenshot({ fullPage: true })` for the PNG. Then `setContent('<img src="data:image/png;base64,…" style="width:100%">')` and `pdf({ format: 'Letter' })` for an image-only PDF with no text layer, then close the page. `page.pdf()` exists only in Chromium; the spec runs in the `chromium` project and carries no `@mobile` tag.
      - Helper `captureCallable(page)`, after `guest-referral-intake.spec.cjs:10-18`: `page.route('**/extractCompanyApplicationDocuments', …)` answers `OPTIONS` with `204` and the `CORS` headers and records nothing; for the `POST` it pushes `route.request().postDataJSON()?.data` and fulfils `status: 500` with the `CORS` headers and `{"error":{"status":"INTERNAL","message":"answered by the test"}}`. Without the preflight branch the browser's `OPTIONS` would be recorded as an empty body.
      - Test 'a scanned PDF is recognised in the browser, from this site':
        - Open `/company/drivers/unfinished?e2eAuth=company_admin&e2eUnfinished=mock`, click the "Start an application" button, then `getByTestId('mode-ai')`.
        - `const field = page.locator('[data-upload-field="psp-report-upload"]')`; `field.locator('input[type="file"]').setInputFiles({ name: 'artificial-psp.pdf', mimeType: 'application/pdf', buffer })`. `FileInput` puts `name` and the other props on the real input (`src/design-system/components/file-input/FileInput.jsx:327-328`). Wait for `expect(field).toHaveAttribute('data-upload-state', 'uploaded')`.
        - Expect `getByTestId('read-documents')` to have text `Read 1 document`, then click it.
        - `await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1)`. Then `sent[0].documents.psp.text` must contain words from the image, and the `/ocr/` list must contain `worker.min.js`, one `core/tesseract-core-…-lstm.wasm.js` and (lang) `lang/eng.traineddata.gz`.
        - The jsDelivr list must be `[]`, and the read button must be enabled again.
      - Test 'a photo is recognised in the browser, from this site': the same with the PNG (`mimeType: 'image/png'`) in `[data-upload-field="medical-card-upload"]`, asserting `sent[0].documents.medical.text`.
      - (lang)=no: the jsDelivr route must let exactly `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/**` through, so the spec depends on the internet, and the jsDelivr list must contain only that URL.
      - Run it on the unchanged app: check that port 5000 is free first, then `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e -- --project=chromium e2e/application-prep-ocr.spec.cjs` in the background with a log and its PID. It must fail: the worker is requested from the aborted jsDelivr, X1a's start fails, the callable receives `documents.psp.pages` instead of text, and no `/ocr/` request appears. Record the failure in the PR. Do not edit app files while it runs.
6. In `ocrFallback.js`, import the three paths and `OCR_ENGINE_MODE` from `./ocrAssets`. In `startWorker`, call `createWorker('eng', OCR_ENGINE_MODE, { workerPath: OCR_WORKER_PATH, corePath: OCR_CORE_PATH, langPath: OCR_LANG_PATH, errorHandler })`. Do not set `cachePath`: it is the IndexedDB key, and changing it would make every browser download the data again. Keep `workerBlobURL` at its default. Rewrite header lines 12-22 with true facts:
   - tesseract's own code is a 17 kB lazy chunk, and its worker is 111 kB
   - the browser fetches one core of about 1.5 MB compressed
   - the English data is the 2.9 MB LSTM-only file, cached in IndexedDB after the first document
   - all of it is served by this site under `OCR_ASSET_BASE`, never a CDN: the pdf.js rule
7. In `vite.config.js`:
   - Add `import { readFileSync } from 'node:fs'`, `import { createRequire } from 'node:module'`, `import { OCR_ASSET_BASE, OCR_ASSET_FILES } from './src/features/company-admin/applicationPrep/extraction/ocrAssets.js'` and `const requireFromRoot = createRequire(import.meta.url);`.
   - Add the inline plugin below, with a comment saying why it exists, and register it: `plugins: [react(), splitGlyphRegistry(), preloadFirebaseConfig(), serveOcrAssets()]` (line 68). Rewrite the comment at lines 65-67, which says "In the build only": the new plugin also runs on the dev server, so the OCR engine has the same URLs in dev, in the E2E run and on Hosting.
   ```js
   function serveOcrAssets() {
     const files = Object.entries(OCR_ASSET_FILES).map(([served, source]) => ({
       url: `${OCR_ASSET_BASE}/${served}`,
       path: requireFromRoot.resolve(source),
       type: served.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/gzip',
     }));
     return {
       name: 'safehaul:ocr-assets',
       buildStart() {
         const { version } = requireFromRoot('tesseract.js/package.json');
         if (OCR_ASSET_BASE !== `/ocr/tesseract-${version}`) this.error(`OCR_ASSET_BASE is ${OCR_ASSET_BASE} but tesseract.js ${version} is installed: update ocrAssets.js`);
       },
       configureServer(server) {
         server.middlewares.use((req, res, next) => {
           const file = files.find((entry) => entry.url === (req.url || '').split('?')[0]);
           if (!file) return next();
           res.setHeader('Content-Type', file.type); // importScripts refuses a non-JavaScript type
           res.end(readFileSync(file.path));
         });
       },
       generateBundle() {
         for (const file of files) this.emitFile({ type: 'asset', fileName: file.url.slice(1), source: readFileSync(file.path) });
       },
     };
   }
   ```
   The file grows from 118 lines to about 160, under the 500-line warning. `vitest.config.js` does not load `vite.config.js`, so unit tests are unaffected; `viteBuildConfig.test.js` imports it directly.
8. In `.storybook/main.js`, add `'safehaul:ocr-assets'` to `APP_BUILD_ONLY_PLUGINS` (lines 15-17), and extend the comments at lines 10-14 and 71-72 to say the catalog does not ship the OCR files.
9. In `firebase.json`, change `script-src 'self' https://connect.facebook.net` to `script-src 'self' 'wasm-unsafe-eval' https://connect.facebook.net` at line 47 (testing) and line 85 (production), identically; 'ships the same policy to testing and production' enforces it. (lang)=no: also add `https://cdn.jsdelivr.net` to `connect-src` on both. Add no other origin and no `Cache-Control`.
10. Run the new E2E spec again (step 5d command). It must pass. If the dev server logs that it optimised `tesseract.js` mid-run and reloads the page, add `'tesseract.js'` to `optimizeDeps.include` (`vite.config.js:102`) with a comment like the exceljs one, and run it again.
11. Update the documentation listed below.
12. Read the final diff in full and self-review against `/implement` §5:
    - every path is identical in the build and in dev
    - nothing is committed under `public/` and no `.gz` file is tracked
    - no `Cache-Control` was added, and both targets are identical
13. Open the PR. The description starts with **Кратко**, then follows the template; delete the UI-only section. Under "What it touches" write: Hosting headers (CSP report-only, both targets), a new dependency (lang), no backend, no rules, no indexes, no data. Draft:
    > Движок распознавания сканов (OCR) и его английские языковые данные теперь загружаются с нашего сайта, а не с чужого CDN jsDelivr; политика безопасности разрешает ему работать.
    > Проверено: тесты, сборка, бюджет загрузки, новый браузерный тест чтения скана PDF и фото без доступа к jsDelivr (до исправления он падал).
    > Риск низкий: при сбое чтение уходит в AI по изображениям, как сейчас; каждая версия сайта станет примерно на 15 МБ больше.
    > От владельца: по желанию после слияния проверить «Read the documents» на тестовой фотографии на Testing; Production меняется только при продвижении.

## Tests

- `ocrAssets.test.js` (new): fails before step 4 (the module is missing). Afterwards it pins the version, the engine mode, the core variants against `getCore.js`, the data directory, that the files exist, and that no CDN is named.
- `ocrFallback.test.js`: the argument assertion fails before step 6; X1a's cases keep passing.
- `viteBuildConfig.test.js`: the new case fails before step 7 (no such plugin).
- `hostingConfig.test.js`: the new case fails before step 9. All existing cases still pass, including no `Cache-Control` (`:340-350`) and identical targets (`:256-262`, `:352-354`).
- `pdfWorkerWiring.test.js`, `documentExtractionPipeline.test.js` and both `ApplicationAiPrepPanel*.test.jsx`: unchanged and green.
- `e2e/application-prep-ocr.spec.cjs` (new): fails on the unchanged app (step 5d) and passes after steps 6-7.

## Documentation to update in the same PR

- The `ocrFallback.js` header comment (step 6), the `ocrAssets.js` header, and the `vite.config.js` and `.storybook/main.js` comments.
- `docs/APP_BRIEF.md` §9, lines 1080-1083: replace the wrong "~2MB" sentence with: tesseract.js is imported lazily, and its worker, WebAssembly core and English data are served by this site under `/ocr/tesseract-<version>/` (`ocrAssets.js`, `vite.config.js`), never a CDN. The brief is already over its warning limit (1,514 of 1,500 lines, 97,427 of 96,256 bytes): keep the same number of lines and no more bytes. §10 needs no change: the one-hour cache stays and no external service is added.
- `docs/security-posture.md`:
  - lines 246-249: script-src also allows WebAssembly compilation (`'wasm-unsafe-eval'`) for the in-browser OCR engine, whose files come from `/ocr/` on the site itself
  - lines 249-251: violations reach Sentry only when raised on the page
  - lines 258-264: before enforcing, run once with the policy enforced the flows that run in Web Workers (OCR, pdf.js, the bulk-import worker and Session Replay's compressor), because their violations fire inside the worker and never reach `cspViolations.js`
  - (T5b) T5b has rewritten lines 245-263 with no collector and no Sentry. Skip the Sentry sentence, and write the `'wasm-unsafe-eval'` sentence and the Web Worker advice (OCR, pdf.js, bulk import; without Session Replay or `cspViolations.js`) into the rewritten section.
- `docs/OWNER_GUIDE.md`, `docs/RELEASE_CHECKLIST.md` and the design-system roadmap: none. They do not mention OCR or third-party hosts, and nothing renders differently.

## Verify before opening the PR

- `npm ci` (checks the lockfile), `npm run lint:frontend`, `npm run typecheck`, then `npx vitest run src/features/company-admin/applicationPrep/ src/tests/viteBuildConfig.test.js src/tests/hostingConfig.test.js src/tests/pdfWorkerWiring.test.js`, then `npm test -- --run`.
- `npm run build`, then:
  - `find dist/ocr -type f | sort` lists exactly 5 files (4 for (lang)=no), and `cmp` each against its `node_modules` source.
  - `grep -l 'cdn.jsdelivr' dist/assets/*.js` still finds the library's default strings in tesseract's chunk. They are overridden at runtime; do not treat this as a failure.
- `npm run check:bundle-budget`: the first download and the apply page must not change, since nothing new is preloaded.
- `npm run check:source-size`, `npm run check:ci-plan` (`firebase.json`, `vite.config.js` and `package.json` changed; release-pipeline rule 5) and `npm run check:agent-docs` (confirm the brief did not grow).
- `npm run build-storybook`, then `test ! -d storybook-static/ocr`.
- Browser suites, one at a time, each in the background with a log and its PID, after checking that port 5000 is free (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`):
  - `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e -- --project=chromium e2e/application-prep-ocr.spec.cjs`
  - then the same command with `e2e/company-prepared-application.spec.cjs`
- Optional, outside the repo, in a scratch directory: copy `dist/ocr` and `node_modules/tesseract.js/dist/tesseract.min.js` beside a ten-line page that calls `Tesseract.createWorker('eng', 1, { workerPath, corePath, langPath })`, serve it with the app's CSP-Report-Only value sent as an enforced `Content-Security-Policy`, and confirm the text is recognised in headless Chromium. This repeats the planning probe. Never change the repo for it.

## Verify after merge (on Testing, read-only)

- Watch the `main` run to completion (`gh run list --branch main --limit 1`, then `gh run watch <id>`). Confirm the Testing deploy and `verify-shipped` succeeded (release-pipeline rules 4-6).
- HEAD requests only, at most one per second:
  - `curl -sI https://truckerapp-system.web.app/ocr/tesseract-7.0.0/worker.min.js`: 200, a `text/javascript` content type, `cache-control: max-age=3600`.
  - The same for `…/core/tesseract-core-simd-lstm.wasm.js`.
  - (lang) `…/lang/eng.traineddata.gz`: 200 and a content type other than `text/html`. A `text/html` answer means the file is missing and the SPA fallback answered. Whether Hosting adds a `Content-Encoding` does not matter: tesseract checks the gzip bytes itself.
  - `curl -sI https://truckerapp-system.web.app/ | grep -i content-security-policy-report-only` shows `'wasm-unsafe-eval'`.
- Owner, optional, on Testing with the owner's own test company and a photo of a printed page with no personal data:
  - In Unfinished applications choose Start an application, then "Let AI read the documents". Attach the photo as the medical certificate and press "Read the documents".
  - The summary should say "Read by recognising the page" for it within about a minute.
  - Do not press Save, so no draft is created. Attaching does upload the file to the real Storage, and reading sends its text to the real AI service.
  - The agent never does this.
- After the owner promotes, repeat the HEAD checks against `https://app.safehaul.io`.

## Risks and safeguards

- Risk: a wrong path or a missing file. A missing worker or core makes `createWorker` reject (an `importScripts` MIME or load error). Missing data, which Hosting answers with `index.html`, is caught by X1a's bounded start. Either way the read falls back to page images, as today. The unit tests, the build-time version check and the E2E test guard every path.
- Risk: a tesseract.js bump fails `ocrAssets.test.js` and the build until `OCR_ASSET_BASE` is updated. This is intended, like the pdf.js version test. Dependabot groups production minor and patch updates into one weekly PR (`.github/dependabot.yml:27-33`), so such a bump blocks that whole group until the one-line change in `ocrAssets.js` is made in it; the error message names the file.
- Risk: Hosting grows by up to about 15 MB per retained release version, and the first deploy uploads it once; later deploys upload only changed files. If storage ever matters, the owner can limit kept releases in Firebase Hosting's settings. (lang) CI installs grow by about 14 MB.
- Risk: tabs opened before the deploy keep using jsDelivr until reloaded, and they still work. Browsers that already cached the data reuse it, because the IndexedDB key and the bytes are the same.
- Risk: `'wasm-unsafe-eval'` lets same-origin scripts compile WebAssembly. It grants no JavaScript eval, and OCR needs it once the policy is enforced.
- Risk ((lang)=no only): `connect-src` then allows every file on jsDelivr, and the E2E spec depends on the internet.
- No backend, rules, index or data change, so no Firestore index or migration is involved. Production is unaffected until the owner promotes.
- Rollback: revert the PR, and Testing loads from jsDelivr again. If it was already promoted, the owner promotes the previous version (`docs/FIREBASE_HOSTING_RUNBOOK.md`); the agent never promotes.

## Done when (acceptance criteria)

- [ ] `dist/ocr/tesseract-<version>/` holds exactly the worker, the three LSTM cores and (lang) `eng.traineddata.gz`, each byte-identical to its `node_modules` source. The dev server serves the same URLs. Nothing new is committed under `public/`.
- [ ] `createWorker` receives `workerPath`, `corePath`, `langPath` and `OCR_ENGINE_MODE` from `ocrAssets.js`, and `ocrFallback.js` and `ocrAssets.js` name no `https://` address ((lang)=no excepted).
- [ ] `e2e/application-prep-ocr.spec.cjs` failed on the unchanged app (recorded in the PR) and passes in `chromium` with jsDelivr blocked: a scanned PDF and a photo reach the callable as recognised text, the `/ocr/` worker, core and data are requested, and jsDelivr gets zero requests.
- [ ] Both app targets in `firebase.json` carry `'wasm-unsafe-eval'` in `script-src` and are identical. No `Cache-Control` was added. `hostingConfig.test.js` passes with the new case.
- [ ] `storybook-static` has no `ocr/` directory, and the bundle budget is unchanged.
- [ ] The `ocrFallback.js` comment, the brief §9 (without growing the brief) and `security-posture.md` match the code.
- [ ] After merge, the Testing HEAD checks above pass. The PR description starts with **Кратко**.
