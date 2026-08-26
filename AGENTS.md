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
<!-- /safehaul-design-system -->
