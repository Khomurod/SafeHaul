# Claude Code — project instructions

## Read the App Brief first

`docs/APP_BRIEF.md` is the central orientation document for this application:
purpose, users, workflows, business rules, permissions, background jobs,
preserved decisions, and known limitations. **Read the relevant parts before
making changes, and update it in the same task whenever your work makes any
part of it untrue.** The maintenance rule is stated at the top of that file and
is permanent.

Shared agent instructions for this repo live in `AGENTS.md`. Import them so the
Context7 usage guidance and the MCP tool-responsibility policy apply here too:

@AGENTS.md

## SafeHaul UI work

The mandatory UI/design-system policy is in `AGENTS.md` under "SafeHaul UI and
design-system work." Before UI changes, read
`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`,
`docs/SAFEHAUL_UI_DESIGN_STANDARD.md` when present, and
`src/design-system/README.md`. Reuse approved components/tokens, keep domain
behavior in features/hooks/services, update the roadmap with evidence, and
never mark migration work complete without the required functional, visual,
mobile, accessibility, documentation, and diff checks.

Quick reference for the MCP servers wired to this machine:

- **Superpowers** — process control: clarify → plan → debug → test-first → review → verify.
- **codebase-memory-mcp** — broad orientation, architecture, call-path tracing, impact analysis (`search_graph`, `trace_path`, `get_architecture`, `search_code`).
- **serena** — symbol-level navigation and edits: definitions, references, renames, focused refactors.
- **Native tools** (Read/Grep/Glob, git, tests) — exact text, configs, running tests, reviewing the diff.

See `AGENTS.md` → "MCP tool responsibilities" for the full policy.
