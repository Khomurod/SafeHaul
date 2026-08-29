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
| **Last updated** | 2026-08-28, after the second landing ruling |
| **Verified main SHA** | `78e157723c48ad57b84e35898326f6eeba4b8daa` (#55 / `LD-R2` merged) |
| **Oversized files** | **64** (was 68) — `LD-R2` retired three landing entries, `LD-R3` retired `SA-8` |
| **Backlog entries** | **64** |
| **Active work item** | `LD-R3` — done locally, PR pending. `T-1` next. |
| **Active branch** | `claude/safehual-source-size-refactor-j4apre` |
| **Active PR** | `LD-R3` not yet opened. #55, #54, #53, #52, #51 merged; #50 closed. |
| **PR head SHA** | read `git rev-parse origin/claude/safehual-source-size-refactor-j4apre` — a tracker commit cannot contain its own SHA |
| **Review status** | Codex quota still exhausted. Merges need human review. |
| **CI status** | #54: the size refusal is FIXED and `callable-contract` passes. Earlier "failures" on `f93c925`/`dee9688` were **concurrency cancellations** from rapid pushes, not defects — check for `cancelled` lanes before investigating one. |
| **Working tree at session end** | see the last per-item section |
| **Blockers** | none. The nav-placement question was delegated and decided — see `PLAN.md` § 7.2b. |

### Exact next action

1. **Merge #54** once its head is green (`LD-R1`).
2. **Start `LD-R2`** — restart the branch from the new `main`, then work the
   removal surface mapped in the `LD-R2` section. **Read that section first:** two
   interlocks break the build if the deletion is taken at face value — `landing`
   is a `REQUIRED_ROOT` in `source-size-scope.mjs`, and `ci-plan.mjs` maps
   `landing/` to the lane holding its tests. Neither is optional.
3. Then `LD-R3` (lead subsystem), which has its own mapped section and one open
   owner question.

**Two process rules learned the hard way in this session, both worth keeping:**

- **Read the verdict line, not the count.** `npm run check:source-size | grep
  'file(s) over'` prints the inventory and *drops* `source-size REFUSED:`. A
  green-looking summary is not a pass.
- **Do not push in quick succession.** Each push cancels the previous run under
  the concurrency group, and the reporter job then correctly refuses a run whose
  lanes were cancelled — which arrives as a CI *failure* notification that is not
  a defect. Batch commits, push once. When a failure appears, check whether the
  lanes say `cancelled` before investigating.

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
| **Remaining now** | **64** | **49,107** |
| Retired by this campaign so far | **4** | **6,525** |

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
| `SA-8` | **COMPLETE** (replaced by `LD-R3`) | R2 | `LandingPageSettingsView.jsx` → `WebsiteLeadsView.jsx` | 536 | **231** | — | — | — | — | — | — | — | 1 ✓ |
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
| `LD-R1` | **COMPLETE** | R4 | stand up `web/`; blog serves from its own stylesheets | — | — | `claude/safehual-source-size-refactor-j4apre` | #54 | `78a7e4a` | owner ruling | green | `1e399de` | main green | 0 |
| `LD-R2` | **COMPLETE** | R4 | delete `landing/`, its scripts, tests and workflow steps | 5989 | **0 — deleted** | `claude/safehual-source-size-refactor-j4apre` | #55 | `57fe54f` | owner ruling | green | `78e1577` | main green | **3 ✓** |
| `LD-R3` | **IN PROGRESS** | R3 | retire lead capture/Telegram/settings; read-only Website Leads + CSV | — | — | `claude/safehual-source-size-refactor-j4apre` | — | — | — | local green | — | — | **1 ✓ (`SA-8`)** |
| `LD-1` | **COMPLETE** (deleted by `LD-R2`) | R4 | `landing/assets/css/styles.css` | 3447 | **gone** | — | — | — | — | — | — | — | 1 ✓ |
| `LD-2` | **COMPLETE** (deleted by `LD-R2`) | R4 | `landing/index.html` | 1682 | **gone** | — | — | — | — | — | — | — | 1 ✓ |
| `LD-3` | **COMPLETE** (deleted by `LD-R2`) | R4 | `landing/assets/js/main.js` | 860 | **gone** | — | — | — | — | — | — | — | 1 ✓ |
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

### Owner rulings folded in (2026-08-28)

- **Blog navigation:** strip to blog-only links. The shell used to emit 13 links
  into the marketing site (`/`, `/#features`, `/#pricing`, `/#why-safehaul`,
  `/#get-started`, `/#faq`); all would have 404'd. Nav is now News & Insights,
  Contact and Log in; the logo points at `/news`.
- **`privacy.html`: REVERSED — preserved, not removed.** The first ruling removed
  it with the marketing site; the second ruling keeps it as a simple standalone
  page for public users. This is what the compliance concern argued for. Both
  answers are recorded, in order, so a later reader who finds the removal in the
  history can see it was reconsidered deliberately rather than lost and restored
  by accident. It now lives at `web/privacy.html`, carries no JavaScript, and is
  linked from the blog footer again.
- **Lead subsystem: retire the machinery, keep the records.** Active capture
  (`submitLandingLead`), Telegram delivery and configuration, resend/test-send and
  the Landing Page Settings screen are all retired. **No lead data is deleted.**
  A minimal read-only *Historical Website Leads* Super Admin view with CSV export
  replaces the settings screen. Future capture is to be rebuilt fresh. This became
  `LD-R3` — a read-only view with CSV export is a feature, not a deletion, and
  folding it into a removal PR would make both harder to review.

### Infrastructure finding that reshaped the split

The Hosting **sites** are `safehaul-landing-{testing,production}` and a site
cannot be renamed or created from this repository. So the blog does **not** get
new targets — the existing targets keep their `landing-*` aliases and change what
they serve, from `landing/` to `web/`. No infrastructure action is needed.

### `LD-R1` — work completed

- **`web/`** created: five stylesheets, both self-hosted font faces, `logo.svg`,
  `logo-mono.svg`, `news-fallback.svg`, `robots.txt`.
- **The stylesheets were extracted, not rewritten.** A script parsed the 3447-line
  original, kept every rule whose selector names one of the blog's 43 emitted
  classes (plus element/`:root` rules), recursed into media queries, trimmed
  grouped selectors to the parts the blog uses, and kept only the one `@keyframes`
  still referenced. Cut at the original's own section boundaries **in source
  order**, so the cascade is unchanged.
- `firebase.json`: both targets `public: landing` → `web`; `/api/landing-lead`
  rewrite removed; `**` catch-all removed (it pointed at an `index.html` that
  `web/` does not contain); `/` → `/news` redirect added so the apex does not 404.
- `publicApi.js`: five `<link>` tags, nav and footer stripped to links that
  resolve, stale comments corrected.
- `hostingConfig.test.js` updated **without weakening it** — the catch-all
  ordering assertion is kept conditionally (the hazard returns if anyone re-adds
  one), and two new contracts were added: the lead route must stay absent, and the
  root redirect must exist.

| Check | Result |
|---|---|
| functions suite | **1636/1636**, 103 suites |
| `src/tests/` | **716 passed**, 64 skipped |
| `hostingConfig` + both landing suites | 83 passed |
| `check:source-size` | 68/68 unchanged — every new file is under 500 |
| `test:source-size` (incl. A7 format coverage) | pass |
| `check:ci-plan` | pass |
| `npm run lint` | pass |
| Rendered asset check | every `/assets/**` URL the shell emits resolves in `web/`; no `/#…` or `/privacy.html` left |
| **Chromium render, 1440 and 412** | 5 sheets load (135 rules), Archivo applies, tokens resolve, cards grid, **no horizontal scroll at 412**, 0 failed/4xx requests |

**One real bug was caught by the visual check and fixed:** backticks inside the
HTML comments I added terminated the JS template literal. A second apparent
problem — the card grid rendering in a 200px column — was my preview harness
putting `.news-rail` after `.news-grid`; the real markup emits the rail first and
the CSS is faithful. Both are recorded because "the render looked wrong" is
otherwise indistinguishable between the two.

### `news-article.css` has little headroom

476 lines against the 500 limit. It is section 16 of the original — the only
section written for these pages rather than borrowed — so it is cohesive, but a
substantial addition to the blog's article styling will need it split further.

### `LD-R1` — the privacy page (added after the second ruling)

`web/privacy.html` is the old `landing/privacy.html` content on the blog's shell:
no JavaScript, no build step, nav and footer carrying only links that resolve, and
its own `policy.css` (114 lines) holding the `.privacy-hero` / `.policy-content` /
`.policy-section` rules that were spread across the original's sections 3, 4 and
16. It is linked **after `news-chrome.css` and before `news-footer.css`**, which is
where those rules sat relative to everything else. `news-article.css` is not
linked on this page and `policy.css` is not linked on blog pages; neither needs the
other, and keeping them apart is what left `news-article.css` its 24 lines of
headroom.

**Proven identical, not merely inspected.** Both the old page (served from
`landing/`) and the new one were rendered in Chromium and their computed styles
compared element by element — `h1`, hero paragraph, `h2`, `h3`, `p`, `li`, `ul`,
links and the content wrapper, on font, size, line-height, margins, colour and
width, plus section count and text length. **Every probe matched.**

One real defect was caught doing it: extracting only `<main>` dropped the
`.privacy-hero` header, leaving the page with **no `h1`**. Restored, and the
heading order is now h1 → h2 → h3 with exactly one h1.

Two new contracts were added to `hostingConfig.test.js`: the policy page must
exist, keep its canonical URL, carry no `<script>` and contain no link back into
the removed marketing site; and the blog footer must link to it. A privacy link
that 404s is worse than no link, so the file and the link are asserted together.

### The gate caught me, and the reason is worth keeping

CI refused `LD-R1`'s first head: **`functions/blog/publicApi.js` was 642 lines,
up from the 631 recorded.** A backlogged file may not grow, and the comments I
added to the shell had grown it. Correct refusal — the ratchet doing exactly its
job, on the campaign's own work.

**It had been failing locally the whole time and I did not see it.** After the
first few runs I narrowed the command to `npm run check:source-size | grep 'file(s)
over'`, which prints the inventory line and *drops the verdict* — `source-size
REFUSED:` never reached me. A green-looking summary is not a pass. **Read the
verdict line, not the count.**

Fixed by tightening the three comments to their operative sentences; the file is
back to **exactly 631**. That is compliant but leaves zero headroom, so the next
edit to `publicApi.js` trips the same rule until `FR-8` splits it.

### `LD-R2` — the complete removal surface, mapped on `386f8a8`

**Retires `LD-1`, `LD-2`, `LD-3`: backlog 68 → 65.**

**Delete**
- `landing/` entire tree (18 files) — `index.html`, `privacy.html`, `main.js`,
  `styles.css`, both fonts, all images, `robots.txt`, `README.md`.
  Everything `/news` and `/privacy.html` still need already lives in `web/`.
- `scripts/check-landing-a11y.mjs`, `scripts/capture-landing-screenshots.mjs`.
- `src/tests/landingPage.test.js`, `src/tests/landingNewsSection.test.js` — both
  read only `landing/` files, which is why they still pass in `LD-R1`.
- `.github/source-size-backlog.json`: the three `landing/` entries.
- `package.json`: `check:landing-a11y`, `capture:landing-screenshots`.

**Keep, repointed — NOT deleted**
- `scripts/check-landing-claims.mjs` → `check-public-claims.mjs`, scanning `web/`.
  It runs the *same* `checkClaims()` export the article pipeline runs, against
  shipped HTML, and it is fail-closed ("no HTML found — that is not a pass").
  `web/privacy.html` contains exactly the MVR/PSP language it guards. Deleting a
  live product-truth gate because its name says "landing" would be the campaign
  removing a safety property by accident. Stays wired into `npm run lint`.

**Two interlocks that break the build if missed — both verified**
1. **`scripts/source-size-scope.mjs` — `REQUIRED_ROOTS` contains `landing`**, and
   every root is asserted non-empty on every run. Delete `landing/` without
   changing this and **`check:source-size` fails**. Change it to `web`.
2. **`scripts/ci-plan.mjs` maps `landing/` → `frontend_unit`**, with a comment
   recording the outage that mapping was written for: a landing-only commit once
   selected no lanes, CI went green, and `main` shipped a broken homepage.
   `scripts/test-ci-plan.mjs` pins it in **A5**, **A5b** and the line-158 case.
   Repoint all of them at `web/`. *(Checked: unmapped paths fall through to
   `null` → full suite, so `web/` is currently over-tested rather than
   under-tested. `LD-R1` did not open a gap.)*

**RENAME NOTHING IN THE RELEASE PLUMBING.** This is the trap in `LD-R2`, and the
obvious instinct — "remove every reference to landing" — walks straight into it.

`landingVersionId` is not a variable name. It is a **field in the persisted
release-record payload**, written by `scripts/record-release.mjs`, read by
`scripts/resolve-testing-release.mjs`, and — the part that matters — read by the
**production promotion gate**:

```js
// functions/releaseManagement/eligibility.js:353
if (!deployment.payload.landingVersionId) continue;
```

Every release record already in Firestore carries that field. A renamed reader
would find it absent on all of them, `continue` past every one, and resolve no
eligible release — so **nothing could be promoted to Production, and it would
fail by silently skipping rather than by erroring.** Renaming it is a data
migration, not a rename, and this campaign has no mandate for one.

So these all **stay exactly as they are**: `landingVersionId`,
`LANDING_VERSION_ID`, `landing_version_id`, `FIREBASE_LANDING_TARGET`, the
`landing-testing` / `landing-production` target aliases, and the
`safehaul-landing-*` Hosting site IDs. They are stable identifiers threading
through the release record and the promotion gate. `scripts/test-release-promotion.mjs`
and `functions/test/unit/releaseManagement.callables.test.js` pin the payload
shape, which is the safety net proving this.

**Workflows — the deploy steps STAY, only their wording changes.** The Hosting
targets keep their `landing-*` aliases because a Firebase **site** cannot be
renamed, and they now serve `web/`. Update the step names and comments in
`.github/workflows/main.yml` (lines ~836, ~892, ~907, ~921) and
`.github/workflows/promote-production.yml` (~51, ~70, ~146-157, ~173) so they
stop describing a marketing site. **Do not remove a deploy step** — that would
stop `/news` and the privacy page shipping.

**Documentation — 11 files mention the landing site**
`PRODUCT.md` (14), `docs/APP_BRIEF.md` (20), `docs/news-and-insights.md` (22),
`docs/FIREBASE_HOSTING_RUNBOOK.md` (19), `DESIGN.md` (10),
`docs/environment-and-integrations-runbook.md` (8), `README.md` (6),
`AGENTS.md` (5), `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` (2),
`docs/firestore-data-model.md` (1), `src/design-system/stories/README.md` (1).
`AGENTS.md` matters most: its source-size section names
`landing/assets/css/styles.css` and `landing/index.html` as files that may not be
splittable without a build step. That question is now **answered by deletion**,
and the section should say so rather than leaving a stale open question.

### `LD-R3` — the lead subsystem, mapped on `386f8a8`

Owner ruling: **retire the machinery, keep every record.** Nothing below deletes
lead data, and `landing_leads` keeps its `allow read, write: if false` rule — the
documents hold third-party contact details plus a completion-token hash, so they
stay server-only and reach the screen through a callable, exactly as now.

**Callables — six go, one stays**

| Callable | Fate |
|---|---|
| `submitLandingLead` | **delete** — active capture; no page can reach it |
| `getLandingPageSettings` | **delete** — settings screen |
| `updateLandingTelegramConfig` | **delete** — Telegram configuration |
| `setLandingTelegramEnabled` | **delete** — Telegram configuration |
| `sendLandingTelegramTest` | **delete** — test-send |
| `retryLandingLeadDelivery` | **delete** — resend |
| `listLandingLeads` | **KEEP** — the read-only view needs it |

**Backend files** (1446 lines today)
- `functions/landingLead.js` (357) — delete, that *is* active capture.
- `functions/landing/telegram.js` (178) — delete, delivery.
- `functions/landing/config.js` (285) — delete, Telegram credential config.
- `functions/landing/leads.js` (307) — reduce to read-only listing.
- `functions/landing/callables.js` (319) — reduce to `listLandingLeads`, plus
  whatever the CSV export needs.

Check `functions/environmentVault/registry.js` for Telegram configuration keys —
it appears in the landing reference sweep, and a registry entry for a key nothing
reads any more fails `environmentRegistry.inventory.test.js` from the other
direction ("registers no key that SafeHaul does not reference").

**Frontend**
- `src/features/super-admin/views/LandingPageSettingsView.jsx` (**536 = `SA-8`**)
  → replaced by a much smaller read-only *Historical Website Leads* view with CSV
  export. **This likely retires `SA-8` from the backlog as well**, so `LD-R3` is
  worth one more entry than it first appears: 65 → 64.
- `services/landingSettings.js` — reduce to the one surviving call.
- `LandingPageSettingsView.contract.test.jsx` — replaced, not deleted: the new
  view needs its own contract test, and the old one is the template for it.
- `config/views.js` and `ViewRouter.jsx` — retitle and re-point the nav entry.

**CSV export** is client-side from the rows `listLandingLeads` already returns —
no new callable, no new export endpoint, and nothing that could widen what leaves
the server.

**Open question for the owner when this starts:** whether the archive keeps its
own Super Admin nav entry, or moves somewhere less prominent given nobody needs
it daily.

### `LD-R2` — done locally

Deleted: `landing/` (18 files), `check-landing-a11y.mjs`,
`capture-landing-screenshots.mjs`, `landingPage.test.js`,
`landingNewsSection.test.js`, three npm scripts, three backlog entries.
**41 files changed, +288 / −7771.**

Both interlocks moved with the directory: `REQUIRED_ROOTS` `landing` → `web`
(and `A6b`, which pins that list by name, follows it), and the `ci-plan.mjs`
lane mapping plus `A5`/`A5b`. The claims checker is
`scripts/check-public-claims.mjs`, scanning `web/`, still in `npm run lint`.
Release plumbing renamed: **nothing**.

`functions/environmentVault/registry.js` lost `LANDING_A11Y_PORT` — the inventory
test caught it from the *unreferenced* direction the moment the script reading it
was deleted, exactly as the `LD-R3` notes predicted. 1188 → 1187 lines.

Eleven documents corrected. `AGENTS.md`'s open question about a build step for the
landing site is now answered, and the answer was neither of the two it offered:
**delete the thing.** That is recorded there as a general lesson for a file that
looks unsplittable.

| Check | Result |
|---|---|
| functions | **1636/1636**, 103 suites |
| `src/tests/` | 658 passed, 64 skipped (the two landing suites are gone) |
| `check:source-size` | **65 over limit / 65 recorded** — the `REQUIRED_ROOTS` interlock held |
| `test:source-size` | pass, `A6b` included |
| `check:ci-plan` | pass |
| `npm run lint` | pass — claims checker green on `web/privacy.html` |
| `npm run build` | pass |
| `npm run typecheck` | 14 errors, **identical on `origin/main`** — pre-existing, not this change |
| Static serve of `web/` | privacy, robots, both stylesheets, logo and font all 200 |

**One process note.** Comparing typecheck against `main` with
`git checkout origin/main -- .` re-staged the deleted files into the index while
the working tree lacked them, and `check:source-size` **refused** — "the index and
the working tree disagree, so no size for it can be trusted". Correct refusal, and
a good check to have. `git add -A` resolved it. Verify the index after any
`git checkout <ref> -- .` used for comparison.

### `LD-R3` — done locally

**Six callables retired, one kept.** `submitLandingLead`, `getLandingPageSettings`,
`updateLandingTelegramConfig`, `setLandingTelegramEnabled`, `sendLandingTelegramTest`
and `retryLandingLeadDelivery` are gone; `listLandingLeads` survives because the
archive screen has to read the records. **No lead data is deleted**, and
`landing_leads` keeps `allow read, write: if false` — the rule text is unchanged,
only its comment.

| | before | after |
|---|---|---|
| `functions/landingLead.js` | 357 | deleted |
| `functions/landing/telegram.js` | 178 | deleted |
| `functions/landing/config.js` | 285 | deleted |
| `functions/landing/leads.js` | 307 | **72** |
| `functions/landing/callables.js` | 319 | **81** |
| `LandingPageSettingsView.jsx` | 536 (`SA-8`) | **`WebsiteLeadsView.jsx`, 231** |
| `services/landingSettings.js` | 117 | **`websiteLeads.js`, 41** |

**Nav placement was delegated to me and decided:** it keeps a Super Admin entry,
retitled *Website Leads*, in `ops`. Full reasoning in `PLAN.md` § 7.2b — the short
version is that this screen is the only path to the data, so a screen nobody can
find is indistinguishable from data that was deleted, which invites exactly the
cleanup the preservation ruling was guarding against. Verified first that no deep
link or stored preference persists a view id, so renaming `landing-page` →
`website-leads` breaks no bookmark.

**CSV export is client-side** from the rows `listLandingLeads` already returns —
no new callable, no export endpoint, nothing that can leave the server through a
path the existing audit record does not cover. It escapes formula-leading
characters (`=`, `+`, `-`, `@`, tab) with a leading apostrophe: every field was
typed by a member of the public, and a spreadsheet runs a cell that starts with
one. Six of the new tests cover exactly that.

**Four guards fired during this work, all correctly:**

1. `environmentRegistry.inventory` — the retired Telegram keys became
   *unreferenced*, from the direction the `LD-R3` notes predicted.
2. `secretBindingGenerations` — four now-unbound secrets became stale
   expectations. "A stale entry would quietly license a future binding nobody
   granted."
3. `check:source-size` — `SA-8` fell under the limit, so its backlog entry had to
   go: *"a renamed or deleted file does not carry its exemption with it."*
4. `no-irregular-whitespace` — the literal BOM in the CSV export. Escaped to
   `\uFEFF`; it is there so Excel reads UTF-8 rather than the local codepage.

| Check | Result |
|---|---|
| functions | **1597/1597**, 102 suites |
| frontend, all of `src/` | **4489 passed**, 64 skipped, 244 files |
| `check:source-size` | **64 over limit / 64 recorded** |
| `test:source-size` · `check:ci-plan` · `lint` | pass, **0 lint errors** |

### The visual gate caught a real bug, and the fix has a second half

CI went red on `Build the design-system catalog`: **a pixel baseline changed.**
It was not a baseline that needed re-recording — it was a **defect I had
introduced**, and only this lane could see it.

The nav config named `icon: 'Inbox'`, and `SuperAdminSidebar` resolves icon names
through an explicit `ICONS` map that did not import it. `ICONS['Inbox']` was
`undefined`, which **does not throw** — the icon rendered as nothing, the row
collapsed to zero width, and the label wrapped **one character per line**, making
the page 119px taller. Unit tests passed, lint passed, typecheck passed, the build
passed. Only a full-page screenshot getting taller caught it.

Fixed by importing `Inbox`, and hardened so it cannot recur silently: an
unrecognised icon name now **throws**, and `SuperAdminSidebar.icons.test.jsx`
asserts every configured entry resolves. That test was proven to fail on the exact
bug (`InboxTypo` → 1 failed) before being kept.

**Do not blanket-run `test:visual:update` to clear this lane.** Doing so here
would have committed the broken navigation as the new expected appearance.

### Baselines cannot be re-recorded in this container — and the reason is exact

After the fix the two `super-admin` baselines still differ by ~3%, which is the
intended label and icon change. They cannot be regenerated here:

- **CI runs Chromium 147 (Playwright revision 1217).** This container has 1194
  (141.0.7390.37); installing pulled 1200 (143), never 1217.
- Proof it is environmental, not the change: **every `company-*` visual test fails
  locally at the same ~3%**, and this branch touches no file that renders a
  company screen — only `src/features/super-admin/`, `functions/`, rules and
  tests.
- So a locally-recorded PNG would be *wrong for CI*, and would replace
  CI-correct baselines with container-correct ones. **The locally regenerated
  files were reverted rather than committed.**

**The correct path, which uses CI's own rendering:** push the fix, let the visual
lane fail on the two intended diffs, then take the `super-admin-*-actual.png`
files out of the `visual-regression-diff` artifact CI uploads and commit those as
the baselines. The artifact exists for exactly this. It costs one extra CI cycle
and is the only way to record a baseline this container cannot render.

### Baselines taken from CI's artifact — the method, since it will be needed again

Done, and worth writing down because this container can never record a baseline.
The `visual-regression-diff` artifact CI uploads on failure contains, per failing
screen, `-expected`, `-actual` and `-diff` PNGs **rendered by CI's own Chromium**.
The `-actual` files are therefore exactly what a correct baseline should be.

```
gh api /repos/<owner>/<repo>/actions/artifacts/<id>/zip > vr.zip   # id from list_workflow_run_artifacts
unzip vr.zip && cp test-results/<...>/<name>-actual.png e2e/visual/__screenshots__/app.spec.cjs/<name>.png
```

**Four things checked before trusting an actual, all of which passed:**

1. **The artifact is from the fixed head**, not the broken one — otherwise the
   defect gets baked in as the expectation. (`head_sha` on the artifact.)
2. **Only the intended screens failed.** CI produced actuals for `super-admin`
   desktop and mobile and nothing else, confirming the icon fix held and no other
   screen moved.
3. **The three attempts are byte-identical** (`sha256` across the run and both
   retries). A screen that renders differently on retry is flaky, and no attempt
   of it should be blessed.
4. **CI's `-expected` matches the committed baseline byte for byte**, proving the
   right file is being replaced and no unrelated drift is being masked.
5. **Dimensions are unchanged** — 1440×1105 and 412×1681 before and after — so the
   diff is a label and an icon inside the same layout, not a structural shift.

### Current stopping point

`LD-R3` complete; PR #56 open with the icon fix and both baselines from CI.
Next backlog item is `T-1` — surface fully mapped above, safe to begin once
#54 merges.

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
