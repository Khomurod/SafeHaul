# M2b. Dossier files: reuse a signed link for ten minutes

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #3 — Prevent duplicate API calls (the file-signing callables re-run on every dossier open)
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** Each time a dossier opens, the server signs every driver document again: up to 8 requests (CDL front and back, medical card, and so on), even if the recruiter closed the same dossier a minute ago. After this change a dossier reopened within ten minutes shows its documents at once, and each link stays valid for at least 50 minutes after it is shown.

## Current behaviour (verified at 11626a6)

- `src/features/applications/hooks/useAppFetch.js:73-115` (`getUrl`):
  - For a path containing `guest_uploads`, it calls the `getSignedApplicationFileUrl` callable directly (83-91).
  - If that fails, it falls back to `getDownloadURL`, then `getBlob`, then the stored `url` (92-108).
  - Lines 117-128 sign all 8 fields in parallel once the record shows. Nothing is kept between opens.
- Server side: access is checked on every call (`functions/getSignedApplicationFileUrl.js:56`). The link is a v4 link valid for one hour (58-59; `functions/shared/signReadUrl.js:5, 12-20`). No audit record is written.
- A client service already exists: `signedApplicationFileUrl` in `src/features/applications/services/applicationFileLink.js:18-25`, used on a press by `openApplicationFile.js:39-51`. It picks the callable name into a variable (line 20), and its docblock (1-9) says a link is never stored.
- `useAppFetch.js:85` holds the only literal `httpsCallable(functions, 'getSignedApplicationFileUrl')` in `src/`. `scripts/check-callable-contract.mjs:35-45` (`readFrontendCallables`) finds callables only by that literal pattern, and `scripts/check-release-health.mjs:227` uses the same list to probe that each callable exists in the cloud. Today the list includes `getSignedApplicationFileUrl`.
- Patterns to reuse:
  - `src/features/driver-app/hooks/useSignedUploadPreview.js:43-72`: a module `Map`, a link reused for 10 minutes of its 15, a failed signing removed, and a reset for tests.
  - `src/features/auth/services/userService.js:25-48`: a cache tied to the `auth.currentUser` session.
- `docs/callable-frontend-map.md:43` names `useAppFetch.js` as a direct caller of `getSignedApplicationFileUrl`. `docs/APP_BRIEF.md` §4 Uploads (221-228) says views re-sign from `storagePath`.
- `src/features/applications/hooks/useAppFetch.files.test.jsx` drives the signing with deferred callables (27-29). Its `@lib/firebase` mock has no `auth` (19), and its first two cases (62-91) sign the same path. `useAppFetch.team.test.jsx` has no file paths, so it never reaches the signing. `applicationFileLink.test.js:6` mocks `@lib/firebase` as `{ functions: {} }`.

## Scope

- In:
  - `reusableApplicationFileUrl` and `forgetApplicationFileLinks` in `applicationFileLink.js`, with the callable names written as literals.
  - `useAppFetch` uses them.
  - The tests and docs.
- Out (do not do in this task):
  - `openApplicationFile`. A press keeps signing afresh, so a deleted file still says `This file could not be found` (`openApplicationFile.js:47-49`).
  - The `getDownloadURL` / `getBlob` fallbacks.
  - `useSignedUploadPreview`.
  - The server's link lifetime.
  - A batch-signing callable, which would change a callable contract.

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md`, and `.claude/rules/testing.md` (settle every promise a test starts; reset module caches between tests).
- `docs/APP_BRIEF.md` §4 Uploads (a signed URL is a capability; views re-sign) and §6 (documents are never public URLs).
- `useSignedUploadPreview.js:43-72` and `userService.js:25-48`.

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «Повторно открытая карточка водителя будет показывать документы сразу: ссылку на файл используем повторно 10 минут. Доступ и сроки ссылок на сервере не меняю.»
2. Write the failing tests first (see Tests).
3. In `applicationFileLink.js`:
   - Import `auth` beside `functions` from `@lib/firebase`.
   - In `signedApplicationFileUrl`, write both callables as literals so the contract and release-health lists keep finding them: `const resign = isPevRequestPath(storagePath) ? httpsCallable(functions, 'getSignedPevUrl') : httpsCallable(functions, 'getSignedApplicationFileUrl');`. Its behaviour does not change.
   - Add:
   ```js
   /** Links live an hour (functions/shared/signReadUrl.js); reusing one for ten
    *  minutes leaves every link shown at least fifty. */
   export const FILE_LINK_REUSE_MS = 10 * 60 * 1000;
   const reusable = new Map(); // storagePath -> { link, at, session }

   /** The dossier's link for a file: signed once, then reused for ten minutes
    *  in this tab and sign-in. A press uses signedApplicationFileUrl instead. */
   export function reusableApplicationFileUrl(storagePath) {
     const session = auth?.currentUser ?? null;
     const held = reusable.get(storagePath);
     if (held && held.session === session && Date.now() - held.at < FILE_LINK_REUSE_MS) return held.link;
     const entry = { link: signedApplicationFileUrl(storagePath), at: Date.now(), session };
     reusable.set(storagePath, entry);
     entry.link.catch(() => { if (reusable.get(storagePath) === entry) reusable.delete(storagePath); });
     return entry.link;
   }

   /** For tests: forget every link. */
   export function forgetApplicationFileLinks() { reusable.clear(); }
   ```
   A failed signing is not kept, a link minted under another sign-in is not reused, and nothing goes into browser storage.
   - Update the docblock (1-9): a link is never persisted; the dossier reuses one in memory for ten minutes (`reusableApplicationFileUrl`), and a press always signs afresh.
4. In `useAppFetch.js:83-91`, replace the `httpsCallable` block with `try { return await reusableApplicationFileUrl(fileData.storagePath); } catch (resignErr) { console.warn(...the same message...); }`. Keep the fallbacks. Remove the `httpsCallable` import (line 4) and `functions` from line 5, which line 85 was their only use of, and import `reusableApplicationFileUrl` from `@features/applications/services/applicationFileLink`.
5. Test setup: `useAppFetch.files.test.jsx` and `applicationFileLink.test.js` need `auth: { currentUser: null }` in their `@lib/firebase` mocks and `afterEach(forgetApplicationFileLinks)`. Then grep `applicationFileLink|useAppFetch|useApplicationDetails|useApplicationView` across `src/**/*.test.*` and check each suite that calls `reusableApplicationFileUrl` without mocking the module. At 11626a6 no other suite does: `useAppFetch.team.test.jsx` has no file paths, and the rest mock `useApplicationView` or `applicationFileLink`. A Vitest error that no `auth` export is defined on the mock is the symptom of a missed one.
6. Update the docs (see Documentation).
7. Open the PR with **Кратко**. Suggested text: «Повторно открытая карточка водителя показывает документы сразу: подписанная ссылка на файл используется повторно до 10 минут (живёт час). Доступ проверяется как раньше. Проверено: юнит‑тесты и браузерный тест карточки. От вас ничего не нужно.»

## Tests

- `src/features/applications/services/applicationFileLink.test.js`:
  - Two calls within 10 minutes make one callable request; an in-flight signing is shared.
  - After 10 minutes, a new request (`vi.useFakeTimers()` / `vi.setSystemTime`; restore real timers at the end).
  - Another `auth.currentUser` gets a new request.
  - A rejected signing is not reused.
  - `signedApplicationFileUrl` still signs on every call, and the existing three cases pass.
- `useAppFetch.files.test.jsx`:
  - Reopening the same record within ten minutes signs nothing again: resolve the first signing, unmount, remount for `app-1`, and `fx.signs` stays at one. Fails before.
  - The existing three cases (62-105) keep passing.
- `DriverProfileModal.behavior.test.jsx`, `PreservedApplicationView.test.jsx` and `DossierBodies.dqfile.test.jsx` pass.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md` §4 Uploads: change the existing sentence ending views re-sign from `storagePath` so it says the dossier re-signs its files when it opens and reuses each link for 10 minutes. Edit that sentence; do not add a paragraph. The brief is past its size warning, so `npm run check:agent-docs` must show no growth in its line count.
- `docs/callable-frontend-map.md:43`: show `useAppFetch.js` reaching the callable through `applicationFileLink.js`.

## Verify before opening the PR

- `npx vitest run src/features/applications/ src/features/company-admin/components/modals/driver-dossier/ src/features/company-admin/components/tabs/ src/features/company-admin/hooks/`, then `npm run test:coverage`.
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget`, `npm run check:source-size`, `npm run check:agent-docs` and `node scripts/check-callable-contract.mjs`.
- Confirm that the callable is still listed: `node --input-type=module -e "const m = await import('./scripts/check-callable-contract.mjs'); console.log(m.readFrontendCallables().includes('getSignedApplicationFileUrl'))"` prints `true`.
- Playwright: check that port 5000 is free, then run `npm run test:e2e -- --project=chromium e2e/driver-dossier.spec.cjs`.

## Verify after merge (on Testing, read-only)

- Confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner: open a driver who uploaded a CDL, close the dossier, and reopen it within ten minutes. The images appear at once. Reopening after more than ten minutes still shows them, signed again.

## Risks and safeguards

- A file deleted within the ten minutes can show a broken preview on reopen, where today it would show no file. The window is short, and the record itself is re-read on every open.
- Nothing new is exposed. The link was already valid for an hour, and opening the record still goes through the Firestore rules, so a user who lost access gets no record and no files.
- Dropping the literal callable name would silently remove `getSignedApplicationFileUrl` from the release-health probe. Step 3 and the check above prevent it.
- Rollback: revert the PR.

## Done when (acceptance criteria)

- [x] Reopening a dossier within ten minutes, in the same tab and sign-in, makes no new `getSignedApplicationFileUrl` request; after ten minutes it does.
- [x] Failed signings are not kept; press-to-open (`openApplicationFile`) is unchanged.
- [x] `readFrontendCallables()` still lists `getSignedApplicationFileUrl`.
- [x] The brief, the callable map and the `applicationFileLink.js` docblock are updated; the tests reset the cache.
- [ ] Coverage, lint, typecheck, build, the callable contract and `driver-dossier.spec.cjs` passed; the PR starts with Кратко.

As done (2026-11-03, batch PR #557). Every file:line above was re-checked at `22f8e80`: none moved since `11626a6` except the brief's Uploads paragraph, now 224-231. Adapted:
- A change of `auth.currentUser` (another sign-in or a sign-out) empties the whole cache instead of each entry carrying its session, so one sign-in's links do not stay in memory once anyone asks again. A late failure from an earlier sign-in leaves the current link alone.
- `useAppFetch` now reaches the callable through `signedApplicationFileUrl`, so an answer without a link warns before the same fallbacks, where it used to fall back silently.
- Tests beyond the list: separate files keep separate links, the late failure above, and a press signing on every call after the dossier kept a link. `applicationFileLink.test.js` now uses `vi.resetAllMocks()` because it queues `*Once` values. `useAppFetch.team.test.jsx` keeps its mock without `auth`: it has no file paths and never signs. Before the fix the service tests failed (no such export) and the hook's reopen case failed (it signed again).
- The callable map also lists `applicationFileLink.js` under `getSignedPevUrl`, now literal there. `readFrontendCallables()` lists 116 names, as before. The brief's sentence was rewritten in place: still 1517 lines, 6 bytes shorter.
- Checks: `test:coverage` (7504 passed), lint, typecheck, build, bundle budget, the callable contract and the guards passed. `driver-dossier.spec.cjs` passed on `chromium` (10, the `@mobile` case skipped) and on `mobile-chrome` (1); its Firestore is unreachable, so the reuse is covered by the unit tests only.
- Open box: the PR text (Кратко) belongs to the batch PR's description. Every check in that box passed.
