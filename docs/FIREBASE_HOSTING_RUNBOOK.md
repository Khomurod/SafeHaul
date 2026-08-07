# SafeHaul Firebase Hosting runbook

This is the permanent source of truth for SafeHaul website hosting.

**SafeHaul has ONE active repository: `Khomurod/SafeHaul`.** It has two frontend
release channels — Testing and Production — that share one real Firebase backend.

`Khomurod/SafeHaul-for-Gemini-Antigravity` is **archived and inactive**. It is
kept for history and must never be developed or deployed from. Its deploy jobs
are guarded off by repository name, so even a manual "Run workflow" there does
nothing.

## What deploys where

| Channel | Application | Landing page | How it updates |
|---|---|---|---|
| Testing | `truckerapp-system.web.app` | `safehaul-landing-testing.web.app` | automatically, on every merge to `main` |
| Production | `app.safehaul.io` | `safehaul.io`, `www.safehaul.io` | only by explicit promotion of a tested release |

The application builds into `dist/`. The marketing site is the static `landing/`
folder. `.firebaserc` maps four named deploy targets to four Firebase Hosting
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
   deploys the Testing application and Testing landing site, and records a
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
completed green** — queued, in-progress and entirely absent all count as refusals,
because "has not failed yet" is not the same as "passed".

The same module is imported by both the promotion workflow and the Super Admin
callables, so the two cannot drift apart.

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
backend rollout, or with any required check red, queued, running or missing is
refused before any Google credential is minted. Those refusals are covered by
`npm run check:release-scripts`.

The `@` in the source is not interchangeable with a colon. The pinned Firebase
CLI parses `<site>:<something>` as a *channel* source and only tries the version
parser when that split fails, so `site:@version` looks for a channel literally
named `@version` and errors out. `firebase hosting:clone --help` and the CLI's own
error message both give the two accepted forms: `<site>:<channel>` or
`<site>@<version>`.

The **landing page is deployed from the approved SHA rather than cloned**, on
purpose. The two landing targets have deliberately different Hosting config: the
testing site sends `X-Robots-Tag: noindex, nofollow` to stay out of search
results. Cloning it onto `safehaul.io` would carry that header across and
de-index the marketing site. `landing/` is static, so deploying from the pinned
commit is still exactly reproducible.

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

## Landing lead form security

`landing/assets/js/main.js` posts to `/api/landing-lead`. Firebase Hosting
rewrites that URL to the `submitLandingLead` Cloud Function. The function:

- accepts only approved SafeHaul origins and JSON POSTs;
- validates lengths, email, company-size and goal values;
- quietly drops honeypot spam;
- enforces a fail-closed per-IP rate limit;
- sends a plain-text Telegram message without logging lead details; and
- reads `LANDING_TELEGRAM_BOT_TOKEN` and `LANDING_TELEGRAM_CHAT_ID` only from
  Google Secret Manager.

Never place Telegram credentials in HTML, browser JavaScript, `.env` files that
are committed, GitHub secrets, or GitHub Actions. The old Landing-page
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

The landing targets now serve the automated blog as well as the marketing pages.
Rewrites on **both** `landing-testing` and `landing-production`, in this order:

1. `/api/landing-lead` -> `submitLandingLead`
2. `/news` -> `serveBlogPublic`
3. `/news/**` -> `serveBlogPublic`
4. `/api/news/**` -> `serveBlogPublic`
5. `/sitemap.xml` -> `serveBlogPublic`
6. `/robots.txt` -> `serveBlogPublic`
7. `**` -> `/index.html`

**The order matters.** The `**` catch-all must stay last: placed above the
specific rules it swallows them and returns the marketing homepage for every
article URL, sitemap request and card fetch. The landing-lead rule stays first so
it is unaffected.

This also fixes a pre-existing soft-404: `safehaul.io/sitemap.xml` and
`/robots.txt` previously returned the homepage with HTTP 200. They are now real
responses generated from published articles.

Nothing about the app targets (`testing`, `production`) changed, so
`app.safehaul.io` is unaffected. No new subdomain is introduced, so **no Dynadot
change is required** — `/news` is a path on the existing landing site.

Verification after a production deploy:

- `https://safehaul.io/news` returns an index page (or the empty-state copy
  before the first article publishes).
- `https://safehaul.io/sitemap.xml` and `/news/feed.xml` return XML, not HTML.
- `https://safehaul.io/api/news/latest?limit=3` returns JSON.
- `https://safehaul.io/` still renders, and the lead form still submits.
- `https://www.safehaul.io/news` behaves identically.
- `https://app.safehaul.io` is unchanged.
