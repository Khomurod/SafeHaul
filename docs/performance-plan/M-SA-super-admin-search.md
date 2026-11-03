# M-SA. Super Admin search: only the newest answer may show

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #3 — Prevent duplicate API calls (stale answers in the Super Admin search). The duplicate reads of every company across Super Admin views, and the other #3 and #8 leftovers listed under Out, were reviewed under the same items and are deliberately left as they are.
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** In the Super Admin console, changing or clearing the search text starts a new read. If an earlier, slower read answers last, the lists show results for text that is no longer in the box. The 600 ms typing pause makes this rare, but nothing prevents it. The recruiter lists already prevent it, and this applies the same guard.

## Current behaviour (verified at 11626a6)

- `src/features/super-admin/hooks/useSuperAdminData.js:366-423` (`performClientSearch`) sets the three lists after its `Promise.all` (396-415), and `loading` in `finally` (420-422), without checking that it is still the newest read.
- `loadRecentData` (74-243) does the same: after the `Promise.all` at 111-134, after `await withMemberships` (164), in `catch` (236-239) and in `finally` (240-242). Its E2E mock branch (78-90) is synchronous.
- The controller (425-444) waits 600 ms (442) and starts one of the two. A box with one non-space character starts neither (433-434). Nothing discards an older answer.
- `loadMore` (246-363) appends a page to `companyList` (274), `userList` (291, after `await withMemberships` at 290) or `allApplications` (348) and moves that list's cursor and `hasMore`, with no check either. `performClientSearch` replaces `companyList` and `userList` (402-403). Load More is not shown during a search (`ViewRouter.jsx:62-74` shows the search results instead), but a Load More pressed just before typing can answer after the search, and its page of recent records is then appended to the search results.
- Pattern to reuse: the version counters in `src/features/companies/hooks/useCompanyDashboard.js:54-58` (checked at 156) and `src/features/applications/hooks/useAppFetch.js:35-41`.
- Duplicate company reads: the first load reads a page of 20 and every company (105, 122-126), and `src/features/super-admin/components/CreateView.jsx:123-128`, `src/features/analytics/hooks/useAnalytics.js:79` and `src/features/super-admin/components/FeaturesOverview.jsx:48` each read every company when opened.
- Tests: `useSuperAdminData.counts.test.js` (harness 12-52, debounce 80-97; `vi.clearAllMocks()`, no `*Once`), plus `.loadMore`, `.pages` and `.e2e`. No test covers out-of-order answers. The file is 471 lines.

## Scope

- In: one read-version counter shared by `loadRecentData` and `performClientSearch`, which `loadMore` also checks before it appends; a new test file.
- Out (do not do in this task):
  - Folding the duplicate company reads into one cache. Each view needs current data: Features overview must show a flag right after a toggle, and Create must list a company created a minute ago. There is one Super Admin, and the reads scale with the number of companies (tens). A shared cache would add staleness for no visible gain. Revisit only if companies reach the hundreds and the console feels slow.
  - The per-company `stats_daily` queries in `useAnalytics.js:100-104`. They already run in parallel, in Super Admin only.
  - The recruiter search's five prefix queries (`src/features/companies/hooks/dashboardSearch.js:104-113`). Dropping the two legacy prefixes would need every old record to carry the normalized fields, which is a backfill.
  - A one-character box, which starts no read (unchanged), so the last read's answer stays.

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md`, and `.claude/rules/testing.md` (fake timers; settle every promise; reset rules).
- `docs/APP_BRIEF.md` §4 Super admin operations.
- `useSuperAdminData.counts.test.js`.

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «В поиске Super Admin всегда будут показываться результаты последнего введённого запроса, даже если старый ответ пришёл позже. Больше ничего не меняется.»
2. Write the failing tests first, in a new file `src/features/super-admin/hooks/useSuperAdminData.search.test.js`. Reuse the counts harness (12-52). Answer `getDocs` through deferred promises keyed by the search term the query carries (`companyName` and `name` as typed, `searchName` lowercased), answer queries without a term with recent data, and hold `startAfter` page reads on their own deferred. Use `mockImplementation`, not `*Once`, and resolve every deferred inside its test.
3. Add `const readVersion = useRef(0);` next to `loadMoreInFlight` (56).
4. In `loadRecentData`:
   - At the start, `const version = ++readVersion.current; const current = () => version === readVersion.current;`. The E2E mock branch (78-90) stays as it is.
   - After the `Promise.all` (134), before `setStatsError` (137): `if (!current()) return;`.
   - Split line 164 into `const users = await withMemberships(...); if (!current()) return; setUserList(users);`.
   - In `catch` (236), add `if (!current()) return;` before setting errors.
   - Make `finally` `if (current()) setLoading(false);`.
5. In `performClientSearch`, do the same: a new version at the start, a check after the `Promise.all` (400) before any set, one in `catch`, and `finally` setting `loading` only when current.
6. In `loadMore`, take the version without starting a new one, since a page adds to the lists and replaces nothing:
   - After the type checks (247-252): `if (loading) return;` (a read in flight is about to replace the lists and cursors this page would extend; add `loading` to the dependencies at 363), then `const version = readVersion.current; const current = () => version === readVersion.current;`.
   - `if (!current()) return;` after each await, before any set: after `getDocs` at 266 and 285, after `withMemberships` at 290, and after the `Promise.all` at 310. A dropped page changes no list, cursor, `hasMore` or company map.
   - In `catch` (355), show the toast only when current. `finally` (358-362) stays as it is, so the in-flight guard and `loadingMore` are always released.
7. The file stays under 500 lines (471 now).
8. Open the PR with **Кратко**. Suggested text: «Поиск в Super Admin показывает результаты именно последнего запроса: запоздавший старый ответ больше не подменяет список. Проверено: юнит‑тесты и браузерные тесты консоли. Риск очень низкий. От вас ничего не нужно.» State in the PR why the duplicate company reads stay.

## Tests

- `useSuperAdminData.search.test.js` (new):
  - Shows the newest search when an older one answers last: type `Ab`, wait 600 ms, type `Abc`, wait 600 ms, resolve `Abc`, then `Ab`. `companyList` holds `Abc`'s companies. Fails before.
  - Shows the recent data after the search is cleared, even when the search answers later. Fails before.
  - Stays loading until the newest read answers. Fails before, because the older read's `finally` clears `loading`.
  - Drops a Load More page that answers after a newer search: hold the `startAfter` read of `loadMore('companies')` open, type `Ab`, wait 600 ms, resolve `Ab`, then the page. `companyList` holds only `Ab`'s companies, and `loadingMore.companies` is false again. Fails before.
  - Load More does nothing while a read is loading: call `refreshData()`, then `loadMore('companies')` before it answers. No `startAfter` read is made. Fails before.
- The existing `.counts`, `.loadMore`, `.pages` and `.e2e` suites pass.

## Documentation to update in the same PR

- None. The brief does not describe this, and the owner pages are unaffected.

## Verify before opening the PR

- `npx vitest run src/features/super-admin/hooks/ src/tests/mockResetHygiene.test.js`, then `npm run test:coverage`.
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget` and `npm run check:source-size`.
- Playwright, one at a time, after checking that port 5000 is free: `npm run test:e2e -- --project=chromium e2e/super-admin-shell.spec.cjs`, then `npm run test:e2e -- --project=chromium e2e/super-admin-views.spec.cjs`.

## Verify after merge (on Testing, read-only)

- Confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner, on `https://truckerapp-system.web.app/super-admin`: type the first letters of a company name, change them quickly, then clear the box. Each time the lists match what is in the box. Nothing is written.

## Risks and safeguards

- A refresh after an edit (`refreshData`, which is `loadRecentData`) also starts a new version, so a search still in flight is dropped. That is correct, because the refresh is newer; it replaces the lists with recent data, as it does today.
- A Load More pressed while a refresh is loading does nothing; it works again once the list shows (during a search the button is not shown).
- Rollback: revert the PR.

## Done when (acceptance criteria)

- [ ] An older search or recent-data answer never overwrites a newer one, a Load More page is appended only to the lists it was read for, and `loading` follows the newest read.
- [ ] The duplicate company reads and the other Out items are left as they are, and the PR states why.
- [ ] The new tests fail on the old code; coverage, lint, typecheck, build and both super-admin Playwright suites passed; the PR starts with Кратко.
