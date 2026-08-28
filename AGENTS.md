<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"` — use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"` — run a separate `docs` command per distinct concept if the question spans multiple topics, unless it's about how they interact
4. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query — specific and detailed queries return better results than vague single words, but keep each query to a single concept unless the question is about how concepts interact; combined multi-topic queries dilute ranking and return shallow results for each topic. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
Run Context7 CLI requests outside Codex's default sandbox. If a Context7 CLI command fails with DNS or network errors such as ENOTFOUND, host resolution failures, or fetch failed, rerun it outside the sandbox instead of retrying inside the sandbox.
<!-- context7 -->

<!-- tool-responsibilities -->
## The App Brief is required reading

[`docs/APP_BRIEF.md`](docs/APP_BRIEF.md) is the central orientation document for
this application — purpose, users, main workflows, business rules, permissions,
integrations, background jobs, cross-feature ripple risks, preserved decisions,
retired features and known limitations.

- **Before changing anything**, read the parts of the brief that touch your task
  and verify them against the current code. The code is the source of truth; if
  the brief has drifted, correct it as part of your task.
- **After any meaningful change** — feature, fix, removal, behavioral change,
  integration change, workflow change, permission or schedule change — review the
  brief again and update, add, or remove whatever your work made inaccurate, in
  the same commit.
- **A task is not complete while the brief and the application disagree.**

Keep it concise: it exists to prevent misunderstandings, not to mirror the code.

## MCP tool responsibilities

This repo is wired to three complementary assistants plus native tooling. Use each for what it is best at; do not fan the same question out to all of them.

- **Superpowers** — owns the *working process*: clarify requirements, plan, debug systematically, write a regression/failing test first, review, and verify before claiming done. It does not navigate code and does not replace Serena or codebase-memory.
- **codebase-memory-mcp** (server `codebase-memory-mcp`) — broad *orientation & impact*: architecture, cross-module relationships, call-path tracing, dependency/impact analysis, persistent project knowledge, and how a change ripples to distant code. Reach for `search_graph` / `trace_path` / `get_architecture` / `search_code` first when exploring or getting oriented.
- **Serena** (server `serena`) — precise *symbol-level* work: exact definitions and references, inspecting a specific function/component, cross-file renames, focused refactors, symbol-level edits, and re-validating references after moving or renaming code.
- **Native tools** (Read/Grep/Glob, git, the test runner) — exact text searches, config files, running tests, build/lint/typecheck, reviewing the final diff, and git status/commit inspection.

Guidance: use codebase-memory to understand *where and why*, Serena to act on *exact symbols*, native tools to read and verify. Query both codebase-memory and Serena for the same thing only when a second independent check is genuinely worth it. Keep durable project memory in one system, not duplicated across tools.
<!-- /tool-responsibilities -->

<!-- safehaul-design-system -->
## SafeHaul UI and design-system work

Before any UI, UX, styling, responsive, accessibility, or visual-component
change:

1. Read `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` — the design-system standard,
   its approved exceptions, its automated guardrails and the decisions that are
   still open.
2. Read `src/design-system/README.md` and the relevant component/pattern docs.

The central design system owns reusable visual appearance and interaction.
Feature folders own feature content, available actions, domain vocabulary, and
domain-to-visual mapping. Hooks and services own data, state, integrations, and
business logic. Keep feature screens in their features.

Reuse approved design-system components and semantic `--ds-*` tokens. Do not
create a local button, modal, form control, table, status treatment, arbitrary
color, unsupported font size, or competing visual primitive unless the
roadmap records the missing capability and the code documents the temporary
exception. Do not add 9px or 10px body text.

When completing or changing migration work, update the roadmap immediately.
Never mark an item complete without recorded implementation, behavior-preserving
tests, applicable desktop/mobile visual review, accessibility/keyboard review,
documentation, and final diff inspection. State honestly when a check could not
run and leave the item open or blocked.

UI standardization must not change Firebase rules, database structures,
backend behavior, integrations, permissions, routes, feature flags, or
business workflows unless the task separately justifies and approves that
change.

## Source size: 400 to think, 500 to stop

`npm run check:source-size` counts physical lines in every handwritten source
file and fails when one is over the limit. `npm run test:source-size` tests the
checker. Both run in `callable-contract`, which is in `ALWAYS_REQUIRED_JOBS`, so
no tree-hash proof can skip them.

- **400 lines** asks a file to justify its shape in review. A cohesive 420-line
  module is fine; one doing three jobs is not.
- **500 physical lines** is the hard maximum, and it applies to tests and tooling
  exactly as to runtime code. A test nobody can read is a test nobody maintains.

Physical lines, deliberately — not "lines of code". Stripping comments would
reward deleting the explanations this repository runs on, and counting statements
would reward putting three on one line. The metric measures how much there is to
read.

An audit on 2026-08-26 found **70 files over the limit**, including a 2203-line
test, a 1476-line component owning the public application, four tooling scripts
over 1000, a 3447-line stylesheet and a 1682-line HTML page. None of it was
decided; it accumulated because nothing said no. Those files are recorded in
`.github/source-size-backlog.json`, which is a **campaign and not an allowlist** —
the checker enforces the difference. A file not listed may never exceed the
limit; a listed file may never grow; a listed file that comes back under must be
removed, and the check fails until it is. An entry for a path that no longer
exists fails too, so a rename cannot carry an exemption with it. When the last
entry goes, so does the file.

**And the backlog itself is compared against git, not trusted.** Every rule above
is enforced against the backlog *in the branch under test*, which that branch may
edit — so on its own the checker would have accepted a new 900-line file that
arrived together with `{"src/new.js": 900}`, or a listed file grown with its
recorded count raised to match. Review found that on 2026-08-27, and it is the
same lesson `scripts/secret-scan.mjs` was built on: **a gate must not take its
scope from the branch it is gating.**

Two more shapes of the same hole came out of that review, both reproduced first:

- **A count that is not a count.** Every rule compares with `>`, a non-number
  coerces to `NaN`, and every comparison against `NaN` is false — so
  `{"src/big.js": "unbounded"}` exempted a 9000-line file from the hard limit
  *and* from the may-not-grow rule, silently. A malformed entry is now refused,
  and nothing is compared until the shape is sound.
- **A ceiling that does not follow the file down.** A backlogged file that shrinks
  while its dated count stays put could be regrown to anything at or below the
  snapshot: `1358 → 1200 → 1300` passed twice. So each backlogged file is also
  measured at the base of the change, and **may never exceed either its
  2026-08-26 size or the size it had on the branch it came from.** That ratchets
  automatically, which is why the recorded count stays a dated record rather than
  a live ceiling somebody has to remember to lower. So `scripts/source-size-baseline.mjs` reads
the previous version out of git — a pull request's own base commit, the tip a push
replaced, where a feature branch left the default branch, or `HEAD~1` — and
refuses any entry added or any count raised. That fork-point step is not a
nicety: `HEAD~1` alone compares a commit against the one before it *inside the
same change*, so a branch whose first commit legitimately records a backlog entry
stands accused of adding one.

**Which commit is the base turned out to be the whole problem**, and this
repository has now answered it three times. A pull request measures against what
it was proposed against — a definition, needing no proof. **Every other event asks
GitHub for the newest ancestor carrying a fully validated release**, exactly as
`scripts/secret-scan.mjs` does and for the reason `scripts/resolve-deploy-base.mjs`
learned after a function silently failed to deploy for two merges. Three things
were measured on 2026-08-27, each of which let a refused increment reach a deploy:

- **`github.event.before` is only as good as the run that happened on it.** After
  a push that FAILED this check, `before` IS the failure, so the next push
  measures from it, the tampered backlog looks unchanged, and `deploy-testing`
  ships what was refused.
- **`HEAD~1` after a multi-commit push is inside that push.** `workflow_dispatch`
  on `refs/heads/main` deploys, and `1200 → 1300 → tip` let a dispatch compare
  1300 against 1300 and pass a regrowth the push run had refused.
- **An escape hatch is a bypass if nobody checks it.** The override existed so a
  manual run had an honest way past the refusal, and it accepted anything that
  resolved: `SOURCE_SIZE_BASE=HEAD` reported "compared against \<head\>" and
  passed. That round made it clear the same bar as an inferred base — an
  ancestor, not the head, carrying a validated release — which is what this file
  already said about the secret scanner's override. Two more rounds found that
  bar too low; the override's contract today is the one stated below, not this.

A fourth review round found the same escape hatch open two notches wider, and
both were reproduced before they were fixed. **The override may not reach behind
the campaign's own start**: `SOURCE_SIZE_BASE` pointed at a fully validated
pre-campaign commit — the main commit a campaign branch is based on will do —
made `git show` fail, which read as "no backlog here, the campaign starts with
this change", so the current backlog was trusted wholesale and an invented
`{"src/invented.js": 9000}` with a matching 9000-line file reported zero
problems. **And it may not reach behind the base the run would have picked
anyway**: the automatic base is the *newest* validated ancestor and therefore the
strictest, so naming an older validated release restores its looser recorded
count and its looser measured size, and a file regrown to that older ceiling
passes.

A fifth round showed why "an operator chose it" was the wrong place to hang that
first refusal, and the answer is the most useful thing in this section. **The
inferred route reaches a pre-campaign base too**, with no override at all: when
the push that bootstraps the backlog fails some unrelated required job it never
becomes a validated release, so the NEXT push's newest validated ancestor is
still pre-campaign — and it could add a 9,000-line file with its own entry, pass,
and deploy once the unrelated failure was fixed. Reproduced.

What makes a bootstrap legitimate is not who picked the base. It is that every
entry records debt **the base already carried**, which is a fact about a commit
the change under test cannot edit, so it is checkable and now checked: the file
must exist at the base, and its recorded count may not exceed its size there. The
campaign's own pull request passes that (all 70 entries are unchanged files from
`c0057e2`); a file the change itself creates, or one that grew through the limit
on the branch, does not. The override refusal stays as well, because reaching
behind the campaign's start is a category error and deserves to read like one.

Two more of the same shape came out of that round, both reproduced. **A lookup
that failed is not an answer of "none":** one 502 on the second request left
`lastValidatedBase` null, which read as "nothing to be behind", and since the CLI
only mentions a lookup error alongside some other problem, the older-ceiling
comparison exited 0. And **"is the override older" is the wrong question** — on a
merge commit a validated second-parent tip is an ancestor of the head and of
neither the first-parent base nor its reverse, so an override cut before a
backlog reduction sailed through. The override must now *contain* the automatic
base, which refuses older and incomparable alike.

`callable-contract` therefore carries `checks: read` and the default token, and
the dispatch dialog offers `source_size_base` for naming a good release when the
automatic lookup finds none. Entries
leaving and counts falling are the campaign working and need no ceremony. CI
passes `--require-baseline`, which turns "could not find a base" into a refusal
rather than a skipped comparison; that is why `callable-contract` checks out with
`fetch-depth: 0`. Locally the comparison is skipped with a printed reason, because
a fresh clone must still be able to run the checker.

Three things the checker does that are worth keeping if it is ever rewritten. It
reads `git ls-files -z` rather than walking directories, so a large file cannot
escape by being moved and gitignored build output is structurally unreachable
rather than excluded by a pattern somebody could widen — and it keeps the
NUL-delimited list intact, because a tracked path may contain a newline and
splitting on newlines turns one such path into two, hiding the real file behind a
fragment. It asserts on every run that each of `src`, `functions`, `scripts`,
`e2e`, `landing` and `.storybook` still yields files — because the way a size
checker fails is silently, and a report that has stopped covering a directory
reads exactly like progress. And it measures **languages, not just JavaScript**:
`.css`, `.scss`, `.html`, `.rules`, `.vue` and `.svelte` alongside the JS/TS
family. Restricting it to six JS/TS extensions is what left
`landing/assets/css/styles.css` (3447 lines), `landing/index.html` (1682) and
`src/firestore.rules` (693) invisible while every required-root assertion passed.

What is deliberately **not** measured is listed in `UNMEASURED_FORMATS` with a
reason each, because the half of a coverage claim that goes stale silently is the
half about what it does not look at: `.json` (data and generated lockfiles),
`.md` (documentation is meant to be long), `.mdx` (one Storybook introduction —
176 lines of prose around a single import and one `<Meta>` tag, so the `.md` case
rather than the `.jsx` case), and `.yml`/`.yaml` (the workflows).

**`.mdx` was in no list at all** until review found it on 2026-08-27, which is a
different failure from a wrong reason: a Storybook page could have grown to any
length while every coverage assertion stayed satisfied by unrelated files,
because nothing asked "is this extension covered" — only "are these extensions
still listed". So the lists are now exhaustive over the whole tracked
tree and a test (`A7`) asserts it: every tracked file's format must be measured,
deliberately unmeasured, or named in `NOT_SOURCE_FORMATS` with its reason —
images, webfonts, a favicon, a font licence, `robots.txt`, `.env.example` and two
ignore files. A new format cannot arrive unclassified, and the failure names the
format and an example path.

**"Whole tree" is itself a correction**, and it is this section's own lesson in
miniature. The first version scoped that inventory to `REQUIRED_ROOTS`, which
answer a different question — has the scan stopped covering a directory — while
the checker reads `git ls-files` over everything and measures `eslint.config.js`,
`index.html` and `playwright.config.cjs` besides. Borrowing the roots left
`.gitleaks.toml` unclassified and let a 900-line `build.py` at the repository
root pass both the inventory and the size scan. Reproduced. **A check must not
take its scope from something narrower than the claim it is making** — the same
sentence as "a gate must not take its scope from the branch it is gating", one
step over.

Dotfiles count as their own format: `.gcloudignore` has its dot at index 0, and
the first version of that test read it as "no extension", which is a second way
for a format to escape.
That last one is a **known limitation, not a clean exclusion**:
`.github/workflows/main.yml` is 1148 lines, `.github/` is outside the roots this
standard covers, and its structure is pinned job by job by `npm run check:ci-plan`
rather than by length.

The only excluded file is `public/pdf.worker.min.mjs`: vendored, minified
Mozilla PDF.js, committed because it is served directly. Every exclusion has to
carry that kind of reason, and a test asserts they do.

**Three of the recorded files may not be splittable, and that is an owner
decision rather than a silent exemption.** `src/firestore.rules` has no include
mechanism — Firestore rules are one file per deployment target — so splitting it
would mean a build step that concatenates, which puts the deployed policy one
step further from the file a reviewer reads. `landing/index.html` and
`landing/assets/css/styles.css` belong to a static site with no build step, so
splitting either means introducing one. All three are recorded and measured; none
is exempt; the question of whether to introduce a build step for the landing site
or a concatenation step for the rules has not been asked yet.

## Local test-runner process safety

These rules exist because each of the failures below actually happened and cost
real time. None were code defects; all were tooling mistakes.

1. **Run only one Playwright suite at a time.** The Playwright config serves the
   app on port 5000 with `reuseExistingServer`, so a second concurrent run
   attaches to the first run's dev server instead of starting its own. When the
   first run finishes it tears that server down underneath the second, which
   then reports a cascade of failures that are not real. Let a suite finish
   before starting another, and check the port is free first
   (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`).

2. **Never use broad process-killing patterns.** `pkill -f vite` matches the
   invoking shell's own command line — because that command line contains the
   string `vite` — and kills the shell running it. It can also match unrelated
   processes. Instead capture the dev server's PID or process-group ID when
   starting it and terminate that exact process, or use a narrow pattern such as
   `pkill -f 'node.*vite'`. Prefer the captured PID.

3. **Long suites need a persistent process, redirected logs, and the real exit
   status.** A suite that may exceed the foreground tool limit must be started as
   a background/persistent process with its output redirected to a log file, its
   PID retained, and its actual exit status collected. A tool timeout or an
   externally delivered `SIGTERM` (exit `143`) is *not* a test failure — never
   report it as one without inspecting the underlying process result and log.

4. **Do not fabricate commits to work around a failing PR API.** When GitHub PR
   creation repeatedly returns a server error (`POST /pulls` → 500), first verify
   no pull request already exists for that head — a 500 can still have created
   the resource. Then open it with `gh` or the GitHub web interface. Do not
   create empty or otherwise meaningless commits merely to change the branch SHA;
   that pollutes history and does not reliably fix anything.

5. **`--project` accumulates; it does not narrow.** `main.yml` runs
   `npm run test:e2e -- --project=chromium`, so any `--project` baked into the
   `test:e2e` script UNIONS with chromium instead of being replaced by it. Naming
   the five functional projects in that script — a reasonable-looking way to keep
   the visual lane out of a bare `playwright test` — put firefox, webkit and both
   mobile lanes into every chromium shard. The runner installs only Chromium, so
   113 tests failed with `browserType.launch: Executable doesn't exist`, on all
   four shards, through all three retries. The visual lane is kept out by living
   in `playwright.visual.config.cjs` instead, which no caller can widen.
   `scripts/test-ci-plan.mjs` (J1–J5) pins both halves; run `npm run check:ci-plan`
   after touching either the configs or those scripts.

6. **`vi.clearAllMocks()` does not clear queued `mockResolvedValueOnce` values.**
   It resets call records; once-queues survive it. So a test that queues one and
   whose component never consumes it — because the test finished before the load
   effect fired, which is exactly the timing that slips on a loaded CI runner —
   leaks that value into the *next* test, where it outranks the defaults set in
   `beforeEach`.

   This cost a real CI failure on 2026-08-26: `EditUserBodies.contract.test.jsx`
   reported `['', 'co-1', 'co-2', 'co-3']` for a select that filters out companies
   the user already belongs to. It passed in isolation and passed a full local run
   of all 4470 tests, because the leak needs the timing to slip. Proven with a
   four-case throwaway spec: under `clearAllMocks` the leaked value comes back,
   under `resetAllMocks` it does not.

   Use `vi.resetAllMocks()` in `beforeEach` when a file queues any `*Once` value,
   and re-establish the implementations immediately after — which such a
   `beforeEach` is already doing, so nothing else changes. **At least twelve test
   files here still pair `clearAllMocks` with `Once` queues**; only the one that
   actually failed has been converted, so treat this as a live hazard rather than
   a closed one.

Also avoid editing files that are in the module graph while a Playwright suite is
running: the dev server hot-reloads and the in-flight tests can fail spuriously.

### CI Playwright concurrency: `workers: 1` is deliberate — do not raise it casually

`playwright.config.cjs` pins `workers: process.env.CI ? 1 : undefined` with
`retries: 2`. The browser suite measured 11m43s–13m24s in CI on 2026-08-07, and
raising `workers` to 2 is a tempting way to halve that. It was evaluated on
2026-07-25 and **skipped**, because the available evidence points the other way:

- Two Playwright suites sharing the port-5000 dev server produced **14 spurious
  failures** (170–320 ms each). That is the `reuseExistingServer` hazard in rule 1
  above, and it is the same shared-server class of problem more workers invite.
- At the local default (more than one worker), `guest-post-application-edoc`
  **timed out at 120 s** waiting for a driver-wizard label, then passed in **31 s**
  when re-run alone on the same commit. A contention-induced flake, not a code
  defect — but indistinguishable from one in a CI log.

Honest limitation: this is suggestive, not conclusive. Proving `workers: 2` safe
needs repeated full ~27-minute runs demonstrating no shared-server, ordering or
flake problems, plus a check of the runner's actual CPU allocation. Until someone
does that work, the slower-but-trustworthy setting stands. **A green single run
is not sufficient evidence** — the failure mode is intermittent by nature.

**Sharding across runners is the sanctioned way to speed this up, and is what
`main.yml` now does.** The `frontend-e2e` job runs a 4-way matrix with
`--shard=N/4`. That is a different mechanism from raising `workers`, and it does
not reintroduce either failure mode above:

- each shard is its own GitHub runner, with its own dev server on its own
  port 5000, so nothing is shared and `reuseExistingServer` never applies;
- `workers: 1` and `retries: 2` are untouched, so there is no additional
  contention *within* a machine — which is what caused the
  `guest-post-application-edoc` timeout.

Both rules at the top of this section still hold locally: one suite at a time,
and never a broad `pkill`. Sharding is a CI arrangement, not a licence to run
concurrent suites on one machine.

If you change the shard count, change it in `main.yml` in both the `matrix.shard`
list and the `--shard=N/<total>` argument — they are two halves of one number.
Coverage is unaffected either way: sharding partitions the same test set, it does
not subset it.

### Changing the release pipeline

Three rules, each written the day it was learned the expensive way (2026-08-08).

**1. A skipped job's skip travels down the WHOLE chain, and `always()` does not
stop it.** `always()` un-skips only the job that declares it, never that job's
dependents. Because this pipeline deliberately skips test lanes it can prove were
already run, the skip reached the deploy jobs and main shipped nothing — three
times, in three separate jobs, each fix revealing the next.

So every job below `release-validation` carries **two clauses that are a pair**:

```yaml
if: >-
  !cancelled() &&                                   # opt out of the inherited skip
  needs.<each-dependency>.result == 'success' &&    # ...and re-check by hand
```

`!cancelled()` also switches off GitHub's implicit "all dependencies succeeded"
rule, which is why the second clause is load-bearing rather than decorative.
Dropping the first silently stops deployments; dropping the second silently
deploys after a failure. `scripts/test-ci-plan.mjs` (E6b/E6c) asserts both, on
every job in the chain, so neither can be tidied away.

**Reporter jobs are the deliberate exception.** `release-validation` and
`verify-shipped` must run *when their dependencies failed*, because saying so is
their purpose; they check results in their scripts instead, and E6d/E6e assert
that opposite rule. Do not apply one category's rule to the other: it either
silences the alarm or deploys after a failure.

**2. Fix the family, not the instance.** When you find a CI bug, list every job
with the same shape *before* fixing one, and write the test over the set. The
three rounds above were one root cause; patching the job in front of me each time
is what turned it into three.

**3. A green run is not evidence that anything shipped.** Every failure that day
was found by a human opening a screen. `verify-shipped` now reads the deployed SHA
back off the live site and refuses a run whose deploy jobs never executed, and
`release-ready` depends on it, so a release nobody can see live never becomes
promotable. `.github/workflows/health-check.yml` asks the same question daily and
opens an issue when the answer changes. Neither is advisory — do not make them so.

Before merging a pipeline change: run `npm run check:ci-plan`, and afterwards
**watch the real main run to completion**, because a pull request never deploys and
therefore cannot exercise the path you just changed. That asymmetry is why these
bugs reached `main` green.

**4. A security gate must own its own scope.** Added 2026-08-26, after run #159.
`gitleaks/gitleaks-action@v2` picked the scan range out of the event payload, and
the rule for `workflow_dispatch` was *no range at all* — so a manual
re-verification of an already-merged commit scanned all 256 commits, reported the
eight legacy values that have been in this repository's history since 2025-12,
failed `secret-scan`, failed `release-validation`, and skipped both deploys. The
same action used `--no-merges --first-parent` elsewhere, which was measured to
**miss a secret merged in from a side branch entirely**, and resolved its scanner
version by asking GitHub for the *latest* release at run time.

Three lessons, in order of how expensive they were:

- **A range chosen by someone else's code is a range you cannot test.**
  `scripts/secret-scan.mjs` selects it here, per event, and
  `scripts/test-secret-scan.mjs` drives every event against throwaway
  repositories — including proving that the old strategy missed what the new one
  catches.
- **"Scan everything" is not the safe default it looks like.** It cannot
  distinguish a new leak from a known old one, so it fails every release equally
  and teaches everyone to ignore it. Scope the gate to the change; inventory the
  history separately (`secret-history-audit`, which gates nothing).
- **A gate that fails open on a bad input is worse than no gate.** Every path
  that cannot determine a base exits non-zero and says so. There is no fallback
  that widens the scan.

Review of the first implementation added two more, and both are the same shape —
a baseline that looked sound and was not:

- **"Every earlier commit was scanned" assumes it was scanned *successfully*.**
  Comparing a manual re-run against `head^1` meant that after a push whose scan
  FAILED, a re-run scanned only the newest commit — so a credential added earlier
  in that push and deleted before its tip was in neither the range nor the tree.
  `workflow_dispatch` deploys, so that was a bypass. The baseline is the newest
  ancestor whose own `secret-scan` passed, asked of GitHub because git cannot
  know it, and no such ancestor means refusal.
- **A fallback can collapse to nothing.** Falling back to the merge base with the
  default branch is `mergeBase(head, head)` after a force-push *to* the default
  branch — the head itself, an empty range, everything passing. Any base equal to
  the head is refused now, wherever it came from.

A second review round found the same shape twice more, and both were reproduced
before they were fixed:

- **A push's own `before` is only as good as the scan that ran on it.** When the
  previous push FAILED, `before` is that failed tip, so the next ordinary push
  compares against it and the failed increment sits behind the range — and if the
  credential was also deleted there, the tree is clean too, so the later push
  passes and deploys. Measured: push A fails with 1 finding, push B passes with
  0, and push B anchored at the last *validated* commit fails with 1. Every event
  but a pull request now anchors there.
- **An abbreviated SHA is a different string and the same commit.** Every check
  but `is-ancestor` compared strings, and a commit is its own ancestor, so
  `SECRET_SCAN_BASE=<head[0..8]>` gave a 0-commit range that passed over a real
  disclosure. Bases are resolved to their full SHA *before* anything compares
  them.

A third round found the same principle inside the scanner wrapper rather than
the range:

- **A readable report is not proof that the scan finished.** A nonzero exit that
  still wrote a parseable EMPTY report set `ok` false and `errored` false, and
  the caller only looked at `errored` and the finding count — so no problem was
  recorded and the gate reported success over a scanner that had failed. Nonzero
  with nothing to show for it is now an incomplete scan, and the caller also
  refuses any scan that did not report success. gitleaks 8.30.1 could not be
  made to do this (every probed failure exits 0 or writes no report at all),
  which is the point: the guarantee must not rest on one version's exit-code
  habits. Driven by a stub scanner in `test-secret-scan.mjs` C16/C17.

And a fourth round found it in the definition of "validated" itself:

- **A green `secret-scan` does not mean the scanner works.** The commit that
  BREAKS the scanner is exactly the commit whose `secret-scan` passes wrongly
  while `callable-contract` — which runs the scanner's own tests — fails. That
  commit looked like a valid baseline, so the next push, with the scanner fixed,
  anchored there and never looked at what the broken scanner waved through. A
  baseline now needs **`secret-scan` and `Verify the release is fully validated`
  to have succeeded in the same workflow run**; the second refuses unless every
  `ALWAYS_REQUIRED_JOBS` entry passed, which is what makes it proof that the
  scanner passed its own tests. It is the same check the production-promotion
  gate already requires by name.

- **An escape hatch is a bypass if nobody checks it.** `SECRET_SCAN_BASE` cleared
  only the structural bar — a real SHA, an ancestor, not the head — while the
  refusal messages *tell an operator to set it*. The natural repair for "nothing
  is validated" was therefore to paste in the tip that had just failed, which is
  the one commit whose broken scanner reported success. An override now has to
  carry a validated release like any inferred base: it names a release known to
  be good, it does not invent one.

`.gitleaks.toml` comes from the branch under test, so weakening the gate is an
alternative to passing it — and enumerating the ways is a losing game. Measured
against gitleaks 8.30.1, each of these hides the same synthetic key from BOTH
scans while leaving the pinned values untouched: `[extend] disabledRules`,
`[allowlist] stopwords`, the plural `[[allowlists]]` form, and `[allowlist]
paths`; `[allowlist] commits` hides it from the range scan alone.

Whitelisting the *keys* was the first attempt and it was not enough: TOML spells
one key several ways, and `"disabledRules" = [...]`, `'disabledRules' = [...]`
and `extend = { disabledRules = [...] }` all reach the scanner while a regex over
bare identifiers sees four innocent keys. **The config's non-comment content is
pinned line for line instead** (L24a) — any edit in any syntax fails until the
test is updated with the measurement that justifies it. Comments stay free,
because gitleaks ignores them and the reasoning belongs beside the values.

Two more exemptions need no config change at all, and both were measured:

- **`gitleaks:allow` in a source comment is honoured by DEFAULT.** The same key is
  reported in a plain file and silently ignored in one carrying that comment, in
  both scans. A change could exempt its own credential with one line of code.
  The scanner passes `--ignore-gitleaks-allow` (L25); the repository has no such
  comment today.
- **`.gitleaksignore` suppresses findings by fingerprint**, and pointing
  `--gitleaks-ignore-path` at a directory without one does **not** restore them —
  so it cannot be neutralised from the command line. The scanner refuses when one
  is present, in the checkout or in the exported tree, rather than scanning
  around it (L26).

All of it is pinned, in two places since 2026-08-27 — when the scanner outgrew
one file and its assertions followed it.

`test:secret-scan` §L reads the scanner's own source: a pinned version *and*
digest, both scans present, `--ignore-gitleaks-allow` passed, `--all` never,
no push anchored at its own `before`, an override held to the same bar as an
inferred base, and `.gitleaks.toml` pinned line for line. It reads that source
as **a set it derives** (`scripts/secret-scan/test-sources.mjs`), not as a path —
otherwise splitting the scanner again would leave a regex passing over a file the
flag had moved out of. L27 and L28 assert that set is neither narrower nor wider
than the implementation.

**What "the scanner's source" is, and what it is not.** The covered set is the
entry plus every non-test module in `scripts/secret-scan/` — a directory listing,
so no import syntax can omit a file. `loadedGraph()` then asks Node's own
resolver what the entry loads and refuses anything outside that set, which makes
the STATIC half unfalsifiable. The specifier scan remains for the half a graph
cannot contain: a dynamic `import()` inside a function body does not resolve
until it runs. It refuses computed specifiers as a class, tolerates comments in
any of the four line terminators ECMA-262 defines, resolves `?query` and
`#fragment` as URLs, refuses the gateways to an aliased loader (`node:module` in
either spelling, `process.getBuiltinModule`, `eval`, `Function`) because an
alias's call site is not spelled `import`, and accepts only a specifier it can
account for — a Node
builtin, which is not a file here, or a relative one, which containment resolves.
That last is also a class rather than a list: being one string literal was the
whole test until an absolute path, a `file:` URL and a bare package name each
passed it while the containment scan, which reads only `./` and `../`, never
looked at them.

**That is not a proof, and pretending otherwise would be the failure this file
keeps recording.** Fourteen review rounds on 2026-08-27/28 each found another
spelling — a double quote, a concatenation, a comment before the parenthesis, a
U+2028 line terminator, a URL suffix, a `createRequire` alias, a literal that was
not relative, a `process.getBuiltinModule` gateway, then a Unicode-escaped name,
a computed bracket key, computed destructuring and a hex-escaped key that
disguised that gateway, then comment-separated and hex-escaped `node:module`
imports, constructor chaining beyond an approved `process.env` prefix, then the
same chain hidden behind grouping parentheses.
Unicode and hex escapes are refused as source structures; loader-import patterns
use the same comment-aware separator as ordinary module calls. More
importantly, `process` is now a closed set of complete expressions: only terminal
`arch`/`platform`, numeric `argv[1]`, `cwd()`, one uppercase `env` key and
`exit(1)` are accepted, with no following member or index. Aliases, destructuring,
imports and bare values are refused regardless of how a property name is
constructed; `global` and `globalThis` are refused too. The
alias round showed that following one needs data-flow analysis, which
a parser alone does not give, and `callable-contract` deliberately runs with no
`npm ci` so there is no parser there anyway. Arbitrary data-flow and reflection
remain outside this source scan. What these checks close is the accidental and
the disguised-but-legible; an author who can edit the scanner can also edit the
assertions, and code review is the control for that.

`check:ci-plan` §L keeps the wiring: no third-party scanning action, the job runs
this repository's scanner, full history is checked out, no `if:` can condition it
away, `secret-scan` is still unskippable and still fails the release when it
fails *or* is skipped, and the full-history audit cannot reach
`release-validation`.
<!-- /safehaul-design-system -->
