---
paths:
  - ".github/**"
  - "scripts/ci-plan/**"
  - "scripts/secret-scan/**"
  - "scripts/release-promotion-tests/**"
  - "scripts/*{deploy,release,promot,ci-plan,secret,shipped,health}*"
  - ".gitleaks.toml"
  - "firebase.json"
---

# Changing the release pipeline and its security gates

Covers `.github/workflows/`, the CI planner, deploy and promotion scripts and
the secret scanner. Each rule below cost a broken or silent release once; the
incidents are in `docs/archive/agent-instructions-2026-10-02.md`.

## How a release flows

Merge to `main` → plan → test lanes (a lane may be skipped when the same tree was
already proven) → `release-validation` → deploy Cloud Functions (incremental) and
deploy Testing → `verify-shipped` → `release-ready`. Testing and Production share
one backend. Production changes only when someone promotes an already validated
Testing version (Super Admin → Releases, `promote-production.yml`).

## Rules

1. **A skipped job's skip travels down the whole chain**, and `always()` does not
   stop it. Every job below `release-validation` carries both clauses:
   `!cancelled() &&` and `needs.<each-dependency>.result == 'success'`. The first
   opts out of the inherited skip, the second re-checks by hand; drop either and
   you silently stop deploying or deploy after a failure. `check:ci-plan`
   E6b/E6c assert both.
2. **Reporter jobs are the opposite.** `release-validation` and `verify-shipped`
   must run when their dependencies failed, and check results in their scripts
   (E6d/E6e). Do not apply one category's rule to the other.
3. **Fix the family, not the instance.** When you find a CI bug, list every job
   with the same shape before fixing one, and write the test over the set.
4. **A green run is not evidence that anything shipped.** `verify-shipped` reads
   the deployed SHA back off the live site, `release-ready` depends on it, and
   `health-check.yml` asks daily. Neither is advisory.
5. **Before merging a pipeline change, run `npm run check:ci-plan`; after merging,
   watch the real `main` run to completion.** A pull request never deploys, so it
   cannot exercise the path you changed.
6. **Deploy jobs cancel in progress per concurrency group**, so an older run can
   cancel a newer one's deploy. After overlapping merges, confirm the latest run
   actually deployed.

## Security gates (secret scan)

- `scripts/secret-scan.mjs` chooses the scan range for every event; never use a
  third-party scanning action, and never let a gate scan all history (that is
  `secret-history-audit`, which gates nothing).
- A pull request is compared with its base. Every other event anchors at the
  newest ancestor whose `secret-scan` **and** "Verify the release is fully
  validated" passed in the same run. No such ancestor, a base equal to the head,
  or any path that cannot determine a base: refuse. Resolve a base to its full SHA
  before comparing anything.
- An override (`SECRET_SCAN_BASE`, `SOURCE_SIZE_BASE`) must name a validated
  release that contains the automatic base — never the head, never older.
- A scanner that exits non-zero with an empty report did not finish: refuse, and
  refuse any scan that did not report success.
- `.gitleaks.toml`'s non-comment content is pinned line for line (L24a);
  `gitleaks:allow` comments are ignored (`--ignore-gitleaks-allow`, L25); a
  `.gitleaksignore` file makes the scan refuse (L26).
- `npm run test:secret-scan` §L reads the scanner's own source as a derived set
  (`scripts/secret-scan/test-sources.mjs`, L27/L28) and refuses dynamic-import
  gateways by name. Its known limit — a computed name such as
  `globalThis['ev' + 'al']` — is left to code review.
- A gate must never take its scope from the branch it is gating, or from
  anything narrower than the claim it makes.
