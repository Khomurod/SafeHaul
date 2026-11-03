# M7b. Repair a failed application PDF automatically from the stored record

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #7 — Move slow tasks to a background job queue (step 2: automatic retry for `pdfPreserved: false`).
- **Size:** M · **Pull requests:** 2 (PR 1: a behaviour-preserving shared helper; PR 2: the queue, the scheduled job and the alert) · **Depends on:** M7a · **Owner decision needed:** "If M7a finds no PDF failures, do you still want this?" Recommended answer: **yes**, as a safety net, at low priority (one more scheduled job, about $0.10 a month).
- **Why it matters for users:** When a driver submits and the server cannot finish the application PDF within its time, the application is saved but its official PDF is missing. It stays missing until someone runs the Super Admin tool, and a recruiter who clicks Download meanwhile gets "no PDF". After this change the server makes the PDF on its own, usually 10-25 minutes after the submission, from the record frozen at submission; if it still fails after 5 tries (about 33 hours), the owner gets a Telegram message.

## Current behaviour (verified at 11626a6)

- The PDF is best-effort: `functions/guestApplication.js:406-434`. Lines :436-451 stamp `submissionRecord.pdfPreserved: Boolean(preservedPdf)`. Nothing queues a retry. The comments at :45-49 and :406-409 say the PDF can be rendered again "byte for byte"; it cannot, because each render stamps "Document generated" with the render time (`functions/shared/preserveApplicationPdf.js:192`, `functions/shared/pdf/applicationDocument.js:151`).
- The submit passes `ownerIds: { applicantId: result.applicationId, driverId: result.applicationId }` (:422-425) and the request's `signature` as the image (:421).
- `withinStep` stops waiting but does not cancel the work (`functions/shared/withinStep.js:8-9, 16-23`), so a late render may still land. The save is create-only (`ifGenerationMatch: 0`), and a second writer adopts the existing object (`preserveApplicationPdf.js:182-183, 201-232`).
- The only repair today is `repairMissingPdf` (`functions/reconstructHistoricalApplications.js:58-115`): snapshotId `'v1'` and sequence `1` hard-coded (:89-90); the signature image drawn only when its fingerprint matches the snapshot's `signature.sha256` (:70-74); ownerIds from the application document (:92-95); errors swallowed (:106-114); called only from the "already preserved" branch (:166-189), only for `v1`; the comment at :170-176 says "nothing else ever retries it"; it does not set `pdfPreserved: true`. The tool is a Super Admin onCall (:315-359: one company per call, `maxInstances: 1`, 540 s, 1GiB).
- Tests of that branch (`functions/test/unit/reconstructHistoricalApplications.test.js`, which uses `jest.clearAllMocks()` at :145): no test asserts a *successful* repair. "NEVER replaces an existing record" (:193-203) runs the repair over a stub record `{ frozen: true, … }`; the renderer throws because it has no `sections` (`applicationDocument.js:89-91`), and the test relies on the swallow (`store.pdfs` stays `{}`). The idempotency tests (:205-218, :397-409) run the adopt path.
- `pdfPreserved` is read nowhere else (grep: only `guestApplication.js:48,448`, a comment at `reconstructHistoricalApplications.js:172`, and tests). The download callable finds the PDF by Storage existence (`functions/applicationOriginalPdf.js:125-133`), so a repaired PDF is served at once.
- What the PDF says about itself (`applicationDocument.js`): footer "Original submission preserved <day>" or "Resubmission #n" from `snapshot.submittedAt` (:100-102); "About this document" (:137); "Document generated" (:151); "Record type" "Reconstructed" or "Captured at submission" from `snapshot.provenance.source` (:152). It carries the full SSN (`preserveApplicationPdf.js:189`) and lives at `application_originals/{company}/{application}/{snapshotId}.pdf` (:41-43), a prefix with no Storage rule (APP_BRIEF:560-567).
- `functions/deleteApplication.js:49-66` deletes the files, including the `application_originals` prefix (`functions/shared/applicationStorage.js:55`), **before** `db.recursiveDelete(ref)`. A repair that lands after that sweep would leave an orphan PDF (and an orphan `dq_files` doc, since `writeDqFileEntry` writes under a deleted parent).
- Application update triggers return early for a change that touches only `submissionRecord`: `notificationTriggers.js:23-24` (status only), `dashboardStatsRollup.js:48-50` (status deltas), `atsContactSms.js:38-39` (status transition only), `driverSync.js:261-275` (new uploads only). The submit's own stamp already writes this field today.
- Queue pattern to reuse: `functions/bulkActions/delivery/deliveryQueue.js:16-55` (entries in `system_jobs/smsDelivery/sessions`, `dueAt` as `admin.firestore.Timestamp.fromMillis(...)` at :18, `where('dueAt','<=',Timestamp.now()).orderBy('dueAt').limit(n)` at :31-38), drained by the scheduled `deliveryCheck.js:19-39`. `firestore.indexes.json` has no composite index for it (one field, served by the automatic single-field index); its `fieldOverrides` touch only TTL fields (`system_jobs.inboxExpiresAt` and others), not `dueAt`. `system_jobs` has no client rule (no match in `src/firestore.rules`; `functions/companyAdmin.js:20`, `functions/ops/alertSettings.js:9-11`).
- Telegram pattern: `functions/ops/modelRefresh.js:237-250` (`settings.readBotToken()`, then `telegram.sendMessage(token, chatId, text)`, `functions/ops/telegram.js:176`); the chat is `settings.readSettings().telegram?.chatId` (`functions/ops/watcher.js:211-213`). The token is read from Secret Manager at run time (`alertSettings.js:23-28`); `watchAiAndBlog` declares no secret for it (`watcher.js:256-264`).
- `onSchedule` options: `ScheduleOptions` extends `GlobalOptions` (region, memory, timeoutSeconds, maxInstances) and adds `retryCount` etc. (Context7 `/firebase/firebase-functions`, scheduler API reference); repo precedent `functions/featureScheduler.js:4` (`every 15 minutes`, `us-central1`).
- Deploy facts: `functions/index.js` uses one lazy line per export (`if (wanted('X')) exports.X = require('./m').X;`), pinned by `functions/test/unit/functionTarget.test.js:21,56-61`; `functions/test/unit/deployedEntryPoint.test.js:31,61-75` requires at least 256MB and no retry policy; the incremental deploy runs `firebase deploy --only functions:<changed>`, so it never deletes a removed export (`scripts/deploy-functions-incremental.mjs:1-38`).
- `db.collectionGroup("applications")` is read by `functions/legacyCompat.js:8`, so a queue collection must never be named `applications`.
- Test doubles: `functions/test/unit/guestApplication.snapshot.support.js` — `firebaseAdminMock` has `admin.firestore.FieldValue` but **no `Timestamp`** (:128), and its `db.collection` returns `{ doc: () => ({}) }` for any other collection (:184); the support header says no suite queues a `*Once` value, so it keeps `clearAllMocks` (:12-13, `resetSnapshotState` :229-240). `functions/test/unit/guestApplication.test.js:69-71` mocks `firebaseAdmin` with `db` only (no `admin`, no `storage`), so the PDF step already fails there. `functions/test/helpers/firestoreMock.js` filters only on `'=='` (:120-124), has no `create()`, and provides `Timestamp.now/fromMillis` (:187-191).
- `functions/node_modules` is not installed in this planning session, so the Jest baseline was not run. Run `npm ci` in `functions/` first.

### Design (decided, with the alternatives rejected)

- The submit queues one entry, only when its PDF was not preserved, at `system_jobs/applicationPdfRepair/pdfRepairs/{companyId}__{applicationId}__{snapshotId}`. A new scheduled function, `repairApplicationPdfs`, runs every 15 minutes and works through the entries that are due.
- Rejected: a Firestore trigger on applications (runs on every application write beside the four existing triggers, and races the original render that may still be running); Cloud Tasks / `onTaskDispatched` (a mechanism this repo does not use, plus enqueue permissions from the 1st-gen runtime); a collection-group scan for `pdfPreserved == false` (needs a collection-group index exemption and would also sweep old records, which is a backfill).
- Legal-record rules (runbook "Preserved PDFs" lines 112-129, APP_BRIEF §5 "The frozen record"):
  1. The **only input** is the stored `submission/{snapshotId}`, decoded with `decodeStoredSnapshot`. Never the application's live answers, never `buildSubmissionSnapshot`, never `reconstructSubmissionSnapshot`.
  2. Never write, edit or add a submission record, and never claim a new sequence.
  3. Write to the same path, with the same DQ entry, that the submit would have written: create-only, and `ownerIds: { applicantId: applicationId, driverId: applicationId }` as at `guestApplication.js:422-425`. An existing object is adopted, never replaced.
  4. The labels come from the renderer unchanged: "Captured at submission", the footer date from the snapshot, and "Document generated" = the real time of the repair, never backdated. Do not change the renderer or its wording.
  5. Draw the signature image only when its SHA-256 matches `snapshot.signature.sha256`; otherwise leave it out and log that.
  6. Do not queue a submission whose record failed (`submissionRecord.status: 'failed'`). Only a person may run the reconstruction, which labels the result "Reconstructed" (runbook lines 11-16).
  7. Queue only from the submit path, so applications that already have `pdfPreserved: false` from before this ships are never touched; repairing them stays the existing Maintenance action, only with the owner's go.
- Retry schedule: first try 10 minutes after the submit (so a late original render can land and be adopted); after a failure, again in 30 min, 2 h, 6 h and 24 h: **5 tries in total, about 33 hours**. After the fifth: `gaveUpAt` set, `dueAt: null` (the due query never matches null), an error log, and a Telegram message. Every `dueAt` is a Firestore `Timestamp` (`admin.firestore.Timestamp.fromMillis(...)`), never a number: a number never matches the `<=` Timestamp query, so the entry would silently never run again.

## Scope

- In: a shared helper (PR 1); the queue module, one call in the submit path, the scheduled job, the alert, the export line, tests and docs (PR 2).
- Out (do not do in this task): repairing existing records (the owner's decision, via the existing Maintenance action); automatic reconstruction of `status: 'failed'` records; any change to the PDF renderer, its wording, its Storage path or rules; `deleteApplication` changes; setting `pdfPreserved: true` from the manual tool; the dossier's "No preserved application PDF … submitted before applications were archived" message (`src/features/applications/services/applicationPdfService.js:60-63`), an open question for a later task; `deleteCompany` / `backfillEmployerFields` and their single-call 540 s limits (`functions/companyAdmin.js:33-53`, `functions/legacyCompat.js:5-8`), mentioned only; memory for the submit call (M7c).

## Read first

- `AGENTS.md` §1-§3; `.claude/skills/implement/SKILL.md`; `.claude/rules/testing.md` ("Jest under functions/": a file that queues `*Once` values uses `jest.resetAllMocks()` and restores its defaults); `.claude/rules/source-size.md`; `.claude/rules/release-pipeline.md` ("How a release flows").
- `docs/APP_BRIEF.md` §5 "The frozen record" (552-567), §7 Telegram row (945), §8 (993-1047), §10, §12 (1370-1375), §13; `docs/application-record-reconstruction-runbook.md` in full; `docs/production-readiness-runbook.md` "Alert Triggers" (12-18); `docs/OWNER_GUIDE.md` "Уведомления в Telegram" (49-61).

## Implementation steps

*PR 1: a shared helper for repair from the stored record. Users see no change.*
1. Tell the owner the three Russian lines (AGENTS §1).
2. Characterization tests first, in `functions/test/unit/reconstructHistoricalApplications.test.js`, with its own doubles (`store.snapshots`, `store.pdfs`, :20-112). This file uses `jest.clearAllMocks()`, so queue no `*Once` values in it.
   - "repairs a preserved record's missing PDF from the STORED snapshot": `seedCompany()`; `seedApplication('app-1')` (live name Marcus Delgado, signature `data:image/png;base64,AAAA`); set `store.snapshots['company-abc/app-1/v1'] = encodeSnapshotForStorage(buildSubmissionSnapshot({ definition: buildApplicationDefinition({ company: { companyName: 'Stored Carrier' } }), formData: { firstName: 'Stored', lastName: 'Name' }, signature: { image: 'data:image/png;base64,AAAA', type: 'drawn', capturedAt: '2024-03-02T11:04:00.000Z' }, submittedAt: '2024-03-02T11:04:00.000Z' }))` (as `functions/test/unit/preserveApplicationPdf.test.js:18-28` builds one). Leave `store.pdfs` empty. Expect `pdfs: 1, skipped: 1`, an object at `application_originals/company-abc/app-1/v1.pdf`, and its `options.metadata.metadata.safehaulApplicant` equal to `'Stored Name'` (the name comes from the snapshot, not the live document).
   - "repairs it without the signature image when the signature cannot be verified": same, but seed the application with a different `signature`; expect the PDF and a `logger.info` call containing "without a signature image".
   Both must pass at 11626a6 and after the change. "NEVER replaces an existing record" (:193-203) must also keep passing, which requires the wrapper to keep swallowing errors.
3. Create `functions/shared/repairPreservedPdf.js` exporting `preserveFromStoredSnapshot({ db, storage, serverTimestamp, companyId, applicationId, applicationData, snapshot, snapshotId = 'v1', sequence = 1, ownerIds, logLabel })`:
   - move in the body of `repairMissingPdf` (:59-97), with the signature check from :70-74 unchanged (it reads `applicationData?.signature`);
   - take `ownerIds` from the caller (no default derived inside);
   - pass `snapshotId` and `sequence` through;
   - return `{ alreadyExisted, storagePath, signatureVerified }` (`signatureVerified` = whether the image was drawn);
   - **let errors throw**; require nothing from `firebaseAdmin` (everything is passed in).
4. In `reconstructHistoricalApplications.js`, keep `repairMissingPdf({ doc, companyId, snapshot })` as a thin wrapper: call the helper with `'v1'`, `1`, `admin.firestore.FieldValue.serverTimestamp()` and `ownerIds: { applicantId: doc.data()?.applicantId || doc.id, driverId: doc.data()?.driverId || doc.id }` (unchanged behaviour); keep the log lines (:99-104) and the swallow (:106-114). Remove the `signatureFingerprint` import (:32), now unused; keep `preserveApplicationPdf`, which :254 still uses.
5. New `functions/test/unit/repairPreservedPdf.test.js`, see **Tests**.
6. PR 1 **Кратко**: «Внутренняя перестановка: код, который восстанавливает недостающий PDF заявления из сохранённой записи, вынесен в общий модуль, чтобы его мог использовать будущий автоматический повтор. Для пользователей ничего не меняется. Проверено автотестами. От вас ничего не нужно.»

*PR 2: the queue, the scheduled job and the alert. Start it after M7c has merged or been ticked "not needed", because both edit `guestApplication.js`.*
7. Failing tests first (see **Tests**). Test doubles:
   - `guestApplication.snapshot.support.js`: add `Timestamp: { now: () => ({ toMillis: () => Date.now() }), fromMillis: (ms) => ({ toMillis: () => ms }) }` to `admin.firestore` in `firebaseAdminMock` (:128); add a `system_jobs` branch to `db.collection` (:166-184) whose `doc(...).collection('pdfRepairs').doc(id).create(data)` stores into `mockState.pdfRepairQueue[id]`, throws `ALREADY_EXISTS` (code 6) when present, and throws `mockState.queueShouldFail` when set; add `pdfRepairQueue: {}` and `queueShouldFail: null` to `mockState` (:23-33) and reset both in `resetSnapshotState` (:229-240). No `*Once` values (support header :12-13).
   - `functions/test/helpers/firestoreMock.js`: add `create()` to `makeDocRef` (code 6 when the document exists), and, only when `filters: true`, a `'<='` comparison on values with `toMillis()` (a missing or non-Timestamp value never matches, as in Firestore). Update its header comment (:5-10) to list both. Existing `'=='` behaviour must not change (14 test files use this helper).
8. New `functions/shared/applicationPdfRepairQueue.js` (under 150 lines). It requires only `../firebaseAdmin` and `./withinStep` (no alert or Telegram modules, so the submit's cold start does not grow). It holds:
   - constants `FIRST_TRY_DELAY_MS = 10 * 60e3`, `RETRY_DELAYS_MS = [30 * 60e3, 2 * 3600e3, 6 * 3600e3, 24 * 3600e3]`, `MAX_ATTEMPTS = 5`, `QUEUE_STEP_MS = 2000`, `ALERT_RETRY_MS = 3600e3`, `MAX_ALERT_TRIES = 24`;
   - `queueRef()` = `db.collection('system_jobs').doc('applicationPdfRepair').collection('pdfRepairs')` (**never** named `applications`);
   - `entryId(companyId, applicationId, snapshotId)` = `${companyId}__${applicationId}__${snapshotId}`;
   - `dueAtIn(now, ms)` = `admin.firestore.Timestamp.fromMillis(now + ms)`, used for every `dueAt`;
   - `queueApplicationPdfRepair({ companyId, companyName, applicationId, snapshotId, sequence, logLabel })`: its **whole body** (building the ref and the Timestamp included) inside one `try/catch`; it calls `withinStep(queueRef().doc(entryId(...)).create({ companyId, companyName, applicationId, snapshotId, sequence, attempts: 0, dueAt: dueAtIn(Date.now(), FIRST_TRY_DELAY_MS), queuedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: null, gaveUpAt: null }), QUEUE_STEP_MS)` — a flat 2 s, not `stepLimit(…, answerBy)`, which would leave it 1 ms after a PDF time-out. `ALREADY_EXISTS` (code 6) returns true; any other error is logged with `console.error` (ids only) and returns false. It **never throws** and stores no applicant data;
   - `dueApplicationPdfRepairs(limit, now)`: `where('dueAt', '<=', admin.firestore.Timestamp.fromMillis(now)).orderBy('dueAt').limit(limit)`, shaped like `deliveryQueue.js:31-38`;
   - the settle helpers for success (delete), retry and give-up, all writing `dueAt` through `dueAtIn`.
9. In `functions/guestApplication.js`, require the queue. Right after the stamp (:436-451), still inside the snapshot `try`, add `if (!preservedPdf) await queueApplicationPdfRepair({ companyId, companyName, applicationId: result.applicationId, snapshotId: submissionSnapshot.snapshotId, sequence: submissionSnapshot.sequence, logLabel: 'submitGuestApplication' });` (`companyName` is in scope from :218). Rewrite the comments at :45-49 and :406-409 to say the PDF is rendered from the frozen record alone and a missed one is made later by `repairApplicationPdfs`; drop "byte for byte". Keep the file under 500 lines (487 now).
10. New `functions/applicationPdfRepair.js` (require `./firebaseAdmin` first). It exports `runApplicationPdfRepairs({ now = Date.now(), limit = 10, budgetMs = 240000 } = {})` and `exports.repairApplicationPdfs = onSchedule({ schedule: 'every 15 minutes', region: 'us-central1', timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, () => runApplicationPdfRepairs())`. Set no `retryCount`. Process entries one at a time and take no new entry once `budgetMs` has passed. For each entry:
    - a. If `gaveUpAt` is set (only `alertPending` entries come back), only resend the alert (step h).
    - b. Read the application. If it is gone, delete the entry.
    - c. Read `submission/{snapshotId}`. If it is missing, throw `'The stored submission record is missing.'` (counts as a try; never reconstruct).
    - d. Call `preserveFromStoredSnapshot({ db, storage, serverTimestamp: admin.firestore.FieldValue.serverTimestamp(), companyId, applicationId, applicationData, snapshot: decodeStoredSnapshot(stored.data()), snapshotId, sequence, ownerIds: { applicantId: applicationId, driverId: applicationId }, logLabel: 'repairApplicationPdfs' })`.
    - e. Read the application again. If it is gone, go to step g.
    - f. `appRef.update({ 'submissionRecord.pdfPreserved': true, 'submissionRecord.pdfRepairedAt': new Date(now).toISOString() })`. Use `update`, not set-merge: it cannot replace another `submissionRecord` field and cannot re-create a deleted application (which would fire the `onDocumentCreated` triggers, e.g. the applicant email at `notificationTriggers.js:149-151`). If it fails with NOT_FOUND (code 5), go to step g. Otherwise delete the entry.
    - g. Deleted during the render: if the helper did not adopt an existing object, delete `storage.bucket().file(storagePath)` (`{ ignoreNotFound: true }`) and `companies/{c}/applications/{a}/dq_files/{dqFileIdFor(snapshotId)}`, mirroring `deleteApplication`; then delete the entry.
    - h. On any error: `attempts + 1` and `lastError = String(error?.code || error?.message || error).slice(0, 200)`.
      - Below the cap: `set({ attempts, lastError, dueAt: dueAtIn(now, RETRY_DELAYS_MS[attempts - 1]) }, { merge: true })`.
      - At the cap: `{ attempts, lastError, gaveUpAt: new Date(now).toISOString(), dueAt: null }`, `console.error('[repairApplicationPdfs] gave up …')` with ids only, then the alert.
      - The alert: no chat connected → log only. Send fails → `{ alertPending: true, alertTries: alertTries + 1, dueAt: dueAtIn(now, ALERT_RETRY_MS) }` while `alertTries < MAX_ALERT_TRIES`, else `dueAt: null`. Delivered → `{ alertPending: false, dueAt: null }`.
      - Text in Russian, no applicant name or answers (the application id is a hash, `functions/shared/buildApplicationDoc.js:13`): «Не удалось автоматически создать PDF заявления после 5 попыток. Само заявление сохранено. Компания: {companyName}. Номер заявления: {applicationId}. Передайте это сообщение разработчику.»
    After the loop, `set(…, { merge: true })` a heartbeat on `system_jobs/applicationPdfRepair`: `lastRunAt, lastRunDue, lastRunRepaired, lastRunAdopted, lastRunFailed, lastRunGaveUp`, then one `console.log` summary with counts only.
11. In `functions/index.js`, after :134, add a one-line comment and `if (wanted('repairApplicationPdfs')) exports.repairApplicationPdfs = require('./applicationPdfRepair').repairApplicationPdfs;`.
12. Update the comment at `reconstructHistoricalApplications.js:170-176`: new submissions are retried by `repairApplicationPdfs`; this tool still covers older ones, and `v1` only.
13. Indexes, rules, CSP: none. The due query is a range plus `orderBy` on one field (`dueAt`) in `pdfRepairs`, served by the automatic single-field index exactly as `smsDelivery` is; `firestore.indexes.json` has no `fieldOverrides` entry for `pdfRepairs`/`dueAt`. Say this in the PR. No Firestore or Storage rule change (`system_jobs` stays server-only). No CSP change (Telegram is called server-side). No `firebase.json` change.
14. PR 2 **Кратко**: «Если при отправке заявления не удалось создать его официальный PDF, сервер теперь сам создаст его примерно через 10–25 минут из записи, сохранённой при отправке; раньше это делалось только вручную. Если за 5 попыток (около полутора суток) не получится — придёт сообщение в Telegram. Старые заявления без PDF не трогаются. После слияния работает сразу для обоих сайтов (общий сервер); от вас нужно только ответить на вопрос о старых заявлениях.»

## Tests

- PR 1: `functions/test/unit/repairPreservedPdf.test.js` (Storage double and `makeSnapshot` as in `preserveApplicationPdf.test.js:18-60`; a small `db` double for the DQ write):
  - renders from the given snapshot and returns `signatureVerified: true` when the fingerprint matches;
  - `signatureVerified: false` when the live signature differs, or when the snapshot has no fingerprint;
  - `snapshotId: 'v2', sequence: 2` writes `…/v2.pdf` with metadata `safehaulSequence: '2'`;
  - the given `ownerIds` reach the DQ entry;
  - an existing object is adopted with no `save()` call and returns `alreadyExisted: true`;
  - a Storage error is thrown, not swallowed.
  The two characterization tests (step 2) and "NEVER replaces an existing record" pass before and after.
- PR 2, `functions/test/unit/guestApplication.snapshot.pdf.test.js`:
  - "keeps the application when preserving the PDF fails" (:73-91) also expects `mockState.pdfRepairQueue['co1__<id>__v1']` with `{ companyId: 'co1', snapshotId: 'v1', sequence: 1, attempts: 0 }` and `dueAt.toMillis()` about 10 minutes ahead. **Fails before the change.**
  - "stores an original…" (:29-44) expects no entry.
  - new "a queue that cannot be written still answers the driver": `mockState.queueShouldFail = new Error('unavailable')` with a failing PDF; the call still returns a `confirmationNumber`.
- PR 2, `guestApplication.snapshot.time.test.js` (:57-75): the slow-PDF case also leaves a queued entry.
- PR 2, `guestApplication.test.js` and `guestApplication.uploads.test.js` pass unchanged (their mocks lack `admin`; the queue must swallow that).
- PR 2, new `functions/test/unit/applicationPdfRepair.test.js`: `createFirestoreMock({…}, { filters: true })`, a Storage double like `reconstructHistoricalApplications.test.js:67-82` plus `delete()`, `jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => handler }))` as in `smsDelivery.check.test.js:17`, and mocks for `../../ops/alertSettings` and `../../ops/telegram`; `jest.resetAllMocks()` in `beforeEach`, then restore every default. Cases:
  - a due entry gets its PDF at the original path, a DQ entry with `ownerUserIds: [applicationId]`, `submissionRecord.pdfPreserved: true` and `pdfRepairedAt`; other `submissionRecord` fields unchanged; the entry deleted;
  - drawn from the **stored** snapshot (`safehaulApplicant` is the stored name, not the live one);
  - an existing object is adopted (no save) and the flag is still set;
  - a deleted application: nothing rendered, the entry deleted;
  - an application deleted during the render (gone at step e, and separately `update` failing with code 5): the new object and the DQ doc are removed, the entry deleted;
  - a missing stored record counts as try 1, and the next run 30 minutes later (`now + 30 min`) **picks the entry up again** through the due query (proves `dueAt` is a Timestamp);
  - the fifth failure sets `gaveUpAt` and `dueAt: null`, and sends one Telegram message containing the company name and application id and not the applicant's name, email or SSN;
  - no chat connected: no send, an error logged;
  - a failed send leaves `alertPending` and is retried on the next due run without rendering again;
  - an entry not yet due is left alone; one run takes at most 10 entries; the heartbeat is written.
- `functionTarget.test.js` and `deployedEntryPoint.test.js` pick up the new export and must pass (512MiB is above the floor; no retry policy).

## Documentation to update in the same PR

- PR 1: only the code comment in step 4.
- PR 2, `docs/APP_BRIEF.md`: §5 lines 565-567 (a PDF cut short is queued and made by `repairApplicationPdfs` from the stored record, up to 5 tries over about 33 hours, then a Telegram alert; older ones still need `reconstructHistoricalApplications`); §7 Telegram row (945): add the give-up alert; §8 scheduled-jobs table, a row after `checkSmsDeliveries` (line 1004): `repairApplicationPdfs` | every 15 min | makes a missing application PDF from its stored record; 5 tries; tells Telegram when it gives up; §12 lines 1370-1375: one clause saying new failures repair themselves.
- PR 2, `docs/application-record-reconstruction-runbook.md`: the "Safety properties" row "Repairs a missing PDF" (line 28), "Preserved PDFs" (112-129) and "Limitations" (182-190): new failures are retried automatically; this tool covers older ones, and `v1` only.
- PR 2, `docs/production-readiness-runbook.md` "Alert Triggers" (line 14 says it is the one automated trigger): add the second.
- PR 2, `docs/OWNER_GUIDE.md` "Уведомления в Telegram" (49-61): one Russian sentence on the new message: «заявление сохранено, PDF не создался — перешлите разработчику».
- PR 2, `docs/callable-frontend-map.md:113`: add `repairApplicationPdfs` to the Scheduled row.

## Verify before opening the PR

- In `functions/`: `npm ci` if `node_modules` is missing, then `npm run lint` and `npm test` (the whole Jest suite, which includes `functionTarget.test.js`, `deployedEntryPoint.test.js` and `mockResetHygiene.test.js`).
- In the root: `npm run lint:frontend`, `npm test -- --run`, `npm run check:function-exports`, `npm run check:source-size`, `node scripts/check-callable-contract.mjs`.
- Deploy plan, read-only, after committing: `DEPLOY_FUNCTIONS_DRY_RUN=1 DEPLOY_GIT_BASE=$(git merge-base origin/main HEAD) DEPLOY_GIT_HEAD=HEAD node scripts/deploy-functions-incremental.mjs`. Expect `reconstructHistoricalApplications` for PR 1, and `submitGuestApplication`, `repairApplicationPdfs` and `reconstructHistoricalApplications` for PR 2. Paste the list into the PR: merging deploys these to the shared backend at once.
- No Playwright suite applies (nothing in the browser changes). Say so.

## Verify after merge (on Testing, read-only)

- Watch the `main` run: the Deploy Cloud Functions log lists the expected functions, and `verify-shipped` and `release-ready` succeed (release-pipeline rules 4 and 6).
- After PR 2, owner or agent, view only: Google Cloud → **Cloud Scheduler** shows `firebase-schedule-repairApplicationPdfs-us-central1`, every 15 minutes, last run "Success"; Logs Explorer search `"[repairApplicationPdfs]"` shows the run summaries; Firestore console (view only) shows `system_jobs/applicationPdfRepair` with `lastRunAt` advancing.
- Never cause a failing submission on purpose: a test submission on Testing is a real application. If a real failure happens later, its entry appears under `pdfRepairs` and disappears within about 25 minutes, and Download in the dossier then works.

## Risks and safeguards

- Legal record: the seven rules above, the create-only write, and tests that render from the stored snapshot and adopt existing objects.
- The driver's submit: the queue write runs only after the PDF already failed, is bounded at 2 s, never throws (even with a broken mock or SDK error), and the call still ends inside its 30 s limit (24 s answer budget, the stamp, then at most 2 s). Merging PR 2 redeploys `submitGuestApplication`; a submission in flight during the swap is retried by the browser and deduplicated by its attempt id (`guestApplication.js:323-329`).
- Submissions whose whole call was cut off before the queue write (M7a count d) or whose record failed (count c) are never queued; they stay with the manual Maintenance action.
- Orphan PDF with an SSN after a deletion: steps e and g remove it. A residual window remains only if the application is deleted after the successful `update` in step f, which `deleteApplication`'s own prefix sweep then covers.
- A deterministic render bug: the 5-try cap plus the Telegram alert, so nothing loops forever; a lost alert is retried hourly up to 24 times.
- Side effects of the flag write: the application update triggers return early for a `submissionRecord`-only change (see Current behaviour).
- Cost: one indexed query and one heartbeat write every 15 minutes; renders only on failures; one more Cloud Scheduler job.
- Rollback: reverting does **not** delete a deployed function (the incremental deploy never deletes). To stop the job, ship a PR that makes `runApplicationPdfRepairs` return at once (that file's change redeploys it), or the owner pauses its Cloud Scheduler job. The submit-side queue call is harmless on its own.

## Done when (acceptance criteria)

- [ ] PR 1 merged: the characterization tests and "NEVER replaces an existing record" pass before and after; the deploy plan listed only `reconstructHistoricalApplications`.
- [ ] PR 2 merged: the queue assertion in `guestApplication.snapshot.pdf.test.js` failed before the change and passes after it.
- [ ] Every `applicationPdfRepair.test.js` case passes, including stored-snapshot-only rendering, adopt-not-replace, both deletion cases, the retry being picked up again, the cap and the alert.
- [ ] No `firestore.indexes.json`, rules or `firebase.json` change, and the PR says why.
- [ ] The docs listed above are updated in PR 2.
- [ ] After merge, Cloud Scheduler shows the job succeeding and the heartbeat's `lastRunAt` advances.
- [ ] Older applications are untouched; the owner's answer on repairing them is recorded in the plan's Progress section.
