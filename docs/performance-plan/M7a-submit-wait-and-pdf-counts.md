# M7a. Measure the driver's submit wait and count missing application PDFs (owner, read-only)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #7 — Move slow tasks to a background job queue (step 1: measure before changing).
- **Size:** S · **Pull requests:** 0 · **Depends on:** none · **Owner decision needed:** "Will you read the numbers below (about 15 minutes) and paste them to the agent?" Recommended answer: **yes**. They decide M7b's priority and whether M7c is needed.
- **Why it matters for users:** A driver who presses Submit waits while the server also draws the application PDF, on the smallest machine size. Before changing anything we learn how long drivers actually wait, how often the PDF was cut off, and how many applications already lack their PDF.

## Current behaviour (verified at 11626a6)

- `functions/guestApplication.js:168-170` is a 1st-gen callable (`require('firebase-functions/v1')` at :6) with `runWith({ memory: '256MB', timeoutSeconds: 30 })`. Firebase docs (Context7 `/websites/firebase_google`, "Override CPU defaults") give 1st-gen CPU per memory tier: 256MB = 1/6 CPU, 512MB = 1/3, 1GB = 7/12, 2GB = 1.
- `ANSWER_WITHIN_MS = 24000` (:44) and `PDF_STEP_MS = 15000` (:50). The PDF step runs under `withinStep` (:410-434). A failure is logged at :429-433 as "[submitGuestApplication] Preserving the application PDF failed for …"; a time-out carries `code: 'step-timeout'` and the text "no answer within N ms" (`functions/shared/withinStep.js:20`). The outcome is stamped as `pdfPreserved` (:448).
- A submission whose record failed logs "Submission snapshot failed for application" (:453-457). It has no record and no PDF.
- The code logs no PDF duration: `functions/shared/preserveApplicationPdf.js:239-241` logs only the path and page count. The platform logs each call's total time.
- Read-only survey: `functions/historicalReconstructionSurvey.js` writes nothing (header :27-29) and counts preserved records whose `v1` PDF is missing (:143-162). In the console: Super Admin → **Maintenance** → card "Historical application records" → **Check what is left** (`src/features/super-admin/components/HistoricalMigrationPanel.jsx:58-70, 247-249`), which shows "Missing official PDFs" (:283). The same card's primary button, labelled "Migrate the remaining N" or "Repair N missing PDFs" (:393-410), **writes** records and PDFs.
- The agent has no Google Cloud access. The owner reads the numbers.

## Scope

- In: reading four groups of numbers, recording them, applying the decision rule below.
- Out (do not do in this task): any click that changes something — no Edit, Delete, Pause or "Create index" in Google Cloud, and **not** the "Migrate the remaining …" / "Repair … missing PDFs" button on the Maintenance card. No code change.

## Read first

- `docs/APP_BRIEF.md` §5 "The frozen record" (lines 552-567) and §12 lines 1370-1375; `docs/application-record-reconstruction-runbook.md` ("Why it is not automatic" lines 11-16, "Preserved PDFs" lines 112-129).

## Implementation steps

1. Agent: send the owner these steps in Russian and say they only look and change nothing. Testing and Production share one backend, so the numbers cover both sites.
2. Owner, execution time and memory: open `https://console.cloud.google.com/functions/list?project=truckerapp-system`, click **submitGuestApplication** (marked 1st gen), open the **Metrics** tab and set the range to **30 days**. Write down:
   - **Execution time**: 50th, 95th and 99th percentile, in ms;
   - **Memory utilization**: 99th percentile, in MB;
   - **Invocations**: any status other than "ok" and how many.
   If a chart is missing, use **Monitoring → Metrics Explorer** with "Cloud Function → Function → Execution times" and "Memory usage", filtered on `function_name = submitGuestApplication` (metric ids `cloudfunctions.googleapis.com/function/execution_times` and `cloudfunctions.googleapis.com/function/user_memory_bytes`; not confirmed through Context7, confirm in the console).
3. Owner, logs: open `https://console.cloud.google.com/logs/query?project=truckerapp-system`, set the range to **Last 30 days** (the default log retention), run each query and write down the number of results:
   - a. `resource.labels.function_name="submitGuestApplication" "Preserving the application PDF failed"` — PDFs that failed or were cut off;
   - b. the same query plus `"no answer within"` — how many of those were time-outs;
   - c. `resource.labels.function_name="submitGuestApplication" "Submission snapshot failed for application"` — submissions with no record at all;
   - d. `resource.labels.function_name="submitGuestApplication" "finished with status: 'timeout'"` — the whole call was cut off, so the driver saw no confirmation number.
4. Owner, Super Admin: open **Maintenance** → "Historical application records" → **Check what is left**, once. It reads every application on the platform once and writes nothing. Write down **Missing official PDFs** and the other counts. Do not press the "Migrate the remaining …" / "Repair … missing PDFs" button.
5. Owner: paste all numbers to the agent.
6. Agent: record them under M7a in the plan's Progress section in the next PR that touches the plan (M7b PR 1, M7c, or a docs-only PR if neither follows). Then apply the decision rule:
   - **M7c is needed** if p95 > 8 s, or p99 > 12 s, or (b) > 0, or (d) > 0, or memory p99 ≥ 200 MB (about 80% of 256). Otherwise tick M7c "not needed" and quote the numbers.
   - **M7b**: go ahead if (a) > 0. If (a) = 0, ask the owner the M7b decision question.
   - If (c) > 0 or (d) > 0: tell the owner those submissions cannot be repaired by M7b (they never reached the queue); they need the existing Maintenance action, and a record rebuilt for (c) is labelled "Reconstructed".
   - If Missing official PDFs > 0: ask the owner the open question about repairing older applications. Do not run anything.

## Tests

- None. No code changes.

## Documentation to update in the same PR

- None in this step. The numbers go into the plan's Progress section and into the M7b/M7c PR descriptions.

## Verify before opening the PR

- Not applicable (no PR). Check that every number above is filled in or marked "could not read", with the reason.

## Verify after merge (on Testing, read-only)

- Not applicable.

## Risks and safeguards

- A stray click changes infrastructure or writes records: the steps name only view pages; the owner closes any dialog that offers Edit, Delete, Pause, Create, Migrate or Repair.
- The survey is one read of every application document plus one Storage existence check per preserved record: a small one-time cost, no writes.
- Logs older than 30 days are gone; say so if the counts look low.

## Done when (acceptance criteria)

- [ ] p50/p95/p99 execution time, memory p99 and non-ok invocations are recorded.
- [ ] Log counts a–d are recorded.
- [ ] "Missing official PDFs" is recorded.
- [ ] The decisions for M7b and M7c are written in the plan's Progress section with the numbers behind them.
