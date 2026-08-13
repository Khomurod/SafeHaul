---
name: implement
description: >-
  The standard workflow for implementing any meaningful change to this
  application — a feature, bug fix, adjustment, behavior change, removal,
  refactor with user-visible effect, integration change, or permission/workflow
  change. Use it whenever the user asks for something to be built, fixed,
  changed, or removed, including when they describe the desired outcome in
  business language and leave the technical approach open. It enforces one
  repeatable process: understand → investigate → implement → test →
  self-review → verify again → update documentation → report.

  Not for: answering questions, explaining existing code, exploratory research,
  or writing throwaway scripts with no effect on the application.
---

# /implement — standard implementation workflow

Invoked as `/implement <requested change>`, where the request may be written in
plain business language:

```
/implement Route Monitor is not automatically completing routes when the driver
reaches the destination. Fix it without affecting off-route warnings.
```

**The user states the desired outcome. You determine the technical solution.**
Do not ask the user to prescribe an implementation when the intended result is
already clear.

This skill defines *the process*, not the application. Repository-specific rules
and application knowledge live elsewhere and always win over anything you assume:

| Source | Owns |
|---|---|
| `CLAUDE.md` (+ files it imports, e.g. `AGENTS.md`) | How to work in this repository; permanent project rules |
| The **App Brief** (`docs/APP_BRIEF.md`) | What the app is, how it behaves, business rules, preserved decisions |
| This skill | The universal implementation process |

Read those files during the task rather than relying on memory of them.

---

## 1. Understand

Before editing anything:

- Read `CLAUDE.md` and the instruction files it imports.
- Read the parts of the App Brief that touch the request — behavior, business
  rules, permissions, integrations, background jobs, ripple risks, preserved
  decisions, known limitations.
- Read any other repository instructions that apply to this kind of change (for
  UI work, the design-system policy and its documents; for pipeline work, the
  release-pipeline rules; and so on).
- State to yourself, in one or two sentences, **the final behavior the user
  wants**.
- Identify the **explicit exceptions and the surrounding behavior that must not
  change** ("without affecting off-route warnings" is a requirement, not an
  aside).

Ask the user only when different readings would produce materially different
work. Otherwise make the routine judgment call, note the assumption, and
proceed.

## 2. Investigate

Before implementing:

- Read the actual current code for the behavior in question. Trace how it really
  runs — entry points, the data it reads, the conditions that gate it, where the
  effect is supposed to happen.
- For a defect, **find the real root cause**. The user's account of *why* it is
  broken is a symptom report, not a diagnosis; verify it and discard it if the
  code says otherwise.
- Check what else depends on the code you are about to change, and what shares
  its state, data, or triggers. For risky or cross-cutting changes, do enough
  impact analysis to know what could break — the App Brief's ripple-risk notes
  are a starting point, not the whole answer.
- Find the existing pattern for this kind of work and reuse it — components,
  hooks, services, helpers, conventions. Do not invent a parallel mechanism when
  one already exists.
- Use the repository's designated tools for each job (see `CLAUDE.md` /
  `AGENTS.md` for the tool-responsibility policy). Do not fan the same question
  out to every tool.

## 3. Implement

Implement the requested result **completely**.

- Fix the underlying cause, not the visible symptom. No masking, no special-case
  patch over a general defect.
- Preserve unrelated existing functionality. Do not silently change behavior the
  request did not ask you to change.
- Respect the existing architecture, conventions, permissions, business rules,
  integrations, data model, and repository invariants. If the change genuinely
  requires breaking one of them, say so explicitly rather than doing it quietly.
- Keep it as simple as the problem allows. No speculative abstraction, no
  unrelated cleanup riding along in the same diff.
- If implementation reveals a materially better way to reach the requested
  outcome, **serve the outcome**, not an assumed implementation — and say what
  you did differently and why.
- Stay inside the scope the request implies. Note adjacent problems you find;
  do not fix them uninvited.

## 4. Test

- Run the existing tests that cover the changed behavior and its neighbors.
- Add or update tests so the new or fixed behavior is protected against
  regression, and so the preserved behavior stays preserved.
- Run the repository's applicable checks — build, lint, type-check, static
  analysis, security/secret scanning, rules tests, and any project-specific
  validators. Discover them from the repository (its scripts, CI configuration,
  and the App Brief's testing section) rather than assuming; follow the
  repository's own test-runner safety rules exactly.
- **Never report a check as passing unless you actually ran it and it actually
  passed.** A skipped, unavailable, timed-out, or externally killed run is not a
  pass — say which it was. Inspect the real exit status and log before calling
  anything a failure, too.
- If a check fails because of your change, **investigate and fix it**. Reporting
  the failure is not the deliverable. If a failure predates your change, verify
  that on the unmodified baseline before saying so.

## 5. Self-review

Review your own diff as if it were another developer's pull request. Work
through these deliberately:

- Did I implement **everything** requested, or only the easy part?
- Did I misunderstand any part of the desired behavior?
- Which edge cases did I skip — empty, missing, stale, duplicate, concurrent,
  offline, permission-denied, partial data?
- Did I change any unrelated behavior?
- Did I duplicate logic that already exists, or make something more complicated
  than it needs to be?
- Did I violate a business rule, permission rule, integration contract,
  design-system rule, or documented project invariant?
- What is the regression risk, and what depends on what I touched?
- Are the tests actually sufficient for the behavior that changed?
- Is there leftover debug output, commented-out code, dead code, stray files, or
  temporary scaffolding?
- Does the final diff contain anything that should not be there?

**Fix what you find.** Self-review that only produces a list of problems has not
done its job. Escalate to the user only what genuinely cannot be resolved inside
this task.

## 6. Verify again

After fixing anything self-review turned up:

- Re-run the affected tests and checks.
- Read the final diff again, end to end.
- Confirm the implementation matches the behavior the user asked for, including
  the exceptions they named.

Do not declare completion while a known implementation problem remains
unresolved — unless it truly cannot be resolved within this task, in which case
report it plainly instead of burying it.

## 7. Documentation and the App Brief

Before the task is complete:

- Re-read the App Brief and decide whether your change made any part of it
  untrue.
- Update it in the **same task**: add important new behavior, business rules,
  integrations, dependencies, scheduled jobs, permissions, intentional
  exceptions, or preserved decisions; correct or remove whatever became false.
- Check whether the change also invalidated another current document (a runbook,
  a roadmap, a data-model or contract doc) and update that too.
- Keep minor implementation detail out of the brief. It exists to prevent
  misunderstanding, not to mirror the code.
- If documentation and the verified application disagree, **the application is
  the source of truth** — correct the document.

A task is not complete while the application behaves one way and the App Brief
says another.

## 8. Final report

Keep it short. Cover:

1. **What changed** — the substance, not a file-by-file tour.
2. **Whether the requested result is fully implemented** — plainly yes, or
   exactly what is missing.
3. **Which tests and checks ran, and whether they passed** — naming anything
   skipped or unavailable as such.
4. **What self-review found and corrected**, if anything meaningful.
5. **Any genuine remaining limitation, risk, or uncertainty.**

Skip low-level implementation detail unless the user asks for it. Do not hedge
on work that is done and verified, and do not claim work that is not.
