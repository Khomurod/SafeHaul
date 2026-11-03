# T2d. Keep a recruiter's own reminders in the notification bell (optional)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #5 — Paginate API results (finding: the bell is capped before it is filtered by recipient)
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** "Do this optional fix now?" Recommended: **yes** — small, and it protects time-critical call-back reminders.
- **Why it matters for users:** The bell reads the company's newest 20 notifications and only then hides other recruiters' private call-back reminders. In a busy team, other people's reminders and new-application notices push a recruiter's own "Call back …" reminder out of the bell, and the bell can look nearly empty although the user has notifications. After this fix the bell always includes the user's own newest reminders.

## Current behaviour (verified at 11626a6)

- `src/features/company-admin/hooks/useCompanyNotifications.js:23-35`: one listener, `orderBy('createdAt','desc'), limit(20)` on `companies/{id}/notifications` (`:24-28`), then `.filter(item => !item.recipientId || item.recipientId === uid)` (`:31-34`) — so other people's private reminders take the 20 slots and are thrown away. Any listener error sets `'Failed to load notifications'` (`:38-42`).
- Private reminders: `functions/notificationTriggers.js:96-123` writes `recipientId` (the recruiter who logged a call with a callback time, `:112`); every notification is written by `functions/shared/createNotification.js:6-13` with `createdAt: new Date()`; team notifications have no `recipientId`, so "team only" cannot be queried (Firestore cannot match a missing field).
- Only consumer: `src/features/company-admin/components/NotificationDropdown.jsx:48` (in `CompanyTopbar.jsx:90`); `NotificationDropdown.test.jsx:15` mocks the hook; the hook's test `useCompanyNotifications.test.js` returns the same docs for any query (`:12-23`). No Playwright suite opens the bell.
- Rules: the team reads notifications (`src/firestore.rules:322-327`); no rules change needed.
- Index: none for `notifications` in `firestore.indexes.json`; `where('recipientId','==',uid)` with `orderBy('createdAt','desc')` needs a composite index. Changing the file makes CI run the full suite (`scripts/ci-plan-rules.mjs:80`).
- APP_BRIEF §8 "Notifications" (lines 1032-1034) describes the private reminder.

## Scope

- In: a second live listener for the user's own reminders, merged with the existing one; one composite index; an index test; unit tests; one APP_BRIEF sentence.
- Out (do not do in this task): marking team notifications on the server so they can be queried separately (needs a function change and old documents would stay unmarked — a separate task); paging or growing the bell list; any change to how notifications are written or marked read; rules.

## Read first

- `AGENTS.md`, `CLAUDE.md`, `.claude/skills/implement/SKILL.md`.
- `docs/APP_BRIEF.md` §8 "Firestore triggers" → Notifications (1032-1034), §10, §13.
- `.claude/rules/testing.md`.
- Index-test patterns: `functions/test/unit/companyApiIndexes.test.js`, `src/features/companies/hooks/dashboardQueries.test.js:14-35`.
- Library docs: `npx ctx7@latest library "Firebase JavaScript SDK" "onSnapshot query with where equality and orderBy on another field and limit"`, then `npx ctx7@latest docs <that id> "onSnapshot query with where equality and orderBy on another field and limit"`; if the quota is exhausted, say so and read `node_modules/@firebase/firestore/dist/index.d.ts`.

## Implementation steps

1. Test first, in `useCompanyNotifications.test.js`: give the mock `where: (...a) => ({ __where: a })` and `query: (...a) => ({ __query: a })`, and route `onSnapshot` by whether the query holds a `__where` (own) or not (team). Add "keeps the reader's own reminder when 20 newer notifications belong to others" — the team listener returns 20 reminders for `recruiter-2`, the own listener returns one for `recruiter-1`; expect it in `notifications` and in `unreadCount`. Fails before (one listener, filtered to nothing).
2. `useCompanyNotifications.js`: keep the team listener (`:24-28`) and its filter. Add, when `auth.currentUser?.uid` exists at subscribe time, `query(notificationsRef, where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(20))`. Keep each listener's latest rows in a ref; on either snapshot, merge by id, sort by `createdAt` newest first (accept Timestamp `toMillis()`, plain `seconds`, or `Date`), keep the first 20, `setNotifications`. `loading` turns false when the team listener answered and the own listener answered or failed (or at once without a uid). Errors: the team listener's error sets the existing `'Failed to load notifications'` as today; an own-listener error is `console.error`ed and leaves the team list showing, so a missing or still-building index never blanks the bell (the user just gets today's behaviour). Unsubscribe both on cleanup. `markAsRead` and `markAllAsRead` work on the merged list unchanged.
3. `firestore.indexes.json`: append `{"collectionGroup":"notifications","queryScope":"COLLECTION","fields":[{"fieldPath":"recipientId","order":"ASCENDING"},{"fieldPath":"createdAt","order":"DESCENDING"}]}`. It deploys to the shared project on merge (`.github/workflows/main.yml:1026-1027`); additive; the Production frontend does not run this query.
4. New `src/features/company-admin/hooks/notificationIndexes.test.js`: reads `firestore.indexes.json` (as `dashboardQueries.test.js` does) and asserts that index; with recording `where`/`orderBy` mocks, renders the hook and asserts the own query is exactly `where('recipientId', '==', <uid>)` with `orderBy('createdAt', 'desc')`, so a change to it must bring its index.
5. Update the hook's doc comment (`:5-10`): two reads, merged, newest 20; why the own read exists.
6. No CSP, rules or `firebase.json` change. Docs, self-review per `/implement` §5, full diff.
7. Suggested **Кратко** (name only the checks that actually ran): «Колокольчик уведомлений теперь всегда показывает ваши собственные напоминания „перезвонить“, даже если у коллег много своих. Проверено юнит-тестами; добавлен один индекс базы (только добавление). Риск низкий: пока индекс строится, колокольчик работает как раньше. От вас: после слияния открыть колокольчик на тестовом сайте и убедиться, что он открывается; не выпускать, пока индекс в консоли Firebase не станет Enabled».

## Tests

- `useCompanyNotifications.test.js`: the new "fails before" test; the existing "team and own, not someone else's" test (`:28-40`) stays green; NEW: two listeners subscribed and both unsubscribed on unmount; NEW: a document in both reads appears once; NEW: the merged list is cut to the newest 20; NEW: no own listener without a uid; NEW: an own-listener error keeps the team notifications and sets no `error`; NEW: a team-listener error still sets `'Failed to load notifications'`.
- `NotificationDropdown.test.jsx` mocks the hook; it must stay green unchanged.
- New `notificationIndexes.test.js` (step 4); also run the functions index suites (in `functions/`: `npm test -- Indexes`; Jest 30 dropped `--testPathPattern`), which read the same file.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md` §8 Notifications bullet (lines 1032-1034): add "The bell reads the team's newest 20 and the reader's own newest 20 reminders, and shows the newest 20 of both."
- Roadmap, OWNER_GUIDE, RELEASE_CHECKLIST: none (no UI or flow they describe changes).

## Verify before opening the PR

- `npm run lint:frontend`, `npm run typecheck`, `npm run test:coverage`, `npm run build` then `npm run check:bundle-budget`, `npm run check:source-size`.
- `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"` and, in `functions/` (`npm ci` first if `functions/node_modules` is missing), `npm test -- Indexes`.
- Playwright: no suite opens the bell; as a smoke check of the topbar that holds it, port 5000 free first, `npm run test:e2e -- --project=chromium e2e/company-shell-dashboard.spec.cjs`. Say in the PR that the bell itself is covered by unit tests only.
- Not run, with reason: `test:rules` (no rules change); the emulator does not enforce indexes, so the index test pins the file instead.

## Verify after merge (on Testing, read-only)

- `release.json` names the merge commit; the main run's "Deploy Firestore indexes" step succeeded.
- Owner: Firebase console → Firestore → Indexes: the `notifications` index (recipientId, createdAt) shows **Enabled** (look only).
- Owner: Testing → company workspace → open the bell: it opens and lists notifications, with no "Failed to load notifications". Do not log calls just to create a reminder on real records.

## Risks and safeguards

- Missing or still-building index → only the own-reminders read fails; it is logged and the bell shows the team list as today. Safeguards: index in the same PR, index test, promote only after Enabled.
- Team notifications can still be crowded out by other people's private reminders inside the team read; recorded as remaining (Out of scope) and named in the PR.
- Cost: one more small listener (at most 20 documents). CI runs the full suite because `firestore.indexes.json` changed.
- Rollback: revert the PR; leave the index.

## Done when (acceptance criteria)

- [ ] A user's own reminder stays in the bell when 20 newer notifications belong to others.
- [ ] Two listeners, merged without duplicates, newest 20, both unsubscribed on unmount; an own-listener failure leaves the team list showing.
- [ ] The `notifications (recipientId ASC, createdAt DESC)` index is in `firestore.indexes.json`, pinned by a test.
- [ ] Unit and functions-index suites pass and the topbar smoke suite passes; the "fails before" test was seen failing.
- [ ] APP_BRIEF §8 updated; Кратко first; "What it touches" names the index.
