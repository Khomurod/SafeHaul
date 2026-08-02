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

1. Read `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`.
2. Read `docs/SAFEHAUL_UI_DESIGN_STANDARD.md` when that file exists.
3. Read `src/design-system/README.md` and the relevant component/pattern docs.

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

Also avoid editing files that are in the module graph while a Playwright suite is
running: the dev server hot-reloads and the in-flight tests can fail spuriously.

### CI Playwright concurrency: `workers: 1` is deliberate — do not raise it casually

`playwright.config.cjs` pins `workers: process.env.CI ? 1 : undefined` with
`retries: 2`. That is the main reason the `frontend-quality` lane takes ~9
minutes, and raising it to 2 is a tempting way to halve that. It was evaluated on
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
<!-- /safehaul-design-system -->
