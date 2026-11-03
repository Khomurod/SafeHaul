# M2a. Dossier Notes: take shared history from the record already loaded

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #3 — Prevent duplicate API calls (the Notes tab re-reads the application document)
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** Each time a recruiter opens the Notes tab of a driver's dossier, the app reads the whole application document again, its largest record, only to look for an old shared-history list. The dossier already holds that document in memory. After this change Notes opens with one read fewer, and everything shown stays the same.

## Current behaviour (verified at 11626a6)

- `src/features/company-admin/components/tabs/NotesTab.jsx:79-84` reads `internal_notes` and `getDoc(companies/{id}/{collection}/{appId})` side by side. Lines 93-105 turn `sharedHistory` into anonymised Previous Recruiter notes. The effect depends on `[companyId, applicationId, collectionName]` (133). Today a failed record read also hides the notes, because both reads share one `Promise.all`.
- `src/features/applications/hooks/useAppFetch.js:50-69` has already read the same document into `appData`. `src/features/company-admin/components/modals/driver-dossier/DossierContent.jsx:91-100` renders `NotesTab` without it, and `DossierContent` renders only after the record has loaded (`DriverProfileModal.jsx:185-209`).
- `appData` is read once per dossier open (`useAppFetch.js:153-157`) and afterwards changes only through spreads (`src/features/applications/hooks/useAppActions.js:54`), so the `sharedHistory` array keeps its identity.
- Nothing in `src/` or `functions/` writes `sharedHistory`; a repo-wide grep at 11626a6 finds only `NotesTab` and its tests. It is legacy data on old records and must still be shown.
- Frozen-contract notes: the `NotesTab` docblock lists the parent-document `sharedHistory` read (18-21), and the `DossierContent` docblock lists every prop handed to every tab (16-18).
- Tests that pin the old read: `DossierBodies.notes.test.jsx:61-87` (two shared-history cases) and `92-103` (side by side, asserting `getDoc` once), and `DossierBodies.a11y.test.jsx:74-84`. `DossierContent.lazyTabs.test.jsx:17` mocks `NotesTab` without looking at its props.
- DQ tab, checked and left alone:
  - `DQFileTab.jsx:176-189` runs a one-time `getDocs` of `dq_files` (181), while `src/features/company-admin/hooks/useApplicationView.js:26-38` holds a listener on the identical query (`orderBy('createdAt', 'desc')` on the same path).
  - The installed SDK (`firebase` 11.10.0, `@firebase/firestore` 4.8.0) answers `getDocs` through a temporary snapshot listener (`node_modules/@firebase/firestore/dist/index.esm2017.js:18499-18515`). That listener joins an existing listener for the same query instead of opening a new server target (`__PRIVATE_eventManagerListen`, 16079-16110).
  - So the read costs no extra server work.

## Scope

- In: a `sharedHistory` prop on `NotesTab`, which `DossierContent` passes from `appData`; the docblocks and the tests.
- Out (do not do in this task):
  - `DQFileTab` (no gain, see above).
  - The notes query, the writer-name read (`getPortalUser`, already cached per session) and the Activity tab.
  - Removing the shared-history display: old records still carry the field.

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md` and `.claude/rules/testing.md`.
- `.claude/rules/ui.md` §5: this PR changes where the tab gets its data, not its look.
- `docs/APP_BRIEF.md` §4 Pipeline, documents and operations.
- `src/features/company-admin/components/tabs/DossierBodies.contract.support.jsx` (header 1-20, `makeRenderNotes` at 177-178).

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «Вкладка Notes в карточке водителя перестанет заново читать всю анкету: старая «общая история» берётся из уже загруженной карточки. На экране ничего не меняется.»
2. Write the failing tests first (see Tests) and confirm that they fail.
3. In `NotesTab.jsx`:
   - Change the signature to `NotesTab({ companyId, applicationId, collectionName = 'applications', sharedHistory })`.
   - Delete `parentDocRef` and the `getDoc` call (81-84), so the read is `const snapshot = await getDocs(q);`.
   - Build `sharedNotes` from `Array.isArray(sharedHistory) ? sharedHistory : []`, with the same mapping (96-104).
   - Add `sharedHistory` to the effect's dependencies.
   - Drop `doc, getDoc` from the line-3 import; nothing else in the file uses them (the `doc` inside the line-86 map is a local parameter).
   - Docblock: replace the parent-document `sharedHistory` read with: the record's `sharedHistory`, passed in from the dossier's own read. Update the comment at 71-73 (the notes and the writer's name are read side by side).
4. In `DossierContent.jsx:94-98`, pass `sharedHistory={appData?.sharedHistory}`. In its docblock (16-18), note that Notes also receives the record's shared history.
5. Change the tests:
   - `DossierBodies.notes.test.jsx`: the two shared-history cases (61-87) pass `renderNotes({ sharedHistory: [...] })` instead of mocking `fs.getDoc`. The case at 92-103 becomes: reads the notes and the writer's name side by side, and not the record again, with `expect(fs.getDoc).not.toHaveBeenCalled()`.
   - `DossierBodies.a11y.test.jsx:74-84`: pass the prop.
   - `DossierBodies.contract.support.jsx` header line 16: the `sharedHistory` it is given.
6. Open the PR with **Кратко**. Suggested text: «Вкладка Notes открывается на одно чтение быстрее: «общая история» берётся из уже загруженной карточки водителя. Внешне ничего не меняется. Проверено: юнит‑тесты и браузерный тест карточки. От вас ничего не нужно.» Write the DQ-tab decision and its SDK evidence in the PR.

## Tests

- `DossierBodies.notes.test.jsx`:
  - Does not read the record again: `fs.getDoc` is never called. Fails before.
  - Anonymisation (Previous Recruiter, Shared History) and newest-first sorting, with the history passed as the prop.
  - A non-array `sharedHistory` is ignored, and the local notes still show.
- `DossierContent.lazyTabs.test.jsx`: the `NotesTab` mock captures its props, and the Notes tab receives `appData.sharedHistory`. Fails before.
- `DossierBodies.a11y.test.jsx`: no axe violations with local and shared notes.
- `DriverProfileModal.contract.test.jsx` and `DriverProfileModal.behavior.test.jsx` are unchanged and pass.

## Documentation to update in the same PR

- None. The brief does not describe the Notes tab's reads. Roadmap: none (no visual change), stated in the PR.

## Verify before opening the PR

- `npx vitest run src/features/company-admin/components/tabs/ src/features/company-admin/components/modals/driver-dossier/`, then `npm run test:coverage`.
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget`, `npm run check:source-size` and `npm run test:stories`.
- Playwright: check that port 5000 is free, then run `npm run test:e2e -- --project=chromium e2e/driver-dossier.spec.cjs`.

## Verify after merge (on Testing, read-only)

- Confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner: open any driver on Testing and go to Notes. The notes are listed as before; on an old record with shared history, its notes still show Shared History by Previous Recruiter. Do not add a note just to test.

## Risks and safeguards

- Notes now show even when a separate record read would have failed. That is an improvement, and the record itself was already read by the dossier.
- The record is read once per dossier open, and later changes are spreads that keep the same `sharedHistory` array, so the notes are not re-read during a session.
- Rollback: revert the PR.

## Done when (acceptance criteria)

- [x] `NotesTab` makes no `getDoc` of the record; shared history comes from the prop.
- [x] The display, anonymisation, sorting, sanitising and every string are unchanged.
- [ ] The docblocks and tests describe the new source; the DQ-tab decision and its SDK evidence are written in the PR.
- [ ] Unit tests, lint, typecheck, build and `driver-dossier.spec.cjs` passed; the PR starts with Кратко.

As done (2026-11-03, batch PR #557). Every file:line above was re-checked at `dd5866a`: none moved since `11626a6`. Adapted:
- `sharedHistory` has no default in the signature. It is now an effect dependency, so a `= []` default would be a new array on every render and re-read the notes each time. A test pins one notes read with no history passed; it fails with that default.
- Tests beyond the list: shared history is sanitised before it shows (nothing covered that path), and a re-render with the same array does not re-read the notes. The non-array case runs for an object and a string; each fails without the `Array.isArray` guard.
- Two improvements, both intended: a failed record read can no longer hide the notes (there is no second read), and a non-array `sharedHistory`, which used to throw inside the read and hide every note, is now ignored.
- `DossierBodies.notes.test.jsx` calls `vi.resetAllMocks()` before the harness puts its defaults back, because it queues `*Once` values. The shared harness keeps `vi.clearAllMocks()`; `DossierBodies.dqfile.test.jsx` queues `*Once` values on it too and is left for its own change.
- `driver-dossier.spec.cjs` passed on `chromium` (10, the `@mobile` case skipped) and on `mobile-chrome` (1). Its Firestore is unreachable, so the dossier shows its error state and the Notes body never renders there; the new path is covered by the unit tests only.
- Open boxes: the PR text (Кратко, the DQ-tab decision and its SDK evidence) belongs to the batch PR's description. Every check in the last box passed.
- No brief, owner-guide or roadmap change: none describes the Notes tab's reads. M4-4 is not ticked here.
