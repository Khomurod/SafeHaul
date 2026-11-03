# M1c. Team settings: read every daily goal in one request, beside the roster

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #8 — Fix N+1 queries (one goals read per member); #16 — Run independent requests in parallel (the goals wait for the roster); #3 — Prevent duplicate API calls (the memberships are read twice; decided below to keep that).
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** Settings → Team reads each person's daily call and contact goals separately, and only after the team list has arrived. After this change one read of all the goals runs at the same time as the team list, so the page needs one round trip fewer and N−1 fewer requests.

## Current behaviour (verified at 11626a6)

- `src/features/settings/hooks/useTeamRoster.js:43-62`: `reload` awaits `listCompanyTeam` (47), then runs `fetchGoals` per member (49).
- `fetchGoals` (9-23) reads `companies/{id}/team/{uid}`. A missing document gives the defaults 150 / 50, `??` keeps a saved 0, and a failed read gives the defaults.
- Lines 64-82 open a `memberships` listener whose first answer is skipped (68-75). It is only the change signal; `listCompanyTeam` reads the same memberships on the server.
- Rules: `companies/{id}/team/{userId}` has `allow read: if isCompanyTeam(companyId)` (`src/firestore.rules:507-510`), which covers a list. A read with no filter and no order needs no composite index.
- Only `src/features/settings/components/team/DailyGoalsDialog.jsx:24` writes these documents (`setDoc`, merge). The server reads `role` from them (`functions/shared/companyAccess.js:70-71`). Nothing deletes one when a member leaves, so the collection can also hold former members' documents.
- Only admins load the roster (`src/features/settings/components/TeamManagementTab.jsx:25`).
- `src/features/settings/components/TeamManagementTab.test.jsx`: it mocks `getDoc` for goals (30-34) and pins stored goals, the defaults and a saved 0 (128-138). Its `collection` mock returns only the first path segment (12). It queues no `*Once` values and resets individual mocks in `beforeEach` (77-97).
- E2E `e2e/company-settings-team.spec.cjs` serves `listCompanyTeam`. Firestore is unreachable there, so the goals show the defaults; the roster already waits for the goal reads today. The visual baseline is `company-settings-team` (`e2e/visual/app.spec.cjs:113-119`).

## Scope

- In: replace the per-member `fetchGoals` with one read of `companies/{id}/team`, started together with `listCompanyTeam`; the tests.
- Out (do not do in this task):
  - The memberships listener. Keep it: an `onSnapshot` always delivers, and bills, a first answer. Switching the signal to the company document's `teamUpdatedAt` would make the screen depend on the trigger, to save a few document reads on an admin-only page.
  - `listCompanyTeam`, `DailyGoalsDialog` and the rules.

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md`, and the Vitest section of `.claude/rules/testing.md`.
- `docs/APP_BRIEF.md` §6 (team changes go through the server) and §13.
- `src/features/settings/components/TeamManagementTab.test.jsx`.

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «Вкладка Settings → Team будет читать дневные цели всех сотрудников одним запросом, одновременно со списком. Ничего на экране и в правах не меняется.»
2. Write the failing tests first, in `TeamManagementTab.test.jsx`:
   - Change the hoisted mock to `collection: vi.fn((_db, ...segs) => segs.join('/'))`. The existing assertion `toHaveBeenCalledWith(expect.anything(), 'memberships')` (119) still holds.
   - Add a hoisted `getDocs: vi.fn(async (path) => (path === 'companies/company-1/team' ? { docs: Object.entries(fs.goals).map(([id, g]) => ({ id, data: () => g })) } : { docs: [] }))` and wire it into the `firebase/firestore` mock. Reset it in `beforeEach` with `fs.getDocs.mockReset()`; in Vitest 5 that restores the `vi.fn(impl)` default. Give per-test behaviour with `mockImplementation`, not `*Once`; a `*Once` would oblige the file to switch to `vi.resetAllMocks()` (`src/tests/mockResetHygiene.test.js`).
   - Keep `getDoc` for now, so the old code still runs. Confirm that the new cases fail.
3. In `useTeamRoster.js`:
   - Replace `fetchGoals` with `goalsOf(data)`, which returns `{ callGoal: data?.callGoal ?? DEFAULT_GOALS.callGoal, contactGoal: data?.contactGoal ?? DEFAULT_GOALS.contactGoal }` and keeps the comment that 0 is a goal.
   - Add `async function fetchGoals(companyId)`, which returns `new Map(snapshot.docs.map((d) => [d.id, goalsOf(d.data())]))` from `getDocs(collection(db, 'companies', companyId, 'team'))`. On an error it calls `console.warn('Error fetching goals:', e)` and returns an empty `Map`, so it never rejects.
   - In `reload`: `const [{ data }, goals] = await Promise.all([httpsCallable(functions, 'listCompanyTeam')({ companyId }), fetchGoals(companyId)]);`, then `members.map((member) => ({ ...member, ...(goals.get(member.id) || DEFAULT_GOALS) }))`.
   - Keep the `latestRequest` and `alive` guards exactly as they are. Because `fetchGoals` never rejects, a failing callable still lands in the existing `catch` with `LOAD_ERROR`.
   - Imports (line 2): add `getDocs`, drop `doc, getDoc`.
   - Docblock (25-37): each member with their daily goals from `companies/{id}/team`, read in one request beside the roster.
4. Remove `getDoc` from the test's `firebase/firestore` mock, now that nothing uses it.
5. Pin the read in the rules suite, `src/tests/firestoreRules.surfaces.security.test.js:137-144`: add `await assertSucceeds(getDocs(collection(teamOf('company-a', 'company_admin'), 'companies', 'company-a', 'team')));` and `await assertFails(getDocs(collection(teamOf('company-b', 'company_admin'), 'companies', 'company-a', 'team')));`, and add `collection, getDocs` to its `firebase/firestore` import (line 14). The rules themselves do not change.
6. Open the PR with **Кратко**. Suggested text: «Вкладка Settings → Team загружается на один шаг быстрее: цели всех сотрудников читаются одним запросом вместе со списком. Проверено: юнит‑тесты, тест правил, браузерный тест вкладки Team. Риск очень низкий. От вас ничего не нужно.» In the PR, explain why the memberships listener stays.

## Tests

- `TeamManagementTab.test.jsx`:
  - Reads every member's goals in one request: `getDocs` is called once with `companies/company-1/team`, and no `companies/company-1/team/*` document is read on its own. Fails before.
  - Starts reading goals before the roster answers: with `listTeamFn` deferred, `getDocs` has already been called. Fails before. Resolve the deferred before the test ends.
  - Shows the defaults when the goals cannot be read: `getDocs` rejects, the rows read `Goals: 150 dials, 50 contacts`, and no error panel shows.
  - The existing cases at 128-138 (stored goals, defaults, a saved 0) and the membership-change reload (147-156) keep passing.
- `firestoreRules.surfaces.security.test.js`: an admin of company-a lists `companies/company-a/team`, and an admin of company-b is refused.

## Documentation to update in the same PR

- None. The brief does not describe how goals are read, and `docs/callable-frontend-map.md:50` (`listCompanyTeam` → `useTeamRoster.js`) stays true.

## Verify before opening the PR

- `npx vitest run src/features/settings/components/TeamManagementTab.test.jsx src/features/settings/components/CompanySettings.test.jsx src/tests/mockResetHygiene.test.js`, then `npm run test:coverage`.
- `npm run test:rules:emulators`. Plain `npm run test:rules` skips the Firestore suites without an emulator (`describeFirestore`, `src/tests/firestoreRules.support.js:24`), and a skip is not a pass. If the emulator cannot start, say so in the PR. Changing a `src/tests/firestoreRules.*` file makes CI run its rules lane (`scripts/ci-plan-rules.mjs:108-109`).
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget` and `npm run check:source-size`.
- Playwright: check that port 5000 is free, then run `npm run test:e2e -- --project=chromium e2e/company-settings-team.spec.cjs`.
- No pixel change is expected for `company-settings-team`, because the defaults show in E2E before and after.

## Verify after merge (on Testing, read-only)

- Confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner: open `https://truckerapp-system.web.app/company/settings?section=team`. Every row shows its goals as before. There is no need to change any.

## Risks and safeguards

- The collection may also hold documents of people who have left. They cost a few extra document reads and are ignored, because goals are matched by member id.
- If the goals read fails, the page shows the defaults, as it does today for a member whose read fails.
- Rollback: revert the PR.

## Done when (acceptance criteria)

- [ ] One `getDocs` of `companies/{id}/team` per load, started together with `listCompanyTeam`; no per-member `getDoc` remains.
- [ ] The defaults, the saved 0, the overlap guard and the error message are unchanged.
- [ ] The memberships listener is untouched, and the PR explains why.
- [ ] Unit tests, the rules suite on the emulator (or a stated reason it could not run), lint, typecheck, build and `company-settings-team.spec.cjs` passed; the PR starts with Кратко.
