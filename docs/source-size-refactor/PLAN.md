# Source-size refactor campaign — implementation plan

**Canonical plan file.** Progress and handoff state live in
[`TRACKER.md`](TRACKER.md) beside it. This file describes *what* the campaign is
and *how* work units are chosen and executed; the tracker records *where the
campaign currently is*. Neither file is authoritative over the repository —
GitHub and a fresh `npm run check:source-size` are.

---

## 1. Why this campaign exists

`AGENTS.md` § "Source size: 400 to think, 500 to stop" sets the standard:

- **400 physical lines** asks a file to justify its shape in review.
- **500 physical lines** is the hard maximum, and it applies to tests and
  tooling exactly as to runtime code.

Physical lines are counted deliberately — not "lines of code". Stripping
comments would reward deleting the explanations this repository runs on, and
counting statements would reward putting three on one line. The metric measures
how much there is to read.

An audit on 2026-08-26 found files already over that limit. They were recorded
in `.github/source-size-backlog.json`, which is **a campaign and not an
allowlist**, and `scripts/source-size.mjs` enforces the difference:

- a file **not** listed may never exceed the limit;
- a listed file may never **grow** past its recorded count;
- a listed file that comes back **under** must be removed, and the check fails
  until it is;
- an entry for a path that no longer exists fails too, so a rename cannot carry
  an exemption with it;
- the backlog is compared **against git**, not trusted — `scripts/source-size-baseline.mjs`
  reads the previous version out of the change's base and refuses any entry
  added or any count raised.

When the last entry goes, the backlog file is deleted. **This campaign is that
deletion.**

---

## 2. Verified starting state

Everything below was measured in this repository, not copied from a prior
session's notes.

| Fact | Value | How verified |
|---|---|---|
| Campaign-start `main` | `a08a2340d7211330a879db9cbd840e30447aa346` | `git rev-parse origin/main` after `git fetch` |
| `main` after the first rulings | `c023e3f4206cf41e28b8cf8a1c41e2372e2b392d` | #51 and #52 merged 2026-08-28; backlog unchanged at 68 |
| `main` is | merge of PR #49, "Split the secret scanner and its tests by responsibility" | `git log --oneline origin/main` |
| Files over 500 lines | **68** | `npm run check:source-size` |
| Backlog entries | **68** | `.github/source-size-backlog.json` → `files` |
| Total lines in over-limit files | 55,632 | summed from the checker inventory |
| Backlog `recordedAt` | 2026-08-26 | backlog metadata |
| Standard | `{ warn: 400, hard: 500 }` | backlog metadata |

Two facts worth carrying forward:

- **`docs/APP_BRIEF.md:1093` is stale on `main`** — it still says "70 files
  already over the limit". The measured number is 68. Correcting it is folded
  into the first merged work unit rather than left to drift further.
- **Exactly one backlog entry has drifted downward**: `scripts/test-ci-plan.mjs`
  is recorded at 1358 and measures 1223. That is the ratchet working as designed
  — the recorded count is a *dated record*, while the effective ceiling is the
  lower of the record and the size at the change's base. Nothing to fix.

---

## 3. Hard rules for every work unit

### 3.1 The metric may not be gamed

Never: minify handwritten code; collapse formatting; delete useful comments to
reduce lines; create meaningless `part1`/`part2` files; move code into a format
that is not measured; raise a recorded backlog count; add an exclusion for
convenience; or create a giant `utils` dumping ground.

**Split by logical responsibility.** A cohesive 450-line file is better than six
confusing 80-line files. If a split cannot be justified in a sentence that names
a responsibility, it is the wrong split.

### 3.2 Behavior preservation is the highest priority

This is a refactor campaign. Unless independently fixing a verified defect in a
separate focused change, **existing user and business behavior must remain
identical**. Do not alter workflows, Firestore document structures, routes,
permissions, callable contracts, function names, trigger names, regions, tenant
isolation, public APIs, payloads, status vocabulary, signing semantics, PDF
geometry, UI behavior, draft behavior, offline behavior, or submission behavior.

Refactoring successfully means: **same behavior, better structure.**

### 3.3 The standard two-step pattern

Where an over-limit runtime file has an over-limit test file, they are **two work
units, not one**:

1. Split the runtime module **preserving its public export surface**. Because the
   exports do not move, the test file needs no change and keeps proving the
   behavior across the split.
2. Split the test file afterwards, along the seams the runtime split created.

This keeps each PR reviewable and makes step 1's test evidence meaningful — the
same test file passes before and after. Splitting both at once destroys that
evidence.

### 3.4 Coverage before extraction

Where a file's behavior is load-bearing and its coverage is thin, the
characterization tests come **first, in their own merged PR**, before any code
moves. That is why `PA-0` exists ahead of `PA-1`.

---

## 4. Risk categories

| Risk | Meaning | Applies to |
|---|---|---|
| **R1 — Low** | Test or tooling reorganization. No runtime code path changes. Failure is caught by the suite itself. | functions tests, frontend tests, most scripts |
| **R2 — Moderate** | Runtime code with good test coverage and a narrow blast radius. | most `src/features` views and hooks |
| **R3 — High** | Runtime code touching Firebase exports, callable contracts, PDF geometry, or shared infrastructure. | `functions/**` runtime, signing, shared PDF |
| **R4 — Extreme** | The public application path, and any gate whose failure mode is silent. | `PublicApplyHandler.*`, `firestore.rules`, CI gate scripts |

Risk sets the evidence bar, not whether the work happens.

---

## 5. Invariants that must survive every relevant work unit

### 5.1 Public application (R4 — load-bearing)

Preserve: deterministic applicant/application identity; tenant isolation; local
drafts; server drafts; sequence/revision ordering; same-device resume;
cross-device resume; Continue / Start Over; cross-tab synchronization;
queued/offline submission; discard generation protection; final submission
protection; SSN handling; signature handling; sensitive-data exclusions;
authorization tokens.

### 5.2 Signing / PDF (R3–R4)

Preserve: PDF coordinates; dimensions; scaling; page position; drag/resize
behavior; recipients; templates; saving; sending; keyboard behavior; mobile
behavior; AI field assistance; storage/upload paths; final signing behavior.
Geometry changes are not visible to unit tests — browser verification is
required where geometry is touched.

### 5.3 Firebase / backend (R3)

Preserve: exported Cloud Function names; the intentionally mixed Firebase v1/v2
usage where it exists; regions; auth; tenant checks; Firestore paths; payload
shapes; response and error contracts; integrations; retry and idempotency
semantics. **Do not "modernize" working infrastructure during a file split.**

### 5.4 Security and CI (R4)

Preserve fail-closed behavior. Do not weaken secret scanning, CI planning, the
source-size gate itself, release validation, deployment logic, or the Production
promotion gate. A gate must not take its scope from the branch it is gating —
that sentence is the repository's most-repeated lesson and it applies to any
gate script this campaign touches.

`scripts/ci-plan.mjs` and `scripts/test-ci-plan.mjs` are two halves of one
contract: `npm run check:ci-plan` must pass after touching either.

### 5.5 Design system (UI work units)

Before any UI work unit, read `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` and
`src/design-system/README.md`. Reuse approved components and semantic `--ds-*`
tokens. A size-driven split must not introduce a local button, modal, form
control, table, status treatment, arbitrary color, or unsupported font size.
UI standardization must not change Firebase rules, data structures, backend
behavior, integrations, permissions, routes, feature flags, or workflows.

---

## 6. Workstreams and sequence

Ordering is **risk-ascending within a largest-first bias**. The reasoning is
explicit so a later session can disagree with it deliberately rather than by
accident:

- Line yield is highest in tests and tooling, and those are R1. Taking them first
  retires the most lines per unit of risk and proves the split patterns on code
  whose failure mode is a red suite rather than a silent production defect.
- The highest-risk item (`PublicApplyHandler`) is scheduled late, but its
  **coverage audit is scheduled early** (`PA-0`), so the de-risking work is not
  also late.
- Owner-decision items (landing site, Firestore rules) are separated out
  entirely, because they need a build-step decision this campaign has no mandate
  to make alone.

| Phase | Workstream | IDs | Files | Risk |
|---|---|---|---|---|
| 0 | Security reconciliation (#50 / #51) | `SEC-1` | — | R4 |
| 1 | CI / tooling | `T-1`…`T-5` | 5 | R1–R4 |
| 2 | Public-apply coverage audit | `PA-0` | — | R1 |
| 3 | Functions tests | `FT-1`…`FT-10` | 10 | R1 |
| 4 | Frontend tests | `SA-2,7,9` `CA-3,5,7,10,11,12,13` `SG-2,3,5,6,7` `SO-1` `PA-3` | 17 | R1 |
| 5 | Functions runtime | `FR-1`…`FR-14` | 14 | R3 |
| 6 | Super-admin UI | `SA-1,3,4,5,6,8` | 6 | R2 |
| 7 | Company-admin UI | `CA-1,2,4,6,8,9` | 6 | R2 |
| 8 | Remove the landing site, rehome `/news` | `LD-R` (was `LD-1`/`LD-2`/`LD-3`) | 3 retired | R4 |
| 9 | Signing / e-docs | `SG-1`, `SG-4` | 2 | R3–R4 |
| 10 | Public application | `PA-1`, `PA-2` | 2 | R4 |
| 11 | Firestore rules — tests first, then the file | `RU-1` → `RU-2` | 2 | R4 |
| 12 | Close-out | `Z-1` | — | R1 |
| | `SO-2` (`useCompanyDashboard.js`) | `SO-2` | 1 | R2 |

Phases are an ordering guide, not a barrier: an unblocked lower-risk unit may be
taken out of order when a higher-risk one is waiting on an owner decision. What
must **not** happen is stacking high-risk work on an unmerged PR.

---

## 7. Owner rulings

The campaign opened with four questions it could not answer alone. The owner
ruled on 2026-08-28; the rulings are binding and are recorded here rather than
only in the tracker, because they changed the plan's shape.

### 7.1 `SEC-1` — the secret scanner

**Ruling: proceed with PR #51 and close PR #50.** Done — #51 merged at `dd240a2`,
#50 closed with the reasoning recorded on the PR and in the tracker.

A follow-up should still port #50's *class*-closing pieces (escape refusal, the
comment-aware separator on `module` imports, `Function`/`eval` matched as bare
identifiers, and the `implementationFiles()` path normalisation that fixes a real
Windows portability bug) — but **not** its `process` allowlist, which caused #50's
CI failure and produced four consecutive P1s, one still open.

### 7.2 The landing site — remove it, keep `/news`

**Ruling: remove the SafeHaul landing page completely.** There is to be no public
landing site until it is rebuilt from scratch. Remove landing-only HTML, CSS, JS
and assets, and all obsolete Firebase, CI and deployment references, **preserving
anything shared or required elsewhere**. This *retires* the landing backlog items
rather than refactoring them.

**And: keep `/news` live.** This is the constraint that shapes the work, because
the public blog is not independent of the landing site today:

- `/news`, `/news/**`, `/api/news/**` and `/sitemap.xml` reach `serveBlogPublic`
  only through **rewrites on the two landing Hosting targets**;
- every server-rendered blog page links `/assets/css/styles.css` — that *is*
  `landing/assets/css/styles.css`, the 3447-line `LD-1` file;
- blog pages also use `/assets/images/logo.svg`, `logo-mono.svg`,
  `news-fallback.svg` and preload both self-hosted font faces from `/assets/fonts/`;
- the served `robots.txt` is the static `landing/robots.txt`, and a test pins the
  two together.

So the blog needs its **own** Hosting target and its **own** minimal stylesheet and
asset set, extracted from the landing ones rather than deleted with them. The
owner accepted the consequence: `LD-1` is not retired outright — a much smaller
descendant of `styles.css` survives to serve the blog, and it must come in **under
500 lines** like any other new file, since a file the campaign creates may never be
backlogged.

This replaces `LD-1`, `LD-2` and `LD-3` with a single removal-and-rehome unit,
`LD-R`. It is a **behaviour-changing** unit — the only one in the campaign — and
therefore does not carry the campaign's usual "behaviour must be identical" rule.
What it must not change is the blog's own content, routes or output.

### 7.2a Second landing ruling (2026-08-28, later the same day)

Two of the first ruling's consequences came back for decisions once the work
exposed them, and one **reverses** an earlier answer. Both are binding.

**The privacy policy is preserved, not removed.** The first ruling took it out
with the marketing site; this one keeps it, as a *simple standalone Privacy Policy
accessible to public users*. It is served from `web/privacy.html`, styled by the
same extracted sheets plus a small `policy.css`, carries no JavaScript, and is
linked from the blog footer. This is the outcome the compliance concern argued
for — a public privacy URL is relied on by OAuth consent screens, app-store
listings and privacy law — and the reversal is recorded rather than quietly
applied, because a later reader finding the removal in the history deserves to
see it was reconsidered on purpose.

**The lead subsystem is retired but its data is kept.** Specifically:

- **Retire** active lead capture (`submitLandingLead`), Telegram delivery and
  configuration, resend and test-send, and the Landing Page Settings screen.
- **Preserve** every historical lead record. **Do not delete lead data.**
- **Replace** the settings screen, if a replacement is needed, with a *minimal
  read-only "Historical Website Leads" Super Admin view with CSV export*.
- Any future landing-page lead capture is to be **rebuilt fresh**, not revived
  from what is left here.

This resolves the trash-register entry that was blocking `LD-R2`: the answer is
neither "delete it" nor "keep it all" but "keep the records, retire the
machinery". It is enough work to be its own unit, `LD-R3`, because a read-only
view with CSV export is a feature rather than a deletion, and folding it into a
removal PR would make both harder to review.

### 7.2b Delegated decision: where the lead archive lives (2026-08-28)

The owner delegated this one — *"you choose the best option, document it"* — so
the reasoning is recorded here rather than left in a commit message.

**Decision: it keeps a Super Admin navigation entry, retitled "Website Leads",
in the `ops` group.**

The alternative was to move it somewhere less prominent, on the reasoning that
nobody needs an archive daily. That reasoning is true and still loses, because
**this screen is the only path to the data.** A `landing_leads` document is
`allow read, write: if false` — no client can reach it, and the collection is
Admin-SDK only — so if the screen is hard to find, the leads are indistinguishable
from leads that were deleted. The specific failure that invites is somebody
concluding the data is gone and cleaning up the collection, which is exactly the
outcome the ruling to preserve it was guarding against.

Three supporting details:

- The slot already existed (`LANDING_PAGE`, group `ops`), so keeping it is the
  smaller change as well as the safer one. The id becomes `website-leads`;
  verified first that no deep link, URL or stored preference persists a view id,
  so renaming breaks no bookmark.
- The screen says in its own copy that it is a read-only archive and that new
  leads will not arrive there, so its prominence cannot be mistaken for the
  feature still being live.
- The CSV export sits beside it, which is what makes "less prominent" cheap to
  reverse later: once an operator has the CSV, the screen matters less. That is a
  decision for whoever rebuilds lead capture, not for this campaign.

### 7.3 `RU-2` — Firestore rules

**Ruling: do not introduce a concatenation or build step.** Instead:

1. **First** split and *strengthen* the Firestore security tests
   (`RU-1`, `src/tests/firestore.rules.security.test.js`, 1106 lines).
2. **Then** refactor `src/firestore.rules` (693 lines) below 500 while
   **preserving permissions exactly**.
3. **If that cannot be done safely, stop and request an owner decision.**

Step 3 is part of the ruling, not an escape hatch: the rules file is a security
boundary, and "I could not make it smaller without changing what it permits" is a
legitimate outcome to report rather than something to force. Rules have no include
mechanism, so the reduction has to come from the file's own structure — shared
helper functions, collapsing duplicated matchers — never from relaxing a matcher
or widening a condition to save lines.

`RU-1` must be genuinely strengthened, not merely divided: the tests are what
make step 2 safe, and splitting them without adding coverage would leave the
refactor resting on exactly the assurance it had before.

### 7.4 Keep this plan and the tracker current

**Ruling: update `PLAN.md` and `TRACKER.md` immediately when rulings land, and
continue the campaign.** Documentation updates travel in the same commit as the
work they describe; they are not a task deferred to the end.

## 8. Test strategy

Per work unit, the required evidence scales with risk:

| | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| The file's own suite passes | ✅ | ✅ | ✅ | ✅ |
| `npm run check:source-size` | ✅ | ✅ | ✅ | ✅ |
| Full owning suite (`npm test` / functions) | ✅ | ✅ | ✅ | ✅ |
| Lint + typecheck on touched files | ✅ | ✅ | ✅ | ✅ |
| Characterization tests added first where coverage is thin | — | if thin | ✅ | ✅ |
| Callable/export surface diffed before vs after | — | — | ✅ | ✅ |
| Browser / visual verification | — | if visual | if visual | ✅ |
| Full diff read line by line | ✅ | ✅ | ✅ | ✅ |

`check:ci-plan` is additionally required for `T-1`, `T-5`, and any unit touching
`.github/workflows/`. `test:secret-scan` is required for any unit touching
`scripts/secret-scan/`.

### Test-runner hazards that have already cost real time

These are in `AGENTS.md` § "Local test-runner process safety" and apply to every
work unit in this campaign:

1. **One Playwright suite at a time.** The config serves on port 5000 with
   `reuseExistingServer`; a second concurrent run attaches to the first run's
   server and reports a cascade of failures that are not real.
2. **Never use broad process-killing patterns.** `pkill -f vite` matches the
   invoking shell's own command line and kills it. Capture the PID instead.
3. **Long suites need a persistent process, redirected logs, and the real exit
   status.** A tool timeout or an external `SIGTERM` (exit 143) is *not* a test
   failure — inspect the process result and log before reporting one.
4. **`vi.clearAllMocks()` does not clear queued `mockResolvedValueOnce` values.**
   At least twelve test files here still pair `clearAllMocks` with `Once`
   queues. **Any test-splitting work unit that moves such a file must use
   `vi.resetAllMocks()`** and re-establish implementations immediately after.
   This is a live hazard, and splitting a file changes test ordering, which is
   exactly the timing that makes the leak surface.
5. **Do not edit files in the module graph while a Playwright suite is running.**

---

## 9. Review and CI strategy

Per work unit, in order:

1. Fresh branch from the latest merged `main`.
2. Inspect the target and **all** its consumers before moving anything.
3. Add characterization tests if coverage is insufficient (own PR if R3/R4).
4. Refactor.
5. Run the evidence set for the unit's risk level (§ 8).
6. Run `npm run check:source-size`.
7. Read the entire diff.
8. Update `TRACKER.md` **in the same commit as the work**.
9. Open a focused PR.
10. Request review on the exact head.
11. Independently evaluate every finding — confirm or refute it by reproduction,
    do not accept it on authority.
12. Fix legitimate findings.
13. **After any code change, request review on the new exact head.**
14. Latest-head CI must be green.
15. Merge.
16. Verify latest `main` and re-run the checker.
17. Verify the Testing deployment where applicable.
18. Update the tracker to `COMPLETE`.
19. Only then begin the next work unit.

**Production must not be promoted unless the owner explicitly requests it.**

### Known constraint: automated review quota

As of 2026-08-28 the Codex reviewer returns *"You have reached your Codex usage
limits for code reviews"* on both open PRs. Step 10 above therefore cannot be
satisfied by Codex alone right now. Until quota returns, a work unit may only be
merged with **human review**, and the tracker must record which of the two it
got. Do not treat "review was requested and the bot declined" as review.

---

## 10. Trash / dead-file policy

While reviewing a backlog file, any file that appears unnecessary is recorded in
the tracker's **POTENTIALLY UNNECESSARY / TRASH FILES** section with: path,
reason, references searched, runtime/deployment references, confidence,
recommendation, and final decision.

**Do not delete something merely because it looks old.** Verify: static imports;
dynamic imports; route registration; Firebase exports; workflows; package
scripts; Storybook; tests; deployment scripts; and string/path loading. A file
loaded by a path built at runtime has no import to find.

If unquestionably dead, deletion is normally **its own small PR**, not folded
into a split.

---

## 11. Definition of campaign complete

The campaign may be marked complete only when all of the following hold:

1. Final `main` is independently rescanned.
2. No normal handwritten source file exceeds 500 physical lines.
3. `.github/source-size-backlog.json` has zero entries and is **removed**, which
   the backlog's own comment names as its terminal state.
4. No hidden oversized files exist outside the old backlog.
5. All splits are logical and each is justified by a named responsibility.
6. Application behavior is preserved.
7. Draft / resume / submission behavior is preserved.
8. Signing / PDF behavior is preserved.
9. Firebase / backend behavior is preserved.
10. Permissions and tenant isolation are preserved.
11. Security gates remain fail-closed.
12. CI and release protections remain intact.
13. Tests were not weakened — no test skipped, disabled, or quarantined to get
    green.
14. Every code-changing PR had review on its exact final head.
15. Every legitimate material finding was addressed.
16. Latest-head CI was green before each merge.
17. Final `main` CI is green.
18. Testing serves the final verified commit where applicable.
19. Production was not promoted without owner instruction.
20. Trash / dead-file candidates were resolved or explicitly left for the owner.
21. This plan reflects the final architecture.
22. `TRACKER.md` contains a complete history of the campaign.

Also required by `CLAUDE.md` and `AGENTS.md`: **`docs/APP_BRIEF.md` must not
disagree with the application.** Its source-size paragraph is updated as counts
change, not once at the end.

---

## 12. Per-unit record required in the tracker

For every work unit the tracker records: target file(s); current line count(s);
the responsibility currently owned; the proposed logical split; risk level;
dependencies; required behavior-preservation tests; expected backlog entries
removed; whether runtime behavior should remain identical; and any special
verification needed.

A detailed per-unit section is written when the unit moves to `READY` or
`IN PROGRESS` — not in advance, because a split designed before the file is read
is a guess, and a guess recorded in a tracker is indistinguishable from a
decision.
