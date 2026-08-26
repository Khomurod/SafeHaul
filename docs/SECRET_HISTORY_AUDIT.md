# Secret history audit — what is in SafeHaul's git history, and what to do about it

**Recorded 2026-08-26** against **gitleaks 8.30.1**, the version pinned in
`scripts/secret-scan.mjs`. Scope: every commit on every ref (`--log-opts=--all`).

**No secret value appears in this document, in the audit workflow's output, in its
artifact, or in the baseline file.** Everything below names a credential by its
*variable name*, *type* and *service*, which is what a rotation needs, and nothing
more. The audit runs gitleaks with `--redact`; the scripts only ever emit rule,
path, line, commit and date.

## Why this file exists separately from CI

Two questions were being answered by one job:

1. **Does this change introduce a secret?** Blocking. Answered per event by
   `scripts/secret-scan.mjs` (commit range + resulting tree), and it fails the
   release when the answer is yes.
2. **What is in the history?** A standing security question whose answer is the
   fixed, known set below.

Answering (2) inside the gate for (1) is what broke CI: on `workflow_dispatch` the
old `gitleaks/gitleaks-action@v2` passed no range at all, so a manual
re-verification of an already-merged commit scanned all 256 commits and reported
these legacy findings as though the release had introduced them. Run #159 on
`8c3315d` failed `secret-scan`, which failed `release-validation`, which skipped
both deploys. The history problem is real and is tracked here; it is not a reason
for every unrelated release to be unshippable.

The sweep now lives in `.github/workflows/secret-history-audit.yml` — weekly and
on demand, **not** in `release-validation`'s `needs`, so it reports without
gating. It fails only when a finding appears that is **not** in
`.github/secret-history-baseline.json`, i.e. when something *new* enters history.

## The inventory

**67 findings resolve to 8 distinct values.** The 67 is a count of *occurrences*:
the same Firebase web key appears 39 times because it was committed to several
files and rebuilt into several bundles.

None of these files is tracked on `main` today — `.env`, `functions/.env`,
`.replit`, `firebase-debug.log` and `dist/` are all in `.gitignore`, and only
`.env.example` / `functions/.env.example` remain. So the current source tree is
clean: the blocking scanner's tree scan passes on `main`, and these findings exist
only in old commits.

### 1. Genuine credentials — OWNER SECURITY ACTION required

Each of these was a real server-side secret committed to a file that is now
gitignored. Being in git history means anyone who can read the repository's
history can read them, and the repository is **public**. Treat all four as
disclosed and rotate them.

| # | Variable | Service / purpose | Where it was committed | Dates | Severity |
| --- | --- | --- | --- | --- | --- |
| 1 | `FACEBOOK_APP_SECRET` | Facebook app secret (Lead Ads integration) | `functions/.env` | 2026-01-07 | **High** — signs app-level API calls |
| 2 | `VITE_FACEBOOK_ACCESS_TOKEN` | Facebook access token, long-lived (219 chars) | `.env`, `functions/.env` | 2026-01-07 … 2026-01-22 | **High** — direct Graph API access |
| 3 | `BULK_WORKER_SECRET` | SafeHaul's own shared secret authenticating `initBulkSession` / `processBulkBatch` | `functions/.env` | 2026-02-15 … 2026-03-04 | **High** — authenticates bulk campaign workers |
| 4 | `FACEBOOK_VERIFY_TOKEN` | Facebook webhook verification token | `functions/.env` | 2026-01-07 | Medium — lets a third party complete webhook handshakes |

**What the owner needs to do**, none of which can be done from this repository:

1. **Rotate the Facebook app secret** in the Meta app dashboard, then update the
   Secret Manager / Functions configuration that consumes it.
2. **Invalidate the Facebook access token** (revoke it in the Meta app dashboard;
   long-lived tokens do not expire usefully on their own) and issue a new one.
3. **Regenerate `BULK_WORKER_SECRET`** and redeploy both bulk functions together —
   they must carry the same value, per `functions/.env.example`.
4. **Change `FACEBOOK_VERIFY_TOKEN`** and update the webhook subscription.

Until that is done, these remain valid credentials in a public history. Rotating
them is *not* blocked by anything in CI, and CI is not blocked by them.

### 2. Firebase client configuration — public by design, no rotation needed

| # | Value | Where | Dates |
| --- | --- | --- | --- |
| 5 | Google/Firebase **Web API key** (`AIza…`, 39 chars) — 39 of the 67 findings | `.env`, `functions/.env`, `.replit`, `src/lib/firebase/config.js`, three `dist/assets/*.js` bundles | 2025-12-22 … 2026-03-04 |

A Firebase Web API key is a **public client identifier**, not a credential:
Google documents it as safe to embed in client code, and SafeHaul in fact shipped
it inside browser bundles (three of the findings are those bundles). Access is
controlled by Firebase Security Rules and App Check, not by keeping this string
secret — and the rules are covered by the `rules-emulator` lane on every release.

*Advisory, not a leak response:* confirm the key has API restrictions applied in
the Google Cloud console (HTTP referrer restrictions and an allowlist of enabled
APIs). That limits abuse of quota, which is the actual risk with a public key.

### 3. Definite false positives

| # | Value | Where | Why it is not a secret |
| --- | --- | --- | --- |
| 6, 7 | Two 15-character schema identifiers | `src/lib/applicationSchema.js` and `functions/src/lib/applicationSchema.js` (10 findings) | Field keys in the application question schema. The rule fires because the surrounding identifier is literally `key` and the value clears the entropy threshold. They are structural identifiers, present in both copies of the schema, and readable in the current source. |

### 4. Expired ephemeral token

| # | Value | Where | Assessment |
| --- | --- | --- | --- |
| 8 | `sourceToken` (36 chars) in a Firebase CLI debug log | `firebase-debug.log`, 2026-01-05 | An emulator/CLI session token written by tooling, long expired and not re-usable. No rotation action. The lesson is that `firebase-debug.log` should never have been committed; it is gitignored now. |

## Why history is not being rewritten

Rewriting published history (`git filter-repo` / BFG) would invalidate every
existing clone, fork, open pull request and commit reference — including the SHAs
recorded in release attestations and in `release.json` on the deployed sites. It
also does not un-disclose anything: the repository is public, and anything that
was pushed must be assumed to have been fetched.

**Rotation is the effective remedy; history rewriting is cosmetic by comparison.**
It stays available as an explicit, owner-approved operation if there is ever a
reason to take the disruption — and it is deliberately not automated.

## Keeping this file honest

- The audit compares **identities**, not a total. Every known finding is
  recorded in `.github/secret-history-baseline.json` as
  `commit:file:rule:startline` — a location, containing no part of any value —
  and a finding that is not in that list fails the audit.

  It used to compare counts, and review on 2026-08-26 showed why that was not
  enough: one legacy finding disappearing (a stale branch deleted) leaves room
  for a *new* secret to take its place at the same total, and the audit would
  have called that `unchanged`. That matters most here, because the blocking
  scanner only runs for `main` and pull requests targeting it — a secret parked
  on an unmerged branch is this audit's to catch.
- When history is cleaned, or the pinned gitleaks version changes and the new
  set has been reviewed, update the baseline **and** this file in the same
  change. A version change reports rather than fails, because rule sets differ
  between gitleaks releases.
- When a credential above is rotated, say so here with the date. A rotated
  credential still appears in history and will still be counted; what changes is
  that the finding stops mattering, and only this file can record that.

| Credential | Rotated? |
| --- | --- |
| `FACEBOOK_APP_SECRET` | **Not yet — owner action** |
| `VITE_FACEBOOK_ACCESS_TOKEN` | **Not yet — owner action** |
| `BULK_WORKER_SECRET` | **Not yet — owner action** |
| `FACEBOOK_VERIFY_TOKEN` | **Not yet — owner action** |
