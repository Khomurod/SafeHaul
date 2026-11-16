---
name: check-and-report
description: >-
  SafeHaul's workflow for a request to check, review, audit, compare,
  investigate or explain something when no change is asked: «проверь»,
  «посмотри», «разбери», «почему так», «что будет, если», «что посоветуешь».
  Read-only. It ends in a short plain-Russian report with numbered
  recommendations and numbered questions, not in a diff or a pull request.

  Not for: a request to build, fix, change or remove something (use
  `implement`).
---

# /check-and-report — проверь и доложи

The owner asks a question and wants an answer they can act on. They are not a
programmer and read Russian.

```
/check-and-report Проверь, может ли рекрутер одной компании увидеть водителей
другой компании.
```

The rules of `AGENTS.md` apply here too. This skill adds the order of work for a
task that changes nothing.

## 1. Pin down the question

- State to yourself in one sentence what the owner wants to know, and which
  decision the answer serves.
- If a key word in the request can mean two different things in this project,
  ask one short question before a long check. A deep report on the wrong subject
  costs the owner more than the question does.
- Otherwise choose the most likely reading, start, and name that reading in the
  first line of the report.
- Tell the owner in one plain Russian line what you are going to check.

## 2. Change nothing

- No edits to tracked files, no commits, branches or pull requests.
- No writes to Firestore, Storage or Auth, no deploys, no settings changed in
  any console, no emails, messages or campaigns sent.
- The Testing site works on real data. Do not submit forms or press buttons
  that save anything, there or on Production.
- Running tests, lint and the build locally is allowed: read
  `.claude/rules/testing.md` first.
- Keep scratch scripts and their output outside the repository.
- When you find something that needs fixing, even something urgent, put it
  first in the report. Do not fix it.

## 3. Collect evidence

- Read the code, not only the documents. `docs/APP_BRIEF.md` is the map; when
  it and the code disagree, the code is right and the disagreement is itself a
  finding.
- Every finding rests on something you looked at yourself: the lines of a file,
  a command and its output, a test you ran, a page you opened.
- Know which kind each claim is, and say so wherever it affects the decision:
  **checked** (you read it or ran it), **inferred** (it follows from what you
  read, but you did not run it), **not checked** (you could not reach it).
- Try to disprove each important finding before you report it: look for the
  guard, the rule or the test that already handles the case.
- Findings from bots, other agents and old reports are claims to verify.
- For a fact about an outside service — a price, a limit, terms of use — read
  the current page and give its date. Do not answer from memory.
- What you cannot reach (the live sites, a console, logs, the owner's computer)
  you do not guess. List it as not checked, with what the owner would have to do
  to make it checkable.
- Rank findings by harm to users and to the business. Leave out matters of
  taste unless the owner asked for them.

## 4. Write the report

Write the chat reply in plain Russian for a reader who is not a programmer. It
fits on one phone screen, about 120 words:

1. **First line: the answer.** Yes, no, or the one thing that matters most.
2. **Рекомендации** — a numbered list, most important first, five at most, one
   short sentence each.
3. **Вопросы** — a second numbered list, only what the owner has to decide,
   each answerable in a word or two.
4. One line on what you could not check, when it matters to the decision.

- Say what happens to people («рекрутер увидит чужих водителей»), not what
  happens in the code.
- No file, function or branch names, and no English term where a Russian word
  exists.
- Separate what only the owner can do (in an account or a console) from what an
  agent can do once they agree.
- No preamble, no account of how you worked, no summary at the end.

When the detail is worth keeping, put it in a separate document and link it in
one line. The chat reply must stand without it: the owner may never open the
document. Do not add the document to the repository unless the owner asks, and
never when it describes an unfixed security weakness: the repository is public
(`AGENTS.md` §3).

## 5. Stop at the report

- The report is the deliverable. Do not begin the fix.
- The owner answers by number («1 да, 2 нет, 3 позже»). Each recommendation they
  accept is a new task under `implement`, one small pull request each. Do
  exactly the accepted ones, and nothing they declined.
