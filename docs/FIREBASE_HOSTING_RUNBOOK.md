# SafeHaul Firebase Hosting runbook

This is the permanent source of truth for SafeHaul website hosting. Both the
application and the marketing landing page live in each SafeHaul repository and
deploy automatically from the same GitHub workflow.

## What deploys where

| Repository | Application | Landing page |
|---|---|---|
| `Khomurod/SafeHaul-for-Gemini-Antigravity` | `truckerapp-system.web.app` | `safehaul-landing-testing.web.app` |
| `Khomurod/SafeHaul` | `app.safehaul.io` | `safehaul.io` and `www.safehaul.io` |

The application files build into `dist/`. The marketing site is the static
`landing/` folder. `.firebaserc` maps four named deploy targets to four Firebase
Hosting sites. `.github/workflows/main.yml` chooses the test or production pair
from `github.repository`, so the repositories can keep the same files.

## Normal release process

1. Make and test changes in `SafeHaul-for-Gemini-Antigravity`.
2. Merge them to that repository's `main` branch. GitHub Actions tests and
   deploys both test sites automatically.
3. Verify the test application and `safehaul-landing-testing.web.app`.
4. Copy the tested project files into `SafeHaul`, but never copy `.git`, `.env`,
   `node_modules`, `dist`, coverage output, or local logs.
5. Commit and merge the production repository. The same workflow tests and
   deploys `app.safehaul.io` and the root marketing site.

No Vercel setting, GitHub environment variable, downloaded Google key, or
manual Firebase deployment is part of the normal release.

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
- Google Secret Manager owns runtime secrets.
- Firebase Hosting serves the four sites and certificates.
- Dynadot owns only domain registration and DNS.
- Vercel is not part of the active SafeHaul architecture after migration.

## Recovery

If a release fails, do not change Dynadot first. Open the failed GitHub Actions
run, fix the failing test or deploy, and merge again. Firebase retains prior
Hosting releases, so the last successful version remains available. The former
Vercel project and separate `Landing-page` repository may be retained as
inactive history, but they must not own `safehaul.io` or auto-deploy production.
