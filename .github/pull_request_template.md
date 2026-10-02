## Кратко

<!-- For the owner, in plain Russian, three or four lines: what changed for
     users, what was checked, the risks, and what the owner must do. No jargon. -->

## What changed and why

<!-- The problem, not the patch. What was wrong, and what a reader would get
     wrong later without this explanation. -->

## Evidence

Tick only what you actually ran: an unticked box is information, a wrongly
ticked one is a lie the next person acts on. Delete the rows that do not apply
and say why in one line.

| Check | Ran | Notes |
|---|---|---|
| `npm run lint:frontend` (and `npm run lint` in `functions/` if it changed) | [ ] | |
| `npm test` (and `npm test` in `functions/` if it changed) | [ ] | |
| `npm run build` | [ ] | |
| Browser tests for the flows touched (`--project=chromium` and `--project=mobile-chrome`) | [ ] | which specs |
| The guards this change touches (`AGENTS.md` §4) | [ ] | which |
| Final `git diff` read in full, no unrelated changes | [ ] | |

### UI changes only — delete this section for a change that renders nothing

| Check | Ran | Notes |
|---|---|---|
| `npm run check:ui-contract` and `npm run test:stories` | [ ] | the allowlist may only shrink |
| `check:visual-contract`, `check:table-layout`, `test:visual` (components, tokens, styles or tables moved) | [ ] | |
| Desktop review at 1440 and phone review at 412 | [ ] | what you checked on the phone |
| Keyboard order, visible focus, accessible names; dialogs trap and restore focus | [ ] | |
| Roadmap and component docs updated in this change | [ ] | |

The design-system rules are in `.claude/rules/ui.md` and roadmap §3.

## What it touches

<!-- "None", or name each and why it is approved: Firebase rules, indexes, data
     shape, Cloud Functions or callable contracts; permissions, roles, tenant
     isolation, routes, feature flags; business workflows; uploads, drafts,
     offline queues, PDF geometry, status vocabulary. -->
