# M6-opt. (Optional) Show a just-typed note at once with a "Saving…" mark

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #14 — Update the UI before the server responds (optimistic UI). The one optional extra the analysis allowed.
- **Size:** S · **Pull requests:** 1 · **Depends on:** none (if M6 is also done, keep the two in separate PRs) · **Owner decision needed:** "Should a new internal note appear in the list at once, marked 'Saving…', before the server confirms it?" Recommended answer: **no** — the button already spins, the text is kept if the save fails, and the gain is cosmetic. Skip this task unless the owner says yes.
- **Why it matters for users:** On a slow connection a recruiter would see the note in the list straight away, clearly marked as not yet saved, and it disappears again (with the text still in the box) if saving fails.

## Current behaviour (verified at 11626a6)

- `src/features/company-admin/components/tabs/NotesTab.jsx:135-174` (`handleSend`): `addDoc` (:146-151), then `logActivity` (:154), and only then the note is appended with a stale-closure `setNotes([optimisticNote, ...notes])` (:165) and the box cleared (:166). The comment at :156 calls this an "Optimistic update", but it is not.
- While saving, the button shows `loading={sending}` (:194-203); the design-system `Button` sets only `aria-busy` and a hidden spinner (`src/design-system/components/button/Button.jsx:145-152`), which the roadmap says is not an announcement (`docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md:203-207`: "put 'Saving…' in a role=\"status\"").
- On failure the text stays in the box and "Failed to save note." is shown (:167-170), inside `<div role="alert">` (:206-208) around `FieldMessage tone="error"`, which is itself `role="alert"` (`src/design-system/components/form/FormControls.jsx:53`). These are nested live regions (roadmap :198-202). This is an existing, separate defect; this task does not fix it (see open questions).
- The header contract (:18-28) freezes "the optimistic-append shape" and "every user-facing string"; rule 1 (:31-32) requires the failure message to be announced in place. Changing them is the owner-approved exception this task records.
- Tests: `src/features/company-admin/components/tabs/DossierBodies.notes.test.jsx`, write contract at :114-185, including "optimistically shows the new note and clears the composer" (:147-151) and "rejects a second submit dispatched before the first resolves" (:173-185). The shared harness `DossierBodies.contract.support.jsx` resets with `vi.clearAllMocks()` (:104) and sets `fs.addDoc.mockResolvedValue({ id: 'new-1' })` (:107). NotesTab has no Storybook story and no visual baseline.
- `Badge` tones: neutral, info, success, warning, danger, accent (`src/design-system/components/badge/Badge.jsx:6`).

## Scope

- In: `NotesTab.jsx` `handleSend`, a pending mark on the note row, one polite status region, the header comment, and `DossierBodies.notes.test.jsx`.
- Out (do not do in this task): the nested `role="alert"` wrapper (:206-208; separate task if the owner wants it); the note's stored shape, its path, the `logActivity` arguments, shared-history reading, PEV, status, assignment; any new design-system primitive or token; the harness's `vi.clearAllMocks()`.

## Read first

- `.claude/rules/ui.md`, `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` §3 "States, announcements and focus" (lines 194-210), `src/design-system/README.md`, `src/design-system/components/badge/README.md`.
- `.claude/rules/testing.md`; `NotesTab.jsx:12-51`.

## Implementation steps

1. Get the owner's "yes" first. Then tell them the three Russian lines (AGENTS §1).
2. Write the new tests first (see **Tests**); confirm the first fails at 11626a6.
3. In `handleSend`, after the guards (:137-142): declare `let pending = null; let saved = false;` before the `try`. Inside the `try`, after `sanitizedNote` (:144):
   - `` pending = { id: `pending-${Date.now()}`, text: sanitizedNote, author: currentUser, createdAt: { seconds: Date.now() / 1000 }, type: 'note', isLocal: true, pending: true }; `` then `setNotes((prev) => [pending, ...prev]);`. Keep the text in the box.
   - `const ref = await addDoc(notesRef, { …exactly :147-150… });` then `saved = true;`.
   - `setNotes((prev) => prev.map((n) => (n.id === pending.id ? { ...n, id: ref.id, pending: false } : n)));` then `setNewNote('');`.
   - `await logActivity(...)` with the arguments of :154 unchanged.
   - Delete the old block :156-166.
   - In the `catch`: `if (!saved) { setNotes((prev) => prev.filter((n) => n.id !== pending?.id)); }`, keep `console.error` and `setSendError("Failed to save note.")`. The text stays in the box.
4. Rendering:
   - Next to the author name (:250-259), when `note.pending`, render `<Badge tone="neutral">Saving…</Badge>`.
   - Add one always-mounted polite region inside the form, outside the existing alert wrapper: `<p role="status" className="sr-only">{sending ? 'Saving note…' : ''}</p>` (present and empty when idle, not `display:none`, as the roadmap requires).
5. Update the header comment (:18-28): the new strings "Saving…" and "Saving note…", and the pending-note shape (`pending: true`, `pending-<ms>` id replaced by the stored id).
6. In the PR, state the caveat: while the device is offline `addDoc` does not resolve, so "Saving…" stays until the connection returns, exactly as today's spinner does.
7. PR **Кратко**: «Новая заметка сразу появляется в списке с пометкой «Saving…» и становится обычной после сохранения; если сохранить не удалось, она исчезает, текст остаётся в поле и показывается ошибка. Проверено автотестами. От вас ничего не нужно.»

## Tests

- `DossierBodies.notes.test.jsx` → "shows a new note at once, marked Saving…, until it is saved": `fs.addDoc.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'n1' }); }))`, submit, then expect the note text and "Saving…" visible and the status region reading "Saving note…". Call `release()` inside the test and `await waitFor` the badge to disappear while the note stays. **Fails before the change.**
- "takes the note back and keeps the text when saving fails": `fs.addDoc.mockImplementation(() => Promise.reject(new Error('denied')))`; after "Failed to save note." appears, the note text is not in the list and the textarea still holds it. Passes before the change too; it guards the rollback.
- Do not add `*Once` queues to this file: the harness only clears mocks (support :104), so a once-queue would leak (testing.md).
- Update "optimistically shows the new note and clears the composer" (:147-151) if needed for the new order; "rejects a second submit dispatched before the first resolves" (:173-185) and `DossierBodies.a11y.test.jsx` must still pass.

## Documentation to update in the same PR

- The `NotesTab.jsx` header contract (step 5). No roadmap change: this uses the approved `Badge` and the roadmap's existing announcement rule, adds no primitive, token or exception (ui.md item 4); say so in the PR. No brief change: it does not describe the notes composer.

## Verify before opening the PR

- `npx vitest run src/features/company-admin/components/tabs/DossierBodies.notes.test.jsx src/features/company-admin/components/tabs/DossierBodies.a11y.test.jsx`.
- `npm run lint:frontend` (its `ds/*` rules), `npm run typecheck`, `npm run test:coverage`, `npm run test:stories`, `npm run build`, then `npm run check:bundle-budget`. `check:visual-contract`, `check:table-layout` and `test:visual` are not needed: no component, token, style or table changes (ui.md item 6); say so.
- `npm run test:e2e -- --project=chromium e2e/driver-dossier.spec.cjs`, then the same with `--project=mobile-chrome`, one at a time. Writing a note is not reachable there (Firestore is unreachable in e2e mode); say so.
- A 1440 and 412 review and a keyboard/screen-reader review need the app running with data. If you cannot do them, say so and leave those rows unticked (ui.md item 4).

## Verify after merge (on Testing, read-only)

- The owner adds a note on a test application they control (real data on the shared backend): it appears with "Saving…", which then disappears. Never on a real driver.

## Risks and safeguards

- Duplicated or dropped notes: functional `setNotes` updates keyed on the pending id, plus the tests.
- A saved note rolled back by a later failure: the `saved` flag limits the rollback to a failed `addDoc`.
- Frontend only. Rollback: revert the PR.

## Done when (acceptance criteria)

- [ ] The owner said yes before any work started.
- [ ] The "shows a new note at once" test failed before the change and passes after; the rollback test passes.
- [ ] The note's stored shape (`text`, `author`, `serverTimestamp()`, `type: 'note'`) and the `logActivity` arguments are unchanged (existing write-contract tests pass).
- [ ] Lint, typecheck, unit, story and e2e checks ran; the PR states the result of the 1440/412 and keyboard reviews, or why they could not run.
