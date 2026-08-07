# Runbook — reconstructing preserved records for historical applications

Applications submitted **before** the preservation work shipped have no
immutable submission record and no preserved PDF. Nothing rebuilds them
automatically, by design: a read-time fallback would regenerate the record from
data that keeps changing, which is the exact defect preservation exists to fix.

This runbook covers the one-time backfill. It is a **super-admin callable, run
per company, by a human**.

## Why it is not automatic

A migration over evidentiary records has no safe first run across every tenant
at once. The callable therefore refuses a request with no `companyId`, and the
default first step is a dry run whose output a person reads before anything
becomes a fact.

## Safety properties

| Property | How it holds |
| --- | --- |
| Adds only | Sequences are claimed with Firestore `create()`. It never edits or deletes a record. |
| Cannot overwrite a real submission | An application that already has `submission/v1` is skipped. A live submission's record can never be replaced by a reconstruction. |
| Idempotent | A second run over the same company reports `reconstructed: 0, skipped: N` and leaves the stored PDF bytes untouched. |
| Resumable | Returns `truncated` and `lastApplicationId`; pass that back as `startAfterApplicationId`. |
| Inspectable first | `dryRun: true` writes nothing and reports what it would do, including what it could not recover. |

## Procedure

Run as a **super admin**. `companyId` is required every time.

### 1. Dry run

```js
const fn = httpsCallable(functions, 'reconstructHistoricalApplications');
await fn({ companyId: '<company-id>', dryRun: true });
```

Read the result before continuing:

```
{ dryRun: true, scanned, reconstructed, skipped, failed, pdfs: 0,
  truncated, lastApplicationId, unrecoverable: { ... }, errors: [ ... ] }
```

* `reconstructed` — how many records *would* be written.
* `skipped` — already preserved. Expected to grow to the full count on reruns.
* `failed` / `errors` — applications that could not be read at all. Each is
  named. The job keeps going rather than aborting the company.
* `unrecoverable` — a count per category of what the evidence does not support.
  This is information, not an error. See the table below.

### 2. Real run

```js
await fn({ companyId: '<company-id>' });
```

### 3. Resume if truncated

One invocation stops at `maxApplications` (default 200) so it cannot run past
its timeout. If `truncated` is `true`:

```js
await fn({ companyId: '<company-id>', startAfterApplicationId: '<lastApplicationId>' });
```

Repeat until `truncated` is `false`.

### 4. Confirm

Re-run step 1. A completed company reports `reconstructed: 0` with `skipped`
equal to its application count.

## Parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| `companyId` | *(required)* | The tenant to process. Omitting it is rejected. |
| `dryRun` | `false` | Report without writing. |
| `maxApplications` | `200` | Ceiling for one invocation. |
| `startAfterApplicationId` | `null` | Resume cursor. |

## What "unrecoverable" means

Every reconstructed record is stamped `provenance.source: 'reconstructed'` and
carries notes explaining its limits. These categories are the limits, not
failures — the job reports them instead of inventing a value.

| Category | What is missing | What the record says instead |
| --- | --- | --- |
| `definition_at_submission` | The question set and company details as they stood that day. | Notes state plainly that current settings were used. |
| `individual_agreement_acceptance` | Which agreements were accepted separately. | Acceptance is recorded as `combined` — the applicant certified the set — never as individual acceptance. |
| `agreement_acceptance` | Any evidence of acceptance at all. | `accepted: false`, signature `null`. No agreement is claimed as accepted. |
| `signature` | The signature image. | `null`. It is not substituted from elsewhere. |
| `submitted_at` | The submission date. | A note that no date was recorded. No date is invented. |
| `custom_question_wording` | The wording of a question the company has since deleted. | The answer is kept, `label: null`, `labelMissing: true`. The UUID is never shown as the question. |

Agreements on a reconstructed record are attributed to `legacy-1` — the wording
the old generator actually displayed, kept verbatim including its quirks — so
the document matches what the applicant saw rather than corrected prose.

## Reading the result

A reconstructed record is visibly distinct everywhere it surfaces: the PDF and
every application view label it as reconstructed and carry its provenance notes.
Nobody downstream can mistake it for a live submission.

## Limitations

* The job reconstructs from the application document. Information that was never
  written to Firestore cannot be recovered by any means, and is reported rather
  than filled.
* Reconstruction has not been run against real production data at the time of
  writing. Its behaviour is covered by unit tests over a simulated store,
  including the idempotency, dry-run, resume and refuses-to-overwrite paths, but
  the first real company should be dry-run and inspected before a live run.
