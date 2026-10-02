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

# SafeHaul — rules for AI agents

Read this page in full before you change anything. It is short on purpose:
topic detail lives in `.claude/rules/` (open the file §5 names before you touch
that area), and the history behind every rule lives in `docs/archive/` (read it
only to learn *why* a rule exists).

## 1. Working with the owner

- The owner is not a programmer and reads Russian. Before you start a task, tell
  them in at most three plain Russian lines what will change for users and what
  you will not touch.
- Ask only when different readings would lead to materially different work;
  otherwise choose, state the assumption, and continue.
- One task, one small pull request. Do not bundle unrelated changes, and do not
  start internal campaigns (rewrites, migrations, new guards) nobody asked for.
- Every pull request description starts with **Кратко**: three or four plain
  Russian lines on what changed for users, what was checked, the risks, and what
  the owner must do. The rest follows `.github/pull_request_template.md`.
- Never promote to Production, delete data, or change permissions, Firebase rules
  or billing unless the owner asked for exactly that.

## 2. Where the knowledge is

- **`docs/APP_BRIEF.md`** says what the app does: workflows, business rules,
  permissions, integrations, background jobs, decisions that must be preserved and
  known limitations. Read the sections your task touches before you change
  anything, and update it in the same pull request whenever your change makes it
  untrue. The code is the source of truth; a task is not finished while the brief
  and the app disagree. Keep the brief concise: it prevents misunderstandings, it
  does not mirror the code.
- **Testing is not a sandbox.** `truckerapp-system.web.app` uses the same real
  Firestore, Auth, Storage, Functions and integrations as Production. Merging to
  `main` deploys Testing and the shared backend at once; Production
  (`app.safehaul.io`) changes only when someone promotes a tested version.
- **The owner's own pages** are `docs/OWNER_GUIDE.md` and
  `docs/RELEASE_CHECKLIST.md`, in Russian. Keep them true when you change what
  they describe.

## 3. Rules that always apply

- Find the root cause. Reproduce a defect in a test before you fix it, and keep
  the fix as small as the problem allows.
- Never report a check as passing unless you ran it and it passed. Name what you
  skipped or could not run. A tool timeout is not a test failure, and "flake" is
  not a root cause.
- Never skip, disable or quarantine a test to get green. Never push an empty
  commit or rewrite someone else's branch history.
- No handwritten source file may exceed 500 physical lines; at 400 it must
  justify its shape (`npm run check:source-size`).
- Never commit a secret. The secret scan gates every release.
- Reuse the existing pattern before adding a new one. Feature logic lives in its
  feature, hook or service.

## 4. Commands

| What | Command |
|---|---|
| Lint | `npm run lint:frontend`, and `npm run lint` in `functions/` |
| Unit tests | `npm test` (CI runs `npm run test:coverage`), and `npm test` in `functions/` |
| Build | `npm run build`, then `npm run check:bundle-budget` |
| Browser tests | `npm run test:e2e -- --project=chromium`, one suite at a time |
| Firestore rules | `npm run test:rules` (with emulators: `npm run test:rules:emulators`) |
| Guards (CI runs all) | `check:source-size`, `check:agent-docs`, `check:ui-contract`, `check:icon-contract`, `check:ai-boundary`, `check:function-exports`, `check:public-claims`, `check:ci-plan`, and `node scripts/check-callable-contract.mjs` |

## 5. Before you touch an area, read its rules

| Area | Read first |
|---|---|
| Tests, Playwright, any local test run | `.claude/rules/testing.md` |
| UI, styling, components, Storybook | `.claude/rules/ui.md` |
| `.github/`, the CI planner, deploy and release scripts, the secret scan | `.claude/rules/release-pipeline.md` |
| File size limits, the size of `src/firestore.rules` | `.claude/rules/source-size.md` |
| A library, framework, SDK or CLI question | the Context7 block at the top of this file |

Claude Code loads these files on its own when it opens matching files. Every
other agent must open them.

## 6. Tools

- On the owner's machine three MCP servers may be configured: **codebase-memory-mcp**
  for orientation, call paths and impact (`search_graph`, `trace_path`,
  `get_architecture`, `search_code`); **serena** for exact symbols, references and
  renames; **Superpowers** for the working process (clarify, plan, test first,
  review, verify). Use each for its own job, and do not ask all of them the same
  question. Keep durable project memory in one place.
- Where they are absent, as in cloud sessions, use the native tools: search,
  read, git and the test runner.

## 7. Keeping these instructions small

- `npm run check:agent-docs` fails CI when an instruction file outgrows its limit
  (this page: 150 lines; each `.claude/rules/` file: 150). The limits live in
  `scripts/agent-docs-limits.mjs`. Do not raise one; shorten the text.
- Add a rule only when an agent made the same mistake twice or a review caught
  it. Write it as one or two lines that state the rule as it is now, in the file
  where it belongs, and back it with a test or a check when you can.
- Instructions carry no history: no "until 2026-…", no "review found…", no
  incident stories. Put the story in `docs/archive/` and keep only the rule.
