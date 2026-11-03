# M6. Put the Assign To picker back when the save fails

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #14 — Update the UI before the server responds (optimistic UI). This task fixes only the defect the analysis found. It does not adopt optimistic UI anywhere.
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** In the driver dossier, picking a recruiter in **Assign To** changes the list straight away. If the server then refuses the save (for example, the recruiter's access was removed), a red message appears but the list keeps showing the new name, so the recruiter believes the driver was reassigned when nothing was saved. After this fix the list goes back to the name that is actually saved.

## Current behaviour (verified at 11626a6)

- `src/features/applications/hooks/useAppActions.js:45` calls `setAssignedTo(newUserId)` before the write. Lines :47-52 write with `simpleRetry`, which makes 3 attempts 1 s apart (:6-15). `setAppData` runs only after a successful write (:54). The catch at :65-68 logs the error and calls `showError("Failed to update assignment.")`; it never restores the previous assignee.
- The picker is a controlled select: `src/features/company-admin/components/modals/driver-dossier/DossierHeader.jsx:142-149`, `value={assignedTo || ''}` at :145, and `onChange` calls `void onAssignChange(e.target.value)` at :147 (so a rejection from the handler would be unhandled). Its state lives in `src/features/applications/hooks/useAppFetch.js:31` and is filled from the loaded record at :71. The dossier reads the record once with `getDoc` (:53, :62) and has no listener, so nothing corrects the screen afterwards.
- Wiring: `src/features/applications/hooks/useApplicationDetails.js:14-25` → `src/features/company-admin/hooks/useApplicationView.js:13` → `src/features/company-admin/components/modals/driver-dossier/DriverProfileModal.jsx:77, 84-85, 166-167` → `DossierHeader`. This is the only caller, and it passes no `onStatusUpdate` (`useApplicationView(companyId, driverId)` at :85). No other screen writes a single record's assignee with a local-first pattern (`grep -rn "assignedTo:" src`: `LeadAssignmentModal.jsx:156` is a bulk write that waits for the server; the rest are fixtures and new-lead creation).
- `logActivity` swallows its own errors (`src/shared/utils/activityLogger.js:37-39`), so only the record write can reach the catch.
- A status change is not optimistic: `setCurrentStatus` runs at :82, after both writes, so on failure the controlled status select still shows the old value. This is correct and must stay: moving a record into Contact Attempt 1/2/3 texts the driver (`functions/atsContactSms.js:91,104`; APP_BRIEF §8 "Automated contact SMS", lines 1035-1038).
- An offline write does not reject: Firestore holds it until the connection returns. So the failure here means the server refused all 3 attempts.
- `src/features/applications/hooks/useAppActions.assign.test.jsx` passes at 11626a6 (3 tests; run with `npx vitest run` in this review, Vitest 5.0.5). Its harness passes `setAssignedTo: vi.fn()` (:44), so no test checks what the picker shows. It already resets with `vi.resetAllMocks()` and restores defaults (:54-59).
- The old toast text "Failed to update assignment." appears nowhere else in `src`, `e2e` or `docs` (grep), so changing it breaks no test or document.

## Scope

- In: `handleAssignChange` in `useAppActions.js`, its error text, and `useAppActions.assign.test.jsx`.
- Out (do not do in this task): any optimistic UI for status, notes (`NotesTab.jsx`), PEV (`PEVTab.jsx`) or bulk assignment (`LeadAssignmentModal.jsx`); `handleStatusUpdate` and its "Failed to update status." text; `DossierHeader` / `DriverProfileModal` markup; the duplicate `simpleRetry` in `useAppFetch.js:10-19`; the activity-log "from" name when two picks overlap; the existing behaviour that a throw after a successful save (none of the later steps can throw today) shows the failure toast.

## Read first

- `AGENTS.md` §1 and §3; `.claude/skills/implement/SKILL.md`; `.claude/rules/testing.md` ("Writing reliable Vitest tests"); `.claude/rules/ui.md` items 2 and 5. This is a hook-only change with no new rendering, so no design-system work.
- `docs/APP_BRIEF.md` §4 "Pipeline, documents and operations" (line 271 onward) and §12 line 1304 (an unassigned record stores `assignedTo: ''`).
- `DossierHeader.jsx:13-20` (frozen contracts: `onAssignChange(value)` takes one argument; `''` means Unassigned).

## Implementation steps

1. Tell the owner, in three plain Russian lines, what changes and what you will not touch (AGENTS §1), for example: «Если сохранение нового ответственного не удалось, список вернётся к тому, кто действительно сохранён. Смену статуса и заметки не трогаю.»
2. Write the failing tests first, in `useAppActions.assign.test.jsx`:
   - Make `Harness` hold the picker state: `const [assignedTo, setAssignedTo] = useState(record.assignedTo || '');`, pass the real setter instead of `vi.fn()` (:44), and return `<output aria-label="Assigned to">{assignedTo || '(none)'}</output>` instead of `null`. The three existing tests stay as they are and must still pass.
   - Add `afterEach(() => vi.useRealTimers());` (import `afterEach` from `vitest`).
   - Add the tests listed under **Tests**. Run the file and confirm the first new test fails at 11626a6 (the output shows `recruiter-2`).
3. Fix `useAppActions.js` with the smallest change:
   - Add `import { useRef } from 'react';` at the top.
   - After `const { showSuccess, showError } = useToast();` (:29) add `const assignSaves = useRef({ open: 0, saved: '' });` with a two-line comment: while a save is open the picker shows the newest pick; once none is open it shows what the record holds.
   - Replace `setAssignedTo(newUserId);` (:45) with: `const saves = assignSaves.current; if (saves.open === 0) saves.saved = appData?.assignedTo || ''; saves.open += 1; setAssignedTo(newUserId);` (one statement per line). `appData` is current here because each pick is a user event that follows a render.
   - Inside the `try`, directly after the `simpleRetry(() => updateDoc(...))` statement (:49-52), add `saves.saved = newUserId;`. Leave the rest of the `try` (:53-64: `setAppData`, `logActivity`, `showSuccess`, `onStatusUpdate`) unchanged and in the same order.
   - In the `catch` (:65-68) keep `console.error("Error assigning:", error);` and change the text to `showError("Failed to update assignment. Please try again.");`, the "Failed to … Please try again." toast pattern used elsewhere (`src/features/company-admin/views/QuickAddLeadPage.jsx:138` "Failed to add lead. Please try again.", `src/features/driver-app/components/application/publicApplySubmit.js:180,458`).
   - Add `finally { saves.open -= 1; if (saves.open === 0) setAssignedTo(saves.saved); }`.
   - Do not touch `handleStatusUpdate` (:71-89).
4. Self-review against SKILL.md §5 (concurrent picks, permission-denied, offline). Then open the PR with this **Кратко**: «Если в карточке водителя не удалось сохранить нового ответственного (Assign To), список теперь возвращается к тому, кто действительно сохранён, и показывает ошибку «Failed to update assignment. Please try again.». Раньше там оставалось несохранённое имя. Проверено автотестами; при обычном сохранении ничего не меняется. От вас ничего не нужно.»

## Tests

- `useAppActions.assign.test.jsx` → **"puts the picker back on the saved assignee when the save fails"**: record `{ assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' }`; `fs.updateDoc.mockRejectedValue(new Error('permission-denied'))` and `vi.useFakeTimers()`; then `await act(async () => { const p = api.handleAssignChange('recruiter-2'); await vi.runAllTimersAsync(); await p; })`. Expect the output to read `recruiter-1`, `updateDoc` called 3 times, `toast.showError` called with `'Failed to update assignment. Please try again.'`, and `toast.showSuccess` and `logActivity` not called. **Fails before the fix.** If `act` and fake timers do not cooperate, use real timers and a 5 s test timeout (the retries wait 2 s). Settle every promise inside the test.
- **"a later pick that saved wins over an earlier one that failed"**: record unassigned; `fs.updateDoc.mockImplementation(async (_ref, data) => { if (data.assignedTo === 'recruiter-2') throw new Error('permission-denied'); })`. Inside one `act`, start `handleAssignChange('recruiter-2')`, then `handleAssignChange('recruiter-1')`, run the timers, await both. Expect the output to read `recruiter-1`. Passes on the old code by accident, but fails a naive fix that restores `appData.assignedTo` in the catch; it guards the open-save counter.
- **"a failed pick leaves the next change logged from the saved assignee"**: after the failed change to `recruiter-2` (as in the first test), a successful change to `''` logs `'Rita Admin reassigned this from Ann Baker to Unassigned'`. Passes before and after; guards that `setAppData` still runs only after success. Use `mockImplementation` keyed on the data, not `*Once` queues.
- In the existing "logs each change from the assignee it replaced" test, also assert that the output ends on `recruiter-2`, so the success path of the `finally` is covered.
- The file keeps `vi.resetAllMocks()` (:54-59), so `src/tests/mockResetHygiene.test.js` stays satisfied.

## Documentation to update in the same PR

- None. The brief, `OWNER_GUIDE.md` and the design-system roadmap say nothing about how the dossier picker reacts to a failed save: `grep -n -i assign docs/APP_BRIEF.md` finds only lines 275, 974, 1032, 1228 and 1304, none about the picker. Say this in the PR.

## Verify before opening the PR

- `npx vitest run src/features/applications/hooks/useAppActions.assign.test.jsx`, once before the fix (the first new test fails) and once after (all pass).
- `npm run lint:frontend`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, then `npm run check:bundle-budget`, and `npm run check:source-size`.
- `npm run test:e2e -- --project=chromium e2e/driver-dossier.spec.cjs`, then `npm run test:e2e -- --project=mobile-chrome e2e/driver-dossier.spec.cjs`, one at a time (testing.md rule 1; check port 5000 is free first). This is a shell regression check only: under `VITE_E2E_TEST_MODE` Firestore is unreachable (spec header :11-19), so the save path cannot run there. Say so in the PR.

## Verify after merge (on Testing, read-only)

- Watch the `main` run until `verify-shipped` and `release-ready` succeed.
- Optional, owner only: on `truckerapp-system.web.app`, open the dossier of a test application the owner controls, change **Assign To**, then change it back; the "Assigned to …" toast appears as before. Both changes write real data and add activity lines (shared backend), so never do this on a real driver. A failed save cannot be produced safely on the live site; the unit tests prove that case.

## Risks and safeguards

- The picker stays on the old value after a successful save: guarded by `saves.saved = newUserId` right after the write and by the success-path assertion.
- Overlapping picks: the picker changes only when the last open save finishes; while an older failed save is still retrying it may briefly show a newer pick, and it settles on what was saved.
- No new unhandled rejection: the post-save steps stay inside the existing `try`, so the handler `DossierHeader.jsx:147` calls with `void` still never rejects.
- Frontend only; Production gets it only when the owner promotes. Rollback: revert the PR; Testing redeploys.

## Done when (acceptance criteria)

- [x] The "puts the picker back" test failed before the fix and passes after it; the other three new or extended assertions pass.
- [x] After a failed save the picker shows the assignee the record holds, and the toast reads "Failed to update assignment. Please try again."
- [x] No success toast and no activity log entry for a failed save.
- [x] The diff touches no line of `handleStatusUpdate` (:71-89) and no file outside `useAppActions.js` and its test.
- [x] All commands above ran and passed, or the PR names what was skipped and why.
- [ ] The PR starts with **Кратко** and follows `.github/pull_request_template.md`.

As done (2026-11-03, batch PR #557). Every file:line above was re-checked at `fe7dd37`: none of the code lines moved since `11626a6`. The brief moved: §4 "Pipeline, documents and operations" is now at 274, "Automated contact SMS" at 1039-1042, and the unassigned-lead line at 1308. Adapted:
- The steps were followed as written. The tests switch back to real timers after the `act` and wait for the picker's text with `waitFor`. The three failure tests silence `console.error` with a spy that `afterEach` restores.
- Before the fix, "puts the picker back" failed with `recruiter-2` on screen. "A later pick that saved wins" passed its picker check and failed only on the new toast text. The other new and extended checks passed. Two mutations were tried and undone: restoring `appData.assignedTo` in the `catch` fails the overlap test, and dropping `saves.saved = newUserId` fails three tests.
- Outside the hook and its test, only this file and the plan's Progress line changed. The brief, `OWNER_GUIDE.md` and the roadmap say nothing about how the picker reacts to a failed save, so they are unchanged.
- Checks: the six tests pass, and so do the 21 dossier and hook files around them (213 tests). `test:coverage` passed (7528 passed, 83 skipped). Lint (0 errors), typecheck, build, bundle budget, `check:source-size` (no warning for these files), `check:agent-docs`, `check:ci-plan`, `check:public-claims`, `check:ai-boundary`, `check:function-exports` and the callable contract passed too. `driver-dossier.spec.cjs` passed on `chromium` (10 passed, the `@mobile` case skipped) and on `mobile-chrome` (1). Its Firestore is unreachable, so the save path is covered by the unit tests only. `test:stories` did not run: nothing here renders.
- Open box: the PR text (Кратко) belongs to the batch PR's description.
- Review on #557 (CodeRabbit) closed the case first listed under Out: a retried older write could land after a newer pick and overwrite it. Each pick now has a number, and `simpleRetry` checks before every retry that no later pick was made (`shouldRetry`, its second parameter); a superseded pick ends silently, with no toast, no log and no change to the saved assignee. "A later pick that saved wins" now starts the later pick during the earlier pick's last try, so that try still fails and toasts; a new test covers the overwrite, and a guard keeps a lone pick retrying.
