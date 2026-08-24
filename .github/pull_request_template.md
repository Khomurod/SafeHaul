## What changed and why

<!-- The problem, not the patch. What was wrong, and what a reader would get
     wrong later without this explanation. -->

## Evidence

Tick what you actually ran. **Never tick an unrun check** — an unticked box is
information; a wrongly ticked one is a lie the next person acts on. Delete the
rows that do not apply and say why in one line.

| Check | Ran | Notes |
|---|---|---|
| `npm run lint:frontend` | [ ] | |
| `npm test` | [ ] | |
| `npm run build` | [ ] | |
| Relevant E2E (`--project=chromium` and `--project=mobile-chrome`) | [ ] | which specs |

### UI changes only

Delete this whole section for a change that renders nothing.

| Check | Ran | Notes |
|---|---|---|
| `npm run check:ui-contract` | [ ] | inventory shrank by N / unchanged |
| `npm run check:visual-contract` | [ ] | geometry unchanged, or the diff and why |
| `npm run test:stories` | [ ] | |
| `npm run check:table-layout` | [ ] | required if a table, cell or column width moved |
| `npm run test:visual` | [ ] | non-blocking lane; attach the diff if it moved |
| Desktop review at 1440 | [ ] | |
| **Mobile review at 412** | [ ] | not a shrunk desktop — say what you checked |
| Keyboard: tab order, visible focus, accessible names | [ ] | |
| Dialogs: focus trap, focus restored on Escape *and* Cancel | [ ] | |
| Roadmap / component README / catalog updated **in this commit** | [ ] | |
| Final `git diff` read in full, no unrelated changes | [ ] | |

## Design-system conformance

- [ ] Every control uses an approved primitive, or the exception is recorded in
      `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` **and** at the call site.
- [ ] Colours are `--ds-*` semantic roles. No raw palette class, no raw hex.
- [ ] Type is on the `--ds-*` scale. Nothing below 12px.
- [ ] Heights and spacing come from the control scale and the surface geometry
      roles — no hand-picked `h-*` or `p-*` on a control.
- [ ] Status is never colour alone.
- [ ] `ui-contract.baseline.json` is regenerated if the counts moved, so the
      inventory records the shrinkage rather than permitting a regression back up.

## Nothing here changes behaviour

A UI/consistency change must not touch any of these. Tick to confirm, or say
which one it touches and why that is approved:

- [ ] Firebase rules, indexes, data shape, Cloud Functions, callable contracts
- [ ] Permissions, roles, tenant isolation, routes, feature flags
- [ ] Business workflows — recruiting, application, signing, verification
- [ ] Uploads, drafts, offline queues, PDF geometry, domain status vocabulary
