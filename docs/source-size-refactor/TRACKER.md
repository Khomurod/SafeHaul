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
| **Last updated** | 2026-08-28 |
| **Verified main SHA** | `a08a2340d7211330a879db9cbd840e30447aa346` |
| **Oversized files** | **68** (measured, not copied) |
| **Backlog entries** | **68** |
| **Active work item** | `SEC-1` — reconcile PR #50 / PR #51 |
| **Active branch** | `claude/safehual-source-size-refactor-j4apre` (planning only) |
| **Active PR** | none for this branch yet; #50 and #51 are the items under reconciliation |
| **PR head SHAs** | #50 → `9386b371ec6a83840aabf9604238693c733cb925` · #51 → `20c75500a235fe7beb1a12ab9b8cf03cf9466922` |
| **Review status** | #50: **unresolved P1 on its exact head**, reproduced independently. #51: current head **not reviewed** — Codex quota exhausted. |
| **CI status** | #50: **RED** (`test-functions` fails). #51: **fully green**, all 18 checks including `Verify the release is fully validated`. |
| **Working tree at session end** | clean, planning docs committed |
| **Blockers** | 1. Codex review quota exhausted — blocks step 10 of PR discipline. 2. `SEC-1` needs an owner ruling (below). 3. `RU-2`, `LD-1`, `LD-2` need a build-step ruling. |

### Exact next action

**Do not start a backlog item until `SEC-1` is resolved.**

Put the `SEC-1` recommendation (below) to the owner and get a ruling. The
recommendation is: **merge #51, close #50, and port #50's four
non-arms-race pieces in one small follow-up PR.** Every claim behind that
recommendation was reproduced in this repository and is recorded in the `SEC-1`
section — a later session should not have to re-derive it, but *should* re-verify
the CI and review state on GitHub, which can have moved.

Once `SEC-1` is settled, the first implementation unit is **`T-1`
(`scripts/test-ci-plan.mjs`, 1223 lines)** — see § `T-1` for why it is first and
what makes it R4 despite being tooling.

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
| `SEC-1` | **READY** | R4 | reconcile PR #50 / #51 | — | — | — | #50, #51 | see handoff | see below | #50 RED, #51 green | — | — | 0 |
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
| `RU-1` | NOT STARTED | R2 | `src/tests/firestore.rules.security.test.js` (test) | 1106 | 1106 | — | — | — | — | — | — | — | 1 |
| `RU-2` | NOT STARTED | R4 | `src/firestore.rules` (runtime) | 693 | 693 | — | — | — | — | — | — | — | 1 |
| `LD-1` | NOT STARTED | R2 | `landing/assets/css/styles.css` (runtime) | 3447 | 3447 | — | — | — | — | — | — | — | 1 |
| `LD-2` | NOT STARTED | R2 | `landing/index.html` (runtime) | 1682 | 1682 | — | — | — | — | — | — | — | 1 |
| `LD-3` | NOT STARTED | R2 | `landing/assets/js/main.js` (runtime) | 860 | 860 | — | — | — | — | — | — | — | 1 |
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

### Current stopping point

Analysis complete and reproduced. **No code written, no PR touched.** The next
session should confirm the owner's ruling, re-verify #50/#51 state on GitHub
(CI and review state can have moved), and then execute the ruling.

### PR / merge information

Nothing merged. #50 and #51 both open at the heads recorded above.

---

## `T-1` — `scripts/test-ci-plan.mjs` (1223 lines)

**Status:** `NOT STARTED` · **Risk:** R4 · **Blocked by:** `SEC-1`

Recorded here ahead of time only because it is the designated first
implementation unit; the detailed split design is written when it starts.

**Why first:** it is the largest tooling file, and PR #49 already split the
secret scanner and its tests by responsibility — so a proven, reviewed precedent
for this exact shape of work exists in `scripts/secret-scan/`.

**Why R4 despite being tooling:** it is half of a two-part contract. `ci-plan.mjs`
and `test-ci-plan.mjs` pin each other, and this file's assertions (E6b/E6c on the
`!cancelled()` pair, E6d/E6e on reporter jobs, J1–J5 on Playwright projects,
§L on the secret scanner's wiring) are what stop the release pipeline from
silently shipping nothing. A weakened assertion here fails silently, which is the
failure mode `AGENTS.md` says a checker has.

**Mandatory:** `npm run check:ci-plan` must pass. The recorded backlog count is
1358 while the file measures 1223 — the effective ceiling is the lower of the two,
so there is no headroom to spend.

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
| — | — | — | — | — | — |

---

# OWNER DECISIONS PENDING

| # | Decision | Blocks | Detail |
|---|---|---|---|
| 1 | `SEC-1`: which secret-scan implementation reaches `main` | whole campaign | Recommendation and full evidence in the `SEC-1` section. |
| 2 | Codex review quota is exhausted | PR discipline step 10 | Until quota returns, merges need **human** review. "The bot declined" is not review. Record which kind each unit got. |
| 3 | Introduce a build step for the landing site? | `LD-1` (3447), `LD-2` (1682) | No build step exists. Splitting either requires introducing one. `AGENTS.md` records this as unasked. |
| 4 | Introduce a concatenation step for Firestore rules? | `RU-2` (693) | Rules have no include mechanism. Concatenating puts the deployed policy one step further from the file a reviewer reads. |

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
