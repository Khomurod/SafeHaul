# Source-size refactor campaign — continuity tracker

**This file is written for an AI session with zero conversation context.**
Read [`PLAN.md`](PLAN.md) for *what* the campaign is; read this file for *where
it currently is*.

> **The tracker is a map, not the authority.** GitHub and a fresh
> `npm run check:source-size` are the authority. If this file and the repository
> disagree, **the repository is right and this file must be corrected before any
> other work begins.**

---

# CURRENT HANDOFF — READ THIS FIRST

| | |
|---|---|
| **Last updated** | 2026-08-28 (after the owner's first rulings) |
| **Verified main SHA** | `c023e3f4206cf41e28b8cf8a1c41e2372e2b392d` |
| **Oversized files** | **68** (re-measured after #51 and #52 merged) |
| **Backlog entries** | **68** |
| **Active work item** | `LD-R` — remove the landing site, rehome `/news` |
| **Active branch** | `claude/safehual-source-size-refactor-j4apre` (restarted from `c023e3f`) |
| **Active PR** | none yet for `LD-R`. #52 merged at `c023e3f`; #51 merged at `dd240a2`; #50 closed. |
| **PR head SHA** | — (a tracker commit cannot contain its own SHA; read `git rev-parse origin/claude/safehual-source-size-refactor-j4apre`) |
| **Review status** | Codex quota still exhausted. #52 merged on owner engagement with its contents, docs-only. |
| **CI status** | `main` green at `c023e3f`. |
| **Working tree at session end** | see the last per-item section |
| **Blockers** | Codex review quota exhausted — merges need human review. No owner decision outstanding. |

### Exact next action

`SEC-1` is **COMPLETE**. All four owner rulings are recorded in `PLAN.md` § 7.

**Current unit is `LD-R`** — remove the landing site and rehome `/news`. This is
the campaign's only deliberately behaviour-changing unit. Read the `LD-R` section
below before touching anything: the public blog is **not** independent of the
landing site today, and the ruling is to keep `/news` live, so this is a removal
*and* a rehome, not a delete.

The trap, stated once: deleting `landing/` alone takes `/news` down silently.
`/news` has no Hosting entry of its own — it reaches `serveBlogPublic` only
through rewrites on the two landing targets — and every rendered blog page links
`/assets/css/styles.css`, which *is* the 3447-line `LD-1` file.

After `LD-R`: `RU-1` (strengthen and split the rules tests) then `RU-2` (shrink
`firestore.rules` below 500 preserving permissions exactly, stopping to ask if it
cannot be done safely).

---

## Status vocabulary

`NOT STARTED` · `READY` · `IN PROGRESS` · `PR OPEN` · `REVIEW FIXES` ·
`CI PENDING` · `BLOCKED` · `MERGED` · `POST-MERGE VERIFY` · `COMPLETE`

---

## Progress

| | Count | Lines |
|---|---|---|
| Over-limit files at campaign start (2026-08-26 audit, incl. 2026-08-27 additions) | 70 | — |
| Retired before this tracker existed (PR #49) | 2 | — |
| **Remaining now** | **68** | **55,632** |
| Retired by this campaign so far | 0 | 0 |

---

## MASTER WORK TABLE

`Before` is the line count measured at campaign start on `a08a234`. `Current` is
the last measured count. Both are real measurements — **never fabricate a value;
use `—` until it exists.**

| ID | Status | Risk | Target | Before | Current | Branch | PR | Head | Review | CI | Merge | Post-merge | Removed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `SEC-1` | **COMPLETE** | R4 | reconcile PR #50 / #51 | — | — | `claude/secret-scan-loader-gateway` | #51 merged, #50 closed | `20c7550` | owner ruling | green | `dd240a2` | main green at `c023e3f` | 0 |
| `T-1` | NOT STARTED | R4 | `scripts/test-ci-plan.mjs` (tooling) | 1223 | 1223 | — | — | — | — | — | — | — | 1 |
| `T-2` | NOT STARTED | R2 | `scripts/check-ui-contract.mjs` (tooling) | 1030 | 1030 | — | — | — | — | — | — | — | 1 |
| `T-3` | NOT STARTED | R2 | `scripts/test-release-promotion.mjs` (tooling) | 584 | 584 | — | — | — | — | — | — | — | 1 |
| `T-4` | NOT STARTED | R3 | `scripts/deploy-functions-incremental.mjs` (tooling) | 525 | 525 | — | — | — | — | — | — | — | 1 |
| `T-5` | NOT STARTED | R4 | `scripts/ci-plan.mjs` (tooling) | 523 | 523 | — | — | — | — | — | — | — | 1 |
| `FT-1` | NOT STARTED | R1 | `functions/test/unit/blogPipeline.test.js` (test) | 1496 | 1496 | — | — | — | — | — | — | — | 1 |
| `FT-2` | NOT STARTED | R1 | `functions/test/unit/applicationDrafts.test.js` (test) | 1476 | 1476 | — | — | — | — | — | — | — | 1 |
| `FT-3` | NOT STARTED | R1 | `functions/test/unit/aiRouter.test.js` (test) | 1203 | 1203 | — | — | — | — | — | — | — | 1 |
| `FT-4` | NOT STARTED | R1 | `functions/test/unit/aiProviders.test.js` (test) | 940 | 940 | — | — | — | — | — | — | — | 1 |
| `FT-5` | NOT STARTED | R1 | `functions/test/unit/aiCredentials.test.js` (test) | 817 | 817 | — | — | — | — | — | — | — | 1 |
| `FT-6` | NOT STARTED | R1 | `functions/test/unit/aiHealthCheck.test.js` (test) | 645 | 645 | — | — | — | — | — | — | — | 1 |
| `FT-7` | NOT STARTED | R1 | `functions/test/unit/guestApplication.snapshot.test.js` (test) | 637 | 637 | — | — | — | — | — | — | — | 1 |
| `FT-8` | NOT STARTED | R1 | `functions/test/unit/environmentVault.callables.test.js` (test) | 588 | 588 | — | — | — | — | — | — | — | 1 |
| `FT-9` | NOT STARTED | R1 | `functions/test/unit/releaseManagement.callables.test.js` (test) | 577 | 577 | — | — | — | — | — | — | — | 1 |
| `FT-10` | NOT STARTED | R1 | `functions/test/bulkActions.test.js` (test) | 523 | 523 | — | — | — | — | — | — | — | 1 |
| `FR-1` | NOT STARTED | R3 | `functions/environmentVault/registry.js` (runtime) | 1188 | 1188 | — | — | — | — | — | — | — | 1 |
| `FR-2` | NOT STARTED | R3 | `functions/ai/callables.js` (runtime) | 951 | 951 | — | — | — | — | — | — | — | 1 |
| `FR-3` | NOT STARTED | R4 | `functions/applicationDrafts.js` (runtime) | 948 | 948 | — | — | — | — | — | — | — | 1 |
| `FR-4` | NOT STARTED | R3 | `functions/ai/router/router.js` (runtime) | 806 | 806 | — | — | — | — | — | — | — | 1 |
| `FR-5` | NOT STARTED | R3 | `functions/blog/pipeline/generate.js` (runtime) | 674 | 674 | — | — | — | — | — | — | — | 1 |
| `FR-6` | NOT STARTED | R3 | `functions/bulkActions/controllers/sessionController.js` (runtime) | 651 | 651 | — | — | — | — | — | — | — | 1 |
| `FR-7` | NOT STARTED | R4 | `functions/shared/pdf/applicationDocument.js` (runtime) | 643 | 643 | — | — | — | — | — | — | — | 1 |
| `FR-8` | NOT STARTED | R3 | `functions/blog/publicApi.js` (runtime) | 631 | 631 | — | — | — | — | — | — | — | 1 |
| `FR-9` | NOT STARTED | R3 | `functions/ai/registry/providers.js` (runtime) | 628 | 628 | — | — | — | — | — | — | — | 1 |
| `FR-10` | NOT STARTED | R3 | `functions/hrAdmin.js` (runtime) | 607 | 607 | — | — | — | — | — | — | — | 1 |
| `FR-11` | NOT STARTED | R4 | `functions/shared/pdf/documentBuilder.js` (runtime) | 599 | 599 | — | — | — | — | — | — | — | 1 |
| `FR-12` | NOT STARTED | R3 | `functions/releaseManagement/index.js` (runtime) | 517 | 517 | — | — | — | — | — | — | — | 1 |
| `FR-13` | NOT STARTED | R3 | `functions/bulkActions/workers/batchWorker.js` (runtime) | 511 | 511 | — | — | — | — | — | — | — | 1 |
| `FR-14` | NOT STARTED | R3 | `functions/ai/credentials/store.js` (runtime) | 505 | 505 | — | — | — | — | — | — | — | 1 |
| `SA-1` | NOT STARTED | R2 | `src/features/super-admin/views/AiIntegrationsView.jsx` (runtime) | 983 | 983 | — | — | — | — | — | — | — | 1 |
| `SA-2` | NOT STARTED | R1 | `src/features/super-admin/views/AiIntegrationsView.contract.test.jsx` (test) | 1699 | 1699 | — | — | — | — | — | — | — | 1 |
| `SA-3` | NOT STARTED | R2 | `src/features/super-admin/views/UnifiedDriverList.jsx` (runtime) | 656 | 656 | — | — | — | — | — | — | — | 1 |
| `SA-4` | NOT STARTED | R2 | `src/features/super-admin/hooks/useSystemHealth.js` (runtime) | 603 | 603 | — | — | — | — | — | — | — | 1 |
| `SA-5` | NOT STARTED | R2 | `src/features/super-admin/components/CreateView.jsx` (runtime) | 573 | 573 | — | — | — | — | — | — | — | 1 |
| `SA-6` | NOT STARTED | R2 | `src/features/super-admin/views/EnvironmentIntegrationsView.jsx` (runtime) | 563 | 563 | — | — | — | — | — | — | — | 1 |
| `SA-7` | NOT STARTED | R1 | `src/features/super-admin/views/EnvironmentIntegrationsView.contract.test.jsx` (test) | 709 | 709 | — | — | — | — | — | — | — | 1 |
| `SA-8` | NOT STARTED | R2 | `src/features/super-admin/views/LandingPageSettingsView.jsx` (runtime) | 536 | 536 | — | — | — | — | — | — | — | 1 |
| `SA-9` | NOT STARTED | R1 | `src/features/super-admin/views/BlogPostsView.contract.test.jsx` (test) | 570 | 570 | — | — | — | — | — | — | — | 1 |
| `CA-1` | NOT STARTED | R2 | `src/features/company-admin/components/modals/driver-dossier/tabs/ApplicationTab.jsx` (runtime) | 752 | 752 | — | — | — | — | — | — | — | 1 |
| `CA-2` | NOT STARTED | R2 | `src/features/company-admin/views/DocumentsManager.jsx` (runtime) | 735 | 735 | — | — | — | — | — | — | — | 1 |
| `CA-3` | NOT STARTED | R1 | `src/features/company-admin/views/DocumentsManager.test.jsx` (test) | 576 | 576 | — | — | — | — | — | — | — | 1 |
| `CA-4` | NOT STARTED | R2 | `src/features/company-admin/components/modals/VOEPreviewModal.jsx` (runtime) | 634 | 634 | — | — | — | — | — | — | — | 1 |
| `CA-5` | NOT STARTED | R1 | `src/features/company-admin/components/modals/VOEPreviewModal.contract.test.jsx` (test) | 751 | 751 | — | — | — | — | — | — | — | 1 |
| `CA-6` | NOT STARTED | R2 | `src/features/company-admin/components/tabs/PEVTab.jsx` (runtime) | 629 | 629 | — | — | — | — | — | — | — | 1 |
| `CA-7` | NOT STARTED | R1 | `src/features/company-admin/components/tabs/PEVTab.contract.test.jsx` (test) | 547 | 547 | — | — | — | — | — | — | — | 1 |
| `CA-8` | NOT STARTED | R2 | `src/features/company-admin/views/CompanyCandidatesListPage.jsx` (runtime) | 607 | 607 | — | — | — | — | — | — | — | 1 |
| `CA-9` | NOT STARTED | R2 | `src/features/company-admin/components/tabs/DQFileTab.jsx` (runtime) | 526 | 526 | — | — | — | — | — | — | — | 1 |
| `CA-10` | NOT STARTED | R1 | `src/features/company-admin/components/tabs/DossierBodies.contract.test.jsx` (test) | 667 | 667 | — | — | — | — | — | — | — | 1 |
| `CA-11` | NOT STARTED | R1 | `src/features/company-admin/views/UserProfilePage.test.jsx` (test) | 550 | 550 | — | — | — | — | — | — | — | 1 |
| `CA-12` | NOT STARTED | R1 | `src/features/company-admin/components/modals/PEVRequestModal.test.jsx` (test) | 545 | 545 | — | — | — | — | — | — | — | 1 |
| `CA-13` | NOT STARTED | R1 | `src/features/company-admin/hooks/useCompanyLeadUpload.contract.test.js` (test) | 507 | 507 | — | — | — | — | — | — | — | 1 |
| `SG-1` | NOT STARTED | R4 | `src/features/signing/EnvelopeCreator.jsx` (runtime) | 1363 | 1363 | — | — | — | — | — | — | — | 1 |
| `SG-2` | NOT STARTED | R1 | `src/features/signing/EnvelopeCreator.editor.test.jsx` (test) | 677 | 677 | — | — | — | — | — | — | — | 1 |
| `SG-3` | NOT STARTED | R1 | `src/features/signing/EnvelopeCreator.aiAssistant.test.jsx` (test) | 540 | 540 | — | — | — | — | — | — | — | 1 |
| `SG-4` | NOT STARTED | R3 | `src/features/signing/SigningRoom.jsx` (runtime) | 652 | 652 | — | — | — | — | — | — | — | 1 |
| `SG-5` | NOT STARTED | R1 | `src/features/signing/components/EnvelopeHistory.test.jsx` (test) | 755 | 755 | — | — | — | — | — | — | — | 1 |
| `SG-6` | NOT STARTED | R1 | `src/features/signing/hooks/useAiFieldAssistant.test.jsx` (test) | 534 | 534 | — | — | — | — | — | — | — | 1 |
| `SG-7` | NOT STARTED | R1 | `src/features/signing/components/envelope-creator/ResizableDraggableField.test.jsx` (test) | 502 | 502 | — | — | — | — | — | — | — | 1 |
| `PA-1` | NOT STARTED | R4 | `src/features/driver-app/components/application/PublicApplyHandler.jsx` (runtime) | 1476 | 1476 | — | — | — | — | — | — | — | 1 |
| `PA-2` | NOT STARTED | R2 | `src/features/driver-app/components/application/PublicApplyHandler.contract.test.jsx` (test) | 2203 | 2203 | — | — | — | — | — | — | — | 1 |
| `PA-3` | NOT STARTED | R1 | `src/features/driver-app/components/application/applicationDraftStorage.test.js` (test) | 511 | 511 | — | — | — | — | — | — | — | 1 |
| `SO-1` | NOT STARTED | R1 | `src/features/campaigns/components/LaunchPad.test.jsx` (test) | 539 | 539 | — | — | — | — | — | — | — | 1 |
| `SO-2` | NOT STARTED | R2 | `src/features/companies/hooks/useCompanyDashboard.js` (runtime) | 528 | 528 | — | — | — | — | — | — | — | 1 |
| `RU-1` | **READY** (after `LD-R`) | R3 | `src/tests/firestore.rules.security.test.js` (test) — split **and strengthen** | 1106 | 1106 | — | — | — | — | — | — | — | 1 |
| `RU-2` | **BLOCKED** by `RU-1` | R4 | `src/firestore.rules` (runtime) — no build step; stop and ask if unsafe | 693 | 693 | — | — | — | — | — | — | — | 1 |
| `LD-R` | **READY** | R4 | remove `landing/`; rehome `/news` onto its own Hosting target | 5989 | — | — | — | — | — | — | — | — | 3 |
| `LD-1` | **SUPERSEDED** by `LD-R` | R4 | `landing/assets/css/styles.css` | 3447 | 3447 | — | — | — | — | — | — | — | 1 |
| `LD-2` | **SUPERSEDED** by `LD-R` | R4 | `landing/index.html` | 1682 | 1682 | — | — | — | — | — | — | — | 1 |
| `LD-3` | **SUPERSEDED** by `LD-R` | R4 | `landing/assets/js/main.js` | 860 | 860 | — | — | — | — | — | — | — | 1 |
| `PA-0` | NOT STARTED | R1 | public-apply characterization coverage audit | — | — | — | — | — | — | — | — | — | 0 |
| `Z-1` | NOT STARTED | R1 | delete backlog file; final rescan; brief update | — | — | — | — | — | — | — | — | — | 0 |

---

# PER-WORK-ITEM LOG

A detailed section is written when a unit reaches `READY` or `IN PROGRESS`. A
split designed before the file is read is a guess, and a guess recorded here is
indistinguishable from a decision.

---

## `SEC-1` — Reconcile PR #50 and PR #51

**Status:** `READY` — awaiting owner ruling · **Risk:** R4

### Goal

Two open PRs from the same `main` address substantially overlapping
secret-scanner concerns. Decide which implementation reaches `main` before the
source-size campaign proceeds, without creating a third competing
implementation.

### What each PR is

| | **PR #50** "Harden secret-scan loader coverage" | **PR #51** "Importing is not the only way to hold a builtin" |
|---|---|---|
| Branch | `codex/fix-secret-scan-getbuiltinmodule-gateway` | `claude/secret-scan-loader-gateway` |
| Head | `9386b371ec6a83840aabf9604238693c733cb925` | `20c75500a235fe7beb1a12ab9b8cf03cf9466922` |
| Size | +144 / −18, 5 files, 7 commits | +97 / −13, 3 files, 2 commits |
| Approach | Escalating structural refusal: source escapes, a closed `process` allowlist, `global`/`globalThis`, comment-aware import grammar | Name-based refusal: match *the thing being named*, not the expression naming it |
| Codex rounds | 7, **each finding a new P1** | 1 (+ a self-found round 2) |
| Review on exact head | ✅ reviewed — **found an unresolved P1** | ❌ **never reviewed** (quota exhausted) |
| CI | ❌ **RED** — `test-functions` fails | ✅ **green**, all 18 checks |

### Verified evidence

Everything below was reproduced in this repository, not taken from the PR
descriptions. The comparison harness built each branch's `implementationFiles()`
and ran every known route through it.

```
route                                          main        PR#50       PR#51
------------------------------------------------------------------------------
getBuiltinModule (the reported P1)             GAP         refused     refused
aliased receiver: globalThis.process           GAP         refused     refused
destructured getBuiltinModule                  GAP         refused     refused
renamed destructure                            GAP         refused     refused
bracket-literal getBuiltinModule               GAP         refused     refused
computed key: 'getBuiltin' + 'Module'          GAP         refused     GAP
unicode-escaped name                           GAP         refused     GAP
process.binding                                GAP         refused     refused
node:vm import                                 GAP         GAP         refused
bare vm import                                 GAP         GAP         refused
node:module with a comment                     GAP         refused     GAP
hex-escaped node:module                        GAP         refused     GAP
constructor chain via process.env              GAP         refused     GAP
GROUPED chain (process.cwd())                  GAP         refused     GAP
OPTIONAL chain process.cwd()?.  <-- open P1    GAP         GAP         GAP
bare Function() without new                    refused     refused     refused
aliased eval                                   GAP         refused     GAP
*** POSITIVE: ordinary covered source ***      ACCEPTED    ACCEPTED    ACCEPTED
```

Three conclusions follow, and each matters:

1. **Both PRs close the actual reported vulnerability.** All five ordinary
   `getBuiltinModule` spellings — the route that was reported, reproduced, and
   demonstrated loading an outside CJS module — are refused by both.
2. **#50 covers strictly more, except `vm`.** It closes seven further routes
   (computed keys, escapes, comment-hidden imports, constructor chains, aliased
   `eval`) that #51 leaves open. #51 uniquely closes `node:vm` / bare `vm`.
3. **Neither closes the optional chain**, which is #50's own open P1.

### Why #50 cannot be merged as it stands

**Its CI failure is real, not a flake, and it is caused by the PR itself.**
`functions/test/unit/environmentRegistry.inventory.test.js` scans SafeHaul source
for configuration-key references and requires every referenced key to be
registered in the environment vault. #50's new fixtures embed the literal text
`process.env.X` and `process.env.constructor.constructor`, which that scanner
reads as two real configuration keys:

```
+ "X (referenced by scripts/secret-scan/test-coverage.mjs)",
+ "constructor (referenced by scripts/secret-scan/test-coverage.mjs)",
```

Result: `test-functions` fails (1 of 1636), which fails
`Verify the release is fully validated`, which skips both deploys. Verified
locally: the same suite **passes on #51's head** (21/21).

**Its unresolved P1 is real.** Reproduced directly against #50's own patterns:

```
ungrouped optional chain  process.cwd()?.constructor.constructor   -> ACCEPTED
grouped chain (fixed)     (process.cwd()).constructor.constructor  -> refused
```

So `process.cwd()?.constructor.constructor` still recovers `Function`. That is
round 8 of a sequence in which every round closed one spelling and review found
the next — and Codex quota is now exhausted, so a fixed head could not be
re-reviewed even if the fix were written.

### Residual risk, classified honestly

Per the campaign's instruction to separate real problems from theoretical ones:

1. **Actually credible and now closed by both PRs** — the `getBuiltinModule`
   gateway. Reported, reproduced, demonstrated loading an outside module.
2. **Theoretical / "disguised-but-legible"** — computed property names, Unicode
   and hex escapes, constructor chains, optional chains. Every one of these
   requires an author with commit access *deliberately obfuscating*.
   `AGENTS.md` already states the governing threat model: *"an author who can
   edit the scanner can also edit the assertions, and code review is the control
   for that."* These are code-review risks, not gate bypasses.
3. **Owner architecture decision** — whether to keep extending a regex toward
   JavaScript-parser equivalence. The evidence says it is not converging: seven
   rounds, seven P1s, one still open. `callable-contract` deliberately runs with
   no `npm ci`, so there is no parser available there anyway.

### Recommendation

**Merge #51. Close #50. Port #50's non-arms-race pieces in one small follow-up.**

Reasoning: #51 closes the actual vulnerability, is green, is focused, and adds
`vm` coverage that #50 lacks. #50 is red, carries a verified open P1, and its
extra coverage comes from the `process` allowlist — the same piece that caused
both the CI failure and rounds 5–8.

The follow-up PR should take from #50 only what closes a **class** rather than a
spelling, keeping fixtures free of literal `process.env.` text so the
environment-registry guard stays green:

| Port | Why | Closes |
|---|---|---|
| Escape refusal (`\uXXXX`, `\xXX`) | A class. Escapes transform before lookup, so raw-text search cannot interpret them; the scanner needs none. | 2 routes |
| Comment-aware separator on `module` imports | A class, and it reuses the `BETWEEN` constant that already exists for `MODULE_CALL`. | 2 routes |
| `\bFunction\b` / `\beval\b` as bare identifiers | A class — closes aliasing (`const ex = eval`), not one call spelling. | 1 route |
| `implementationFiles()` path normalization | A genuine portability bug: native paths break the L27 guard on Windows *before* it reaches the security assertions. | — |

**Do not port the `process` allowlist.** It is the piece that broke
`test-functions`, generated four consecutive P1s, and still has an open one.

Also fold in from #50: **`docs/APP_BRIEF.md:1093` says "70 files already over the
limit"; the measured number is 68.** That correction is needed regardless of how
`SEC-1` is decided.

Finally, `AGENTS.md` should record the residual (optional chains, computed names,
constructor chains, arbitrary data flow) as *stated* rather than implied — which
is the convention that file already follows.

### Final result — COMPLETE

Owner ruled 2026-08-28: **proceed with #51, close #50.** Executed.

- **#51 merged** at `dd240a2` (head `20c7550`, `mergeable_state: clean`, all 18
  checks green including `Verify the release is fully validated`).
- **#50 closed**, with a comment recording the reproduction evidence: its CI
  failure was caused by its own fixtures colliding with the environment-registry
  scan, and its optional-chain P1 reproduces on its exact head.
- `main` is `c023e3f` and green; backlog unchanged at 68/68.

**Carried forward — not lost.** A follow-up should port #50's *class*-closing
pieces: escape refusal (`\uXXXX`, `\xXX`), the comment-aware separator on `module`
imports, `Function`/`eval` matched as bare identifiers rather than one call
spelling, and the `implementationFiles()` path normalisation that fixes a real
Windows portability bug. **Not** the `process` allowlist. This is not yet a work
unit; it is recorded here so it is not forgotten.

**Residual risk, accepted and stated:** computed property names, constructor
chains, optional chains and arbitrary data flow remain outside this source scan.
`AGENTS.md`'s own threat model assigns them to code review.

### PR / merge information

#51 merged at `dd240a2`. #50 closed. Branch `claude/secret-scan-loader-gateway`.

---

## `LD-R` — Remove the landing site, rehome `/news`

**Status:** `READY` · **Risk:** R4 · **Retires:** `LD-1`, `LD-2`, `LD-3` (3 backlog entries, 5989 lines)

### Goal

Owner ruling: remove the SafeHaul landing page completely — no public landing site
until it is rebuilt from scratch — **while keeping `/news` live**.

**This is the campaign's only deliberately behaviour-changing unit.** The usual
"behaviour must be identical" rule does not apply to the marketing site, which is
being retired on purpose. It *does* still apply to the blog: its content, routes,
and rendered output must not change.

### The dependency map — read this before deleting anything

Deleting `landing/` alone takes `/news` down **silently**. Verified on `c023e3f`:

| What | Where | Why it matters |
|---|---|---|
| `/news`, `/news/**`, `/api/news/**`, `/sitemap.xml` | rewrites on **both** landing Hosting targets in `firebase.json` | The blog has **no Hosting entry of its own**. Remove the targets and the blog is unreachable. |
| `/assets/css/styles.css?v=8` | `functions/blog/publicApi.js` page shell | This *is* `landing/assets/css/styles.css` — the 3447-line `LD-1` file. Every rendered blog page links it. |
| `/assets/images/logo.svg`, `logo-mono.svg`, `news-fallback.svg` | same shell + card rendering | Blog header, footer and per-post fallback art. |
| `/assets/fonts/archivo-variable.woff2`, `geist-mono-variable.woff2` | preloaded in the shell | Self-hosted; the shell preloads exactly what the stylesheet declares. |
| `robots.txt` | served as the static `landing/robots.txt` | A test pins the served file to the static one. |
| shared card class names | `landing/assets/js/main.js` ↔ `publicApi.js` (`publicApi.js:347`) | The homepage strip and the blog index share classes. Only the blog side survives. |

### Planned split

1. **New Hosting targets for the blog** — `news-testing` / `news-production`,
   carrying the `serveBlogPublic` rewrites and the security headers the landing
   targets had (including `X-Robots-Tag: noindex` on testing only, which is why
   the two targets deliberately differ).
2. **A minimal blog stylesheet**, extracted from `styles.css` — only the rules the
   server-rendered shell and cards actually use. **It must come in under 500
   lines**: a file this campaign creates may never be backlogged.
3. **Keep** the fonts, `logo.svg`, `logo-mono.svg`, `news-fallback.svg` and
   `robots.txt`, relocated out of `landing/`.
4. **Delete** `index.html`, `privacy.html`, `main.js`, the full `styles.css`,
   `og-card.png`, `screenshots/`, `company_logos/`, `landing/README.md`.
5. **Remove** the two landing Hosting targets, the `/api/landing-lead` rewrite,
   the landing deploy steps in `main.yml` and `promote-production.yml`, and the
   `check:landing-claims` / `check:landing-a11y` / `capture:landing-screenshots`
   scripts and their npm entries. `check:landing-claims` is wired into
   `npm run lint` — that reference must go too or lint breaks.
6. **Delete** the landing-only tests `src/tests/landingPage.test.js` and
   `src/tests/landingNewsSection.test.js`; **update** `src/tests/hostingConfig.test.js`,
   which pins the Hosting config and the sitemap origin.

### Explicitly NOT in this unit — flagged, not deleted

The **lead-capture subsystem** is landing-adjacent but holds retained data:
`submitLandingLead`, `functions/landing/{callables,config,leads,telegram}.js`,
the `landing_leads` and `platform_settings` collections and their rules, and
`src/features/super-admin/views/LandingPageSettingsView.jsx` (536 lines — `SA-8`)
with its service and contract test.

With no landing page, `submitLandingLead` has no caller — but **historical leads
remain readable only through that view**. Deleting it destroys the only access
path to data the business may still want. The `/api/landing-lead` *rewrite* goes
(it is an obsolete deployment reference, which the ruling covers); the callable,
the collection, the rules and the view **stay**, recorded as a trash candidate for
an owner decision. See the trash register.

### Tests required

`npm test`, `npm run test:e2e` (chromium), `npm run check:ci-plan`,
`npm run check:source-size`, `npm run lint`, `npm run build`, and the functions
suite. Plus: a rendered blog page must be fetched and confirmed styled, with the
fonts and images resolving — a green unit suite cannot see a broken stylesheet
link.

### `LD-R` is two PRs, and the order is the safety property

Measured on `c023e3f`: the blog's 43 emitted classes pull in tokens (§1), reset and
base (§2), typography (§3), buttons (§5), navigation (§6), the news section (§16),
the footer (§18) and parts of responsive (§20) — **roughly 1400 lines** before any
trimming, and §16 alone is 539. So the blog stylesheet cannot be one file under
500; it splits into a few cohesive ones (tokens+base, components, news layout),
all linked from the shell. Several `<link>` tags is normal for a server-rendered
page, and `@import` is not an acceptable substitute.

**`LD-R1` — give the blog its own legs, remove nothing.**
Its own stylesheet set, its own copies of the fonts, logos, news fallback art and
`robots.txt`, and its own Hosting targets carrying the `serveBlogPublic` rewrites.
The landing site stays exactly as it is and keeps working. Fully reversible, and
it *proves* the blog stands alone before anything is deleted.

**`LD-R2` — remove the landing site.**
Only once `LD-R1` is merged and `/news` is confirmed serving correctly from its
own target. Deletes the landing HTML/CSS/JS and landing-only assets, both landing
Hosting targets, the `/api/landing-lead` rewrite, the landing deploy steps in both
workflows, and the three landing scripts with their npm entries (including the
`check:landing-claims` reference inside `npm run lint`, which breaks lint if
missed). Retires `LD-1`, `LD-2`, `LD-3`.

Doing it in this order means no moment exists where `/news` has lost the landing
assets but not yet gained its own. Doing it in one PR would create exactly that
window, and a unit suite cannot see a broken stylesheet link.

### Verification that a test suite cannot give you

CSS extraction regresses visually in ways unit tests do not catch. `LD-R1` must
include a rendered check: fetch a real blog index page and a real article page,
confirm the stylesheets, both font faces and every image resolve, and compare the
rendering against the same pages served from the landing target.

### Current stopping point

Not started. Dependency map and the two-PR split above are verified against
`c023e3f`.

---

## `RU-1` → `RU-2` — Firestore rules

**Status:** `RU-1` `READY` (after `LD-R`) · `RU-2` `BLOCKED` by `RU-1` · **Risk:** R3 → R4

### Goal

Owner ruling: **no concatenation or build step.** Strengthen and split the
security tests first, then shrink `src/firestore.rules` (693 lines) below 500
**preserving permissions exactly**. If that cannot be done safely, **stop and
request an owner decision** — that is part of the ruling, not an escape hatch.

### Behaviour that MUST remain unchanged

Every permission, for every role, on every collection. Tenant isolation. The
server-only collections (`platform_settings`, `landing_leads` are `read, write: if
false`). No matcher relaxed, no condition widened, no `allow` broadened — the
reduction must come from the file's own structure: shared helper functions and
collapsing genuinely duplicated matchers.

### `RU-1` must strengthen, not merely divide

The tests are what make `RU-2` safe. Splitting 1106 lines into three files without
adding coverage leaves the refactor resting on exactly the assurance it had
before. Required: identify collections and roles with thin or absent negative
coverage and add it **before** the rules file is touched.

### Current stopping point

Not started. `RU-2` must not begin until `RU-1` is merged.

---

## `T-1` — `scripts/test-ci-plan.mjs` (1223 lines) — note kept for later

**Status:** `NOT STARTED` · **Risk:** R4

Was the designated first unit before the owner's rulings reordered the campaign;
now queued behind `LD-R` and the rules work. The reasoning is kept because it is
not obvious from the file:

- **Why it is R4 despite being tooling:** it is half of a two-part contract.
  `ci-plan.mjs` and `test-ci-plan.mjs` pin each other, and this file's assertions
  (E6b/E6c on the `!cancelled()` pair, E6d/E6e on reporter jobs, J1–J5 on
  Playwright projects, §L on the secret scanner's wiring) are what stop the
  release pipeline from silently shipping nothing. A weakened assertion here
  fails **silently**.
- **Precedent exists:** PR #49 split the secret scanner and its tests by
  responsibility. Same shape of work, already reviewed.
- **No headroom:** recorded at 1358, measures 1223. The effective ceiling is the
  lower of the two.
- **Mandatory:** `npm run check:ci-plan` must pass.

---

# POTENTIALLY UNNECESSARY / TRASH FILES

No candidates confirmed yet. This section is populated as backlog files are read.

**Required per candidate:** path · reason it appears unnecessary · references and
imports searched · runtime/deployment references · confidence · recommendation ·
final decision.

**Verification checklist before proposing any deletion** — static imports;
dynamic imports; route registration; Firebase exports; workflows; package
scripts; Storybook; tests; deployment scripts; string/path loading. A file loaded
by a path built at runtime has no import to find. Do not delete something merely
because it looks old.

| Path | Reason | Refs searched | Confidence | Recommendation | Decision |
|---|---|---|---|---|---|
| `src/features/super-admin/views/LandingPageSettingsView.jsx` (536, = `SA-8`) + `services/landingSettings.js` + its contract test + `functions/landing/*` + `landing_leads` / `platform_settings` | Manages settings for, and captures leads from, a landing page that `LD-R` removes. `submitLandingLead` will have no caller once the page and its rewrite are gone. | `firebase.json` rewrites; `functions/index.js` exports; `ViewRouter.jsx`; `config/views.js`; `firestore.rules` 626–642; the callables `getLandingPageSettings`, `updateLandingTelegramConfig`, `setLandingTelegramEnabled`, `sendLandingTelegramTest`, `listLandingLeads`, `retryLandingLeadDelivery` | **High** that it becomes unreachable-by-users; **low** that it is safe to delete | **Keep for now.** Historical leads are readable *only* through this view — deleting it destroys the sole access path to retained business data. Revisit when the landing page is rebuilt. | **OWNER DECISION — open** |

---

# OWNER DECISIONS — RULED 2026-08-28

All four opening questions have been answered. Full text in `PLAN.md` § 7.

| # | Decision | Ruling | State |
|---|---|---|---|
| 1 | `SEC-1`: which secret-scan implementation reaches `main` | Proceed with **#51**, close **#50** | **Done** — #51 merged `dd240a2`, #50 closed with reasoning |
| 2 | The landing site | **Remove it completely.** No public landing site until rebuilt from scratch. Retire the backlog items rather than refactor them. | `LD-R` is `READY` |
| 2a | Follow-on: `/news` depends on the landing site | **Keep `/news` live** — its own Hosting target, its own minimal stylesheet and assets extracted from the landing ones | Folded into `LD-R` |
| 3 | `RU-2`: a build step for Firestore rules | **No concatenation or build step.** Strengthen and split the tests first, then shrink the rules file preserving permissions exactly. **Stop and ask if it cannot be done safely.** | `RU-1` → `RU-2` |
| 4 | Keeping the plan and tracker current | **Update both immediately when rulings land**, then continue | Standing rule; this update is it |

### Still open, not a blocker

**Codex review quota is exhausted.** Step 10 of the PR discipline cannot be met by
the bot. Until it returns, a work unit merges only with **human** review, and this
tracker records which kind each one got. "The bot declined" is not review.

---

# SESSION HANDOFF PROTOCOL

## At the START of a session

1. Read `PLAN.md`.
2. Read this file, especially **CURRENT HANDOFF**.
3. Check current `main` yourself: `git fetch origin main && git rev-parse origin/main`.
4. Check the active PR and branch yourself.
5. Check the current PR head SHA yourself.
6. Check unresolved review findings yourself.
7. Check latest-head CI yourself.
8. Run `npm run check:source-size` and compare against the counts above.
9. **Correct stale tracker information before continuing.**

Never trust this tracker over GitHub.

## At the END of a session — including on token/context pressure

Before stopping **for any reason**:

1. Stop creating new changes.
2. Ensure work is saved and pushed where appropriate.
3. Update this tracker.
4. Record the exact branch.
5. Record the exact commit / head SHA.
6. Record the PR number if one exists.
7. Record current test results.
8. Record unresolved review findings.
9. Record CI state.
10. Write an explicit **NEXT ACTION**.
11. Record any blocker or owner decision.
12. Commit and push the tracker update with the work.

**Never leave the next agent with "continue working on this."** Write something
precise: *"PR #57 head `abc123`. The P2 on `foo.js:143` is legitimate —
reproduction confirmed. Next session should fix that issue only, run suites
A/B/C, push, request review on the new exact head, then wait for CI."*

## The tracker moves with the code

Update it as a unit progresses `IN PROGRESS → PR OPEN → REVIEW FIXES →
CI PENDING → MERGED → COMPLETE`; whenever the backlog count changes; whenever an
entry leaves `.github/source-size-backlog.json`; whenever a trash candidate is
found; and whenever an owner decision is needed. Tracker updates are part of the
work, not documentation written at the end.
