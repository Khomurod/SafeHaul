---
name: implement
description: >-
  SafeHaul's workflow for any change to the application — a feature, bug fix,
  adjustment, removal, or a change to behavior, an integration, permissions or a
  workflow. Use it whenever the owner asks for something to be built, fixed,
  changed or removed, including when they describe the outcome in plain Russian
  and leave the technical approach open. One process: tell the owner →
  understand → investigate → implement → test → self-review → update the
  documents → pull request and report.

  Not for: a request to check, review, audit or explain with no change asked
  (use `check-and-report`), or a throwaway script with no effect on the
  application.
---

# /implement — how a change is made in SafeHaul

The owner states the outcome in plain language, usually Russian. You choose the
technical solution; do not ask them to prescribe one.

```
/implement Водитель должен видеть, какие документы он уже загрузил, чтобы не
загружать одно и то же дважды. Не меняй то, как компания видит анкету.
```

«Не меняй…» is a requirement, not an aside.

This skill is the order of work. The rules themselves live in `AGENTS.md`, in
the `.claude/rules/` file for the area (`AGENTS.md` §5 names it) and in
`docs/APP_BRIEF.md`. Read them during the task instead of trusting your memory
of them; where this skill and they differ, they win.

## 1. Tell the owner first

Before any edit, write to the owner in at most three plain Russian lines: what
will change for users, and what you will not touch. No file names, no jargon.

- If a simpler way reaches the same result, or the request as asked would make
  things worse, say so in these lines and recommend the better way.
- Ask only when two readings would lead to materially different work. Otherwise
  choose, state the assumption in these lines, and continue.
- Promoting to Production, deleting data, and changing permissions, Firebase
  rules or billing happen only when the request asks for exactly that. If the
  task seems to need one of them, stop and ask.

## 2. Understand

- Read the App Brief sections the request touches: workflows, business rules,
  permissions, integrations, background jobs, where changes ripple, decisions
  that must be preserved, known limitations.
- State to yourself in one or two sentences the final behavior the owner wants,
  and the surrounding behavior that must stay as it is.
- Decide when users will get the change:

| The change touches | Users get it |
|---|---|
| Screens only (`src/`) | On the Testing site at merge; on Production when the owner releases |
| `functions/`, Firestore or Storage rules, indexes | On both sites at merge, with no trial period |

For the second row, keep the screens of the current Production release working:
they call the new backend from the moment of the merge. Say this in the three
lines and again in **Кратко**.

## 3. Investigate

- Read the current code for the behavior and trace how it really runs: where it
  starts, what data it reads, which conditions gate it, where the effect lands.
- For a defect, the owner's account of why it is broken is a symptom report.
  Find the cause in the code, and reproduce it in a failing test before you fix
  it.
- Check what else depends on the code you are about to change, and what shares
  its data, state or triggers. The brief's section on where changes ripple is a
  starting point, not the whole answer.
- Find the existing pattern for this kind of work and reuse it. Use the tools
  `AGENTS.md` §6 assigns to each job.

## 4. Implement

- Deliver the whole requested result, and fix the cause instead of the symptom.
- Leave unrelated behavior alone. Note adjacent problems you find in the report;
  do not fix them in this change.
- Keep it as small as the problem allows: no speculative abstraction, no
  cleanup riding along.
- If the change has to break a business rule, a permission, an integration
  contract or a preserved decision, say so to the owner before you do it.
- If you find a materially better way to reach the outcome, take it and say what
  you did differently and why.

## 5. Test

- Read `.claude/rules/testing.md` before you run anything locally.
- Add or update tests so the new behavior is protected and the behavior that had
  to stay is pinned.
- Run every check in `AGENTS.md` §4 that the change can affect: lint, unit
  tests, build, the browser tests for the flows touched (desktop and phone), the
  rules tests when rules changed, and the guards for the files you touched.
- A failure your change caused is yours to investigate and fix. Before you call
  a failure old, show it on unmodified `main`.
- Name every check you did not run or could not run, and why. A check you did
  not see pass is not a pass.

## 6. Self-review

Read your own diff end to end as if another developer wrote it:

- Is everything requested done, or only the easy part?
- Which cases are missing: empty, absent, stale, duplicate, simultaneous,
  offline, permission denied, half-saved data, a phone screen?
- Did any unrelated behavior change? Does every changed line trace to the
  request?
- Does it copy logic that already exists, or break a business rule, a
  permission, tenant isolation or a design-system rule?
- Do the tests fail without the change?
- Is anything left behind: debug output, commented-out code, stray files?

Fix what you find, then run the affected tests and checks again and read the
final diff once more. Bring to the owner only what cannot be settled inside this
task.

## 7. Documents

- Update `docs/APP_BRIEF.md` in the same pull request wherever the change made
  it untrue. Keep implementation detail out of it.
- Update `docs/OWNER_GUIDE.md` and `docs/RELEASE_CHECKLIST.md` when the change
  alters what the owner clicks, sees or checks.
- Correct any other current document the change made false. History goes to
  `docs/archive/`.

## 8. Pull request and report

- One task, one small pull request, laid out as
  `.github/pull_request_template.md`. Tick only the checks you ran.
- It opens with **Кратко**: three or four plain Russian lines on what changed
  for users, what was checked, the risks, and what the owner must do.
- Then report to the owner in chat, in plain Russian, in a few short lines:
  1. what changed for users;
  2. whether everything asked is done, or exactly what is missing;
  3. what was checked, and what could not be checked;
  4. the risk, including whether the change works on both sites right after the
     merge;
  5. what the owner must do next, as a numbered list when there is more than
     one thing.
- Keep file, function and branch names out of the chat report. Do not hedge on
  work that is done and verified, and do not claim work that is not.
