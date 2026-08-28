# SafeHaul Firebase Hosting runbook

This is the permanent source of truth for SafeHaul website hosting.

**SafeHaul has ONE active repository: `Khomurod/SafeHaul`.** It has two frontend
release channels — Testing and Production — that share one real Firebase backend.

`Khomurod/SafeHaul-for-Gemini-Antigravity` is **archived and inactive**. It is
kept for history and must never be developed or deployed from. Its deploy jobs
are guarded off by repository name, so even a manual "Run workflow" there does
nothing.

## What deploys where

| Channel | Application | Public site | How it updates |
|---|---|---|---|
| Testing | `truckerapp-system.web.app` | `safehaul-landing-testing.web.app` | automatically, on every merge to `main` |
| Production | `app.safehaul.io` | `safehaul.io`, `www.safehaul.io` | only by explicit promotion of a tested release |

The application builds into `dist/`. The public site is the static `web/` folder
— the blog's stylesheets and assets plus a standalone privacy page. The marketing
site that used to live in `landing/` was removed; the Hosting **targets** kept
their `landing-*` aliases because a Firebase Hosting site cannot be renamed, and
because `landing_version_id` is a field in the persisted release record that the
Production promotion gate reads. **The names are historical; what they serve is
`web/`.** `.firebaserc` maps four named deploy targets to four Firebase Hosting
sites, all inside the single Firebase project `truckerapp-system`.

**Testing is not a sandbox.** It runs against the same real Firestore, Auth,
Storage, Functions and integrations as Production. A driver who opens a Testing
application link is filing a real application. The only difference between the
channels is which frontend build is being served.

## Normal release process

```
feature branch → PR → full CI → merge to main
      → Testing deploys automatically   (truckerapp-system.web.app)
      → shared backend rolls out
      → release marked ready            ← the eligibility point
      → real-world testing
      → Super Admin → Releases → Release to Production
      → exact tested Hosting version cloned
      → Production                      (app.safehaul.io)
      → live verification
```

1. Open a PR into `main`. Required CI must be green.
2. Merge. `deploy-testing` in `.github/workflows/main.yml` builds the commit,
   deploys the Testing application and Testing public site, and records a
   GitHub Deployment for environment `testing` that pins the immutable Firebase
   Hosting version IDs it just created. **That record is created as
   `in_progress`, not `success`** — see the eligibility point below.
3. The shared backend rolls out in the same run: Firestore rules, Storage rules,
   Firestore indexes, Cloud Functions and the post-deploy smoke check.
4. `release-ready` runs last. It lists every deploy job in `needs:`, so it cannot
   start until all of them have passed, and its only job is to mark the Testing
   deployment `success`. **A release becomes promotable at that moment and not
   before.**
5. Verify Testing. The live commit is always readable without credentials:

   ```
   curl https://truckerapp-system.web.app/release.json
   ```

6. Release. In the app: **Super Admin → Releases → Release Testing version to
   Production**, confirm the dialog, and watch the screen follow the release to
   completion. Nothing else reaches production.

A merge to `main` never updates the Production frontend. No Vercel setting, no
downloaded Google key, and no manual `firebase deploy` is part of a normal
release.

### The eligibility point, and why it exists

Testing and Production run against **one** Firebase backend. If a release became
promotable the moment its frontend was on Testing, a frontend that depends on a
new Cloud Function, rule or index could be promoted to Production while that
backend change was still deploying — or after it had failed. Production would
then be serving a frontend whose backend never shipped.

So the Testing deployment record is written `in_progress` and is only promoted to
`success` by `release-ready`, after every deploy job has succeeded. The gate in
`functions/releaseManagement/eligibility.js` requires that `success`, and
separately requires every check in `REQUIRED_RELEASE_CHECKS` to be **present and
concluded `success`** — queued, in-progress, skipped and entirely absent all count
as refusals, because "has not failed yet" is not the same as "passed".

The same module is imported by both the promotion workflow and the Super Admin
callables, so the two cannot drift apart.

### Why the required-check list is short

`main.yml` does not re-run a test on `main` when it can prove the identical source
tree already passed that test during the pull request. The proof is a git tree
hash, and the mechanism is described in `scripts/ci-plan.mjs`. So individual test
jobs — `frontend-quality`, the `frontend-e2e` shards, `rules-emulator`,
`test-functions`, `frontend-build`, the Storybook catalog — are routinely
**skipped** on a merge.

That is why they are not in `REQUIRED_RELEASE_CHECKS`. Listing them would force a
choice between blocking every optimised release and accepting `skipped` as a pass,
and accepting `skipped` for a required check means accepting a test that did not
happen.

Instead one required check vouches for all of them:

> **`Verify the release is fully validated`**

It is a separate job (`scripts/verify-release-validation.mjs`) that re-derives,
per lane, whether the lane ran green in this run, or was skipped with proof it
passed on this exact tree, or was skipped because nothing in the change can affect
it. Anything else fails it. It is declared `if: always()` so it reports even when
a lane failed or the run was cancelled, and both deploy jobs sit behind it — so a
release that cannot satisfy it never gets a Testing deployment record at all.

A red test lane still blocks a promotion even though lanes are not required: the
gate also sweeps every other check on the commit and refuses any that concluded
badly.

These properties are covered by `npm run check:release-scripts` and
`npm run check:ci-plan`, both of which run on every pull request and every merge
in the `callable-contract` job — which is itself never skippable, because the
checks that guard the optimisation must not be skippable by the optimisation.

### Branch protection: require the gate, not the lanes

Set the repository's required status checks to:

- `Verify the release is fully validated`
- `secret-scan`

and **not** to individual lanes. A lane can legitimately be skipped — a
documentation-only pull request runs no test lane at all — and GitHub treats a
required status check that never reports as permanently pending, so a rule naming
`frontend-quality` or `E2E shard 1 of 4 (Chromium)` would block that pull request
forever with nothing to fix.

The gate is the right thing to require because it is the thing that cannot be
skipped: it is declared `if: always()`, and it fails unless every lane ran or is
provably covered. Requiring it is equivalent to requiring all the lanes, without
the pending-forever trap.

One cosmetic note: a skipped matrix job is listed by GitHub under its unexpanded
name, so on a run where the browser lane is skipped you will see a check called
`E2E shard ${{ matrix.shard }} of 4 (Chromium)`. That is GitHub rendering an
un-expanded matrix, not a broken workflow. It is not required by anything.

## Releasing from Super Admin

**Super Admin → Releases** is the normal route to Production.

The screen shows the Testing version, when it was released, whether its checks
passed, whether the shared backend rollout completed, and whether it is eligible —
plus the current Production version and the previous one. When a release is not
eligible it says why in plain language rather than simply being unavailable.

There is deliberately **no field for typing a version**. The system already knows
which version Testing is serving; the server resolves it from the GitHub
Deployment records and re-verifies eligibility immediately before dispatching
anything. A version sent by a browser is never what gets released — the client's
`expectedSha` is compared against the server's own answer purely so that a
confirmation dialog which went stale (a newer Testing release landed while it was
open) is refused instead of silently releasing something nobody approved.

Both callables (`promoteTestingToProduction`, `rollbackProductionRelease`) require
an authenticated caller with exactly `globalRole === 'super_admin'` on the
verified ID token, plus a recent sign-in, plus a fail-closed rate limit. A role
claimed in the request payload means nothing.

Concurrency is handled twice: GitHub is asked whether a promotion run is already
active, and a Firestore lock covers the seconds before a dispatched run exists.
The workflow's own `concurrency` group queues rather than cancels, because
cancelling a half-finished production release is worse than making a second click
wait.

### How the backend authenticates to GitHub

A **GitHub App** installed on `Khomurod/SafeHaul` only, with Actions: write and
Contents / Deployments / Checks / Metadata: read. It cannot push code, merge,
change workflows, read repository secrets or touch any other repository.

Its App id, installation id and private key live in Google Secret Manager as
`RELEASE_GITHUB_APP_ID`, `RELEASE_GITHUB_INSTALLATION_ID` and
`RELEASE_GITHUB_PRIVATE_KEY`, are bound to the release callables with
`secrets: [...]`, and are inventoried in Super Admin → Environment &
Integrations like every other platform secret. The private key never leaves the
Cloud Functions runtime; what travels is a one-hour installation token minted on
demand and cached in memory only.

**No GitHub or Google deployment credential exists in the browser bundle**, in a
`VITE_*` variable, in Firestore, in localStorage or in any request payload. The
browser's entire vocabulary is "release the version you consider ready".

If the credential is not configured, the screen says so and every release action
is refused — it never falls back to a weaker path.

**Why the secrets carry a placeholder.** A Functions deploy binds each name in
`secrets: [...]` to `versions/latest`, so a secret with no version at all would
fail the deploy of every release callable — and, because they ship together, the
`deploy-functions` job with them. Each of the three therefore holds the literal
value `not-configured` as version 1. That is deliberately **not** a working
credential: `RELEASE_GITHUB_PRIVATE_KEY` fails the PEM check, so
`isCredentialConfigured()` returns false and the screen correctly reports that it
is not connected. Adding the real value as a new version supersedes it —

```
gcloud secrets versions add RELEASE_GITHUB_APP_ID --project truckerapp-system --data-file=-
gcloud secrets versions add RELEASE_GITHUB_INSTALLATION_ID --project truckerapp-system --data-file=-
gcloud secrets versions add RELEASE_GITHUB_PRIVATE_KEY --project truckerapp-system --data-file=<the .pem>
```

**Rotating the credential requires a deploy, not just a new secret version.** A
Functions deploy pins each bound secret to the version that existed *at deploy
time* — the Cloud Run service ends up with `secretKeyRef.key: '3'`, not `latest`.
Adding a new version therefore changes nothing at runtime on its own, and the
incremental deploy planner would not redeploy these functions either, because
rotating a credential touches no source file.

So the three release callables are listed in `DEPLOY_FUNCTIONS_ALWAYS_INCLUDE` in
`main.yml` and are redeployed on every push to `main`. To rotate: add the new
secret versions, then re-run the **CI/CD Pipeline** workflow on `main` and
confirm the new binding:

```
gcloud run services describe getreleasestatus --project truckerapp-system \
  --region us-central1 --format=yaml | grep -A2 RELEASE_GITHUB_PRIVATE_KEY
```

The `key:` in that output is the secret version actually in use. If it is not the
one you just added, the deploy did not happen and the old credential is still
live. `scripts/test-release-promotion.mjs` asserts the always-include list still
contains all three, so this cannot silently regress.

### Audit trail

Every promotion and rollback writes to `environment_audit_log`, the same
Admin-SDK-only collection the Environment & Integrations vault uses: who acted,
the released SHA, the previous Production SHA, the pinned Hosting version, the
request id and the outcome once the run finishes. Denials are recorded too.
Values, tokens and key material are never recorded — the audit writer accepts an
explicit field allowlist and drops everything else.

GitHub Deployments remain the authoritative record of *what is released*; the
audit log records *the human administrative action*.

### Why promotion copies a version, not a branch

The promotion workflow does **not** rebuild `main`. It resolves the candidate SHA
against its recorded Testing deployment and clones that exact immutable Hosting
version:

```
firebase hosting:clone truckerapp-system@VERSION_ID safehaul-app-production:live
```

So a commit merged after approval cannot ride along, and Production receives the
same bytes that were tested — not a fresh build that merely came from the same
commit. A candidate with no successful Testing release record, with an unfinished
backend rollout, or with any required check red, queued, running, skipped or
missing is refused before any Google credential is minted. Those refusals are
covered by `npm run check:release-scripts`.

The `@` in the source is not interchangeable with a colon. The pinned Firebase
CLI parses `<site>:<something>` as a *channel* source and only tries the version
parser when that split fails, so `site:@version` looks for a channel literally
named `@version` and errors out. `firebase hosting:clone --help` and the CLI's own
error message both give the two accepted forms: `<site>:<channel>` or
`<site>@<version>`.

The **public site is deployed from the approved SHA rather than cloned**, on
purpose. The two public targets have deliberately different Hosting config: the
testing site sends `X-Robots-Tag: noindex, nofollow` to stay out of search
results. Cloning it onto `safehaul.io` would carry that header across and
de-index the live site. `web/` is static, so deploying from the pinned commit is
still exactly reproducible.

## Rolling back Production

Rollback restores an exact previous release. Firebase keeps prior Hosting
versions, and each past release's version IDs stay recorded on its GitHub
Deployment, so releasing a previously released SHA restores that frontend
exactly. It rewrites no Git history and mutates no business data.

**Normal route.** Super Admin → Releases → **Roll back to previous release**. The
server chooses the target itself — the previous *successful* Production release on
record — so this action carries no version from the browser either. It goes
through the same eligibility gate as a forward release and is audited the same
way. The button is only offered when a previous release actually exists.

**Manual route**, if the app itself is what is broken: run the **Promote a tested
release to Production** workflow with that older 40-character SHA. Find it under
the repository's **Deployments → production**, or
`curl https://app.safehaul.io/release.json` for the current one.

**What rollback does not undo.** Testing and Production share one backend, so
rolling the frontend back does not roll back Cloud Functions, Firestore rules,
indexes or data. That is only safe because backend changes are required to be
backward compatible (below). If a backend change is not safely reversible, say so
in the PR rather than relying on rollback.

## Shared-backend rules (expand/contract)

There is one Firebase project. A backend change ships with the *Testing*
frontend while the *older Production* frontend is still live, so it must keep
working for both.

Safe: add a new callable alongside the old one; add optional fields; accept old
and new payload shapes during a transition; put new behaviour behind a flag;
widen a schema before depending on it.

Not safe: rename or delete a callable before Production has been promoted past
it; remove fields the live Production UI still reads; tighten rules against
currently deployed Production behaviour; run an irreversible data migration to
support an experimental UI.

If a change cannot coexist with the currently released Production frontend,
split it into a compatible staged rollout: expand → promote → contract.

## URLs and DNS in plain language

- A path after the domain, such as `safehaul.io/example`, is controlled by files
  and rewrites in this repository. Dynadot does not need a change.
- An anchor such as `safehaul.io/#pricing` is also code-only.
- A hostname before the domain, such as `example.safehaul.io`, is a new DNS and
  TLS identity. Firebase requires that hostname to be explicitly connected to a
  Hosting site, and Dynadot needs one matching DNS record. This cannot safely be
  reduced to code-only on Firebase Hosting because an unmatched wildcard would
  not have the required Firebase domain mapping and certificate.

For a new marketing URL, prefer a path (`safehaul.io/example`). Reserve
subdomains for genuinely separate applications or environments.

## Landing lead form security — **retired**

> **The form and its route are gone.** `landing/assets/js/main.js` posted to
> `/api/landing-lead`, and both the page and the Hosting rewrite were removed with
> the marketing site. `submitLandingLead` itself is retired separately, preserving
> every captured lead. **Any rebuilt lead capture is to be built fresh** — do not
> revive this endpoint. The properties below are kept as the bar a replacement
> must clear, and the credential warning below still applies to any token.

The retired function:

- accepts only approved SafeHaul origins and JSON POSTs;
- validates lengths, email, company-size and goal values;
- quietly drops honeypot spam;
- enforces a fail-closed per-IP rate limit;
- sends a plain-text Telegram message without logging lead details; and
- reads `LANDING_TELEGRAM_BOT_TOKEN` and `LANDING_TELEGRAM_CHAT_ID` only from
  Google Secret Manager.

Never place Telegram credentials in HTML, browser JavaScript, `.env` files that
are committed, GitHub secrets, or GitHub Actions. **This rule does not retire with
the form.** The old Landing-page
repository exposed its bot token publicly; rotate that token through BotFather
after the Firebase endpoint is verified. Adding a new Secret Manager version is
not enough unless the token itself is newly generated.

## Provider ownership

- GitHub owns source history and starts deployments.
- Google Workload Identity Federation authenticates GitHub without a JSON key.
- A narrowly scoped GitHub App authenticates SafeHaul's backend *to* GitHub, so
  the Super Admin Releases screen can start a release without any credential
  reaching the browser.
- Google Secret Manager owns runtime secrets.
- Firebase Hosting serves the four sites and certificates.
- Dynadot owns only domain registration and DNS.
- Vercel is not part of the active SafeHaul architecture after migration.

## Recovery

If a release fails, do not change Dynadot first — a failed release is almost
never a DNS problem.

**A Testing deploy failed.** The previous Testing release stays live; Firebase
only swaps a site to a new version after a successful upload. Fix the failing
test or deploy and merge again. The failed commit has no successful Testing
release record, so it is not promotable in the meantime.

**The backend rollout failed but the Testing frontend deployed.** This is the case
the eligibility point exists for. The Testing site is serving the new frontend,
but its release record is still `in_progress`, so the Releases screen shows the
version as *not ready* and names the unfinished work. Fix the backend failure and
merge again; the next successful run produces a promotable release. Do not force a
release past this state — Production shares that backend.

**A release failed.** The Releases screen says so and states that Production was
not changed. Check which step failed in the workflow run:

- Failed at *Resolve and verify the tested release*: nothing was deployed and no
  Google credential was minted. The message states why the candidate was
  refused.
- Failed at *Promote the application* or *Verify the live production release*:
  Production may still be on the previous version. Confirm what is actually live
  with `curl https://app.safehaul.io/release.json`, then either re-run the
  promotion or promote the previous known-good SHA.

Releasing is idempotent: asking for the SHA already live is a no-op, so a
double-click or a retry is safe. A second release while one is running is refused
rather than queued behind an unknown state.

**The Releases screen says it is not connected to the deployment pipeline.** The
GitHub App credential is missing from Secret Manager or from the deployed
functions' `secrets:` binding. Nothing is broken and nothing is at risk; the
release path is simply closed until the credential is configured. Use the manual
workflow route meanwhile.

**Emergency: Production is broken and CI is unavailable.** Promote the previous
good SHA (rollback, above) — it needs only the promotion workflow. If GitHub
Actions itself is down, a holder of the `safehaul-github-deployer` identity can
run the same clone by hand:

```
firebase hosting:clone truckerapp-system@VERSION_ID safehaul-app-production:live \
  --project truckerapp-system
```

Record what was done afterwards, because a manual clone leaves no GitHub
Deployment record and the release history will otherwise be wrong.

The former Vercel project, the separate `Landing-page` repository, and
`SafeHaul-for-Gemini-Antigravity` may be retained as inactive history, but they
must not own `safehaul.io` or deploy anything.


## News & Insights routes

The public targets serve the automated blog and the privacy page. Rewrites on
**both** `landing-testing` and `landing-production` (historical aliases), in this
order:

1. `/news` -> `serveBlogPublic`
2. `/news/**` -> `serveBlogPublic`
3. `/api/news/**` -> `serveBlogPublic`
4. `/sitemap.xml` -> `serveBlogPublic`

Plus one **redirect**, which Hosting applies before rewrites: `/` -> `/news`.
`/api/landing-lead` led this list until the form was removed, and a `**` ->
`/index.html` catch-all followed it until the homepage it pointed at was removed;
`web/` contains no `index.html`, so the redirect is what keeps the apex from
404ing.

`/robots.txt` is **not** a rewrite — it is the static `web/robots.txt`, and
Hosting serves a real file in preference to any rewrite. (An earlier revision of
this list claimed a `serveBlogPublic` rewrite for it; `firebase.json` has never
had one. The behaviour was always correct; the documentation was not.)

**The order matters, if a catch-all ever comes back.** A `**` rule placed above
the specific ones swallows them and returns the wrong page for every article URL
and sitemap request. `src/tests/hostingConfig.test.js` keeps that assertion
conditionally — it does not require a catch-all, but it fails one that is not
last.

This also fixes a pre-existing soft-404: `safehaul.io/sitemap.xml` previously
returned the homepage with HTTP 200. It is now a real response generated from
published articles. `/robots.txt` was already a real static file.

Nothing about the app targets (`testing`, `production`) changed, so
`app.safehaul.io` is unaffected. No new subdomain is introduced, so **no Dynadot
change is required** — `/news` is a path on the existing public site.

Verification after a production deploy:

- `https://safehaul.io/news` returns an index page (or the empty-state copy
  before the first article publishes).
- `https://safehaul.io/sitemap.xml` and `/news/feed.xml` return XML, not HTML.
- `https://safehaul.io/api/news/latest?limit=3` returns JSON.
- `https://safehaul.io/` still renders, and the lead form still submits.
- `https://www.safehaul.io/news` behaves identically.
- `https://app.safehaul.io` is unchanged.
