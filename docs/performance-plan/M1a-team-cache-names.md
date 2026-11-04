# M1a. Name team members by the shared rule in the team cache, read in one request

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #8 — Fix N+1 queries (the membership trigger reads each member's profile separately). It is also the prerequisite for M1b (#3 duplicate calls, #8 N+1).
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** After M1a, each company's saved team list (`companies/{id}.teamMembers`) is rewritten with the new rule only at that company's next team change. Until then, a member whose profile keeps the name only as `fullName` or as first + last name is listed by email, and once M1b ships that includes Import Leads, which lists them by name today. Should every company's list be refreshed once, as a one-time write of that one field on each company document? Recommended: no. Staff added through Add person or Create user get `name` (`functions/hrAdmin/createUser.js:126`), and `listCompanyTeam` writes `name` back onto a profile without one, so such profiles should be rare; each list refreshes itself at the next team change. (RU: «Обновить сохранённые списки команды у всех компаний сразу или дождаться, пока каждый обновится сам при следующем изменении команды? Рекомендую дождаться.»)
- **Why it matters for users:** Each company keeps a saved team list that feeds the Assign To pickers, the Assigned to filter and Referral Links. Today it takes a person's name only from `name` or `displayName`, so someone whose profile keeps the name as `fullName` or as first and last name is shown by email. After this change the list names people by the same rule Settings → Team uses, so M1b can move Assign Leads and Import Leads onto this list without renaming anyone whose list has been refreshed.

## Current behaviour (verified at 11626a6)

- `functions/hrAdmin/membership.js:41-81` rewrites `companies/{cid}.teamMembers` on every `memberships/{id}` write:
  - It runs the company's memberships query (line 51), then one `users/{uid}` get per member, in parallel (53-69).
  - It builds each entry as `name: uData.name || uData.displayName || 'Unknown'` and `email: uData.email || ''` (62-63), then calls `update({ teamMembers, teamUpdatedAt })` (73-76).
  - A member whose read fails is written as `'Unknown'` (65-67). A failed company step is logged and skipped (78-80). The before and after companies are handled one after the other (49; at most two).
- The project's naming rule is `nameFromProfile` / `emailFromProfile` in `functions/shared/userIdentity.js:29-46`: `name`, then `fullName`, then `displayName`, then first + last, trimmed. `listCompanyTeam` uses it through `resolveUserIdentity` (`functions/hrAdmin/team.js:9, 131`); the campaign worker uses it directly (`functions/bulkActions/workers/batchWorker.js:9, 26`). The trigger does not.
- Readers treat `'Unknown'` as no name: `src/shared/hooks/useCompanyTeam.js:7` shows the email instead, and `src/features/referrals/ReferralLinksPage.jsx:15-18` falls back to the sign-in name. So `'Unknown'` and `''` must stay the none values. Nothing in `functions/` or `src/firestore.rules` reads `teamMembers`.
- No test pins the cache contents. Only `functions/test/unit/onMembershipWrite.companyIds.test.js` and `functions/test/unit/companyActivationClaims.test.js` run the trigger, and they assert only the claims and `companyIds`. Their `db` doubles have no `getAll`, and their `users` `doc()` double returns no `id` (`onMembershipWrite.companyIds.test.js:24-31`; `companyActivationClaims.test.js:128`, the fallback branch).
- The Admin SDK's `db.getAll(...refs)` fetches many documents in one request and refuses to be called with no reference. The repo already uses it in `functions/bulkActions/helpers/recentlyMessaged.js:67` and `functions/shared/publicProfileSync.js:115`. `functions/node_modules` is not installed in this checkout; after `npm ci`, confirm the zero-argument refusal in `functions/node_modules/@google-cloud/firestore` (`getAll`) or with Context7 (`/googleapis/nodejs-firestore`).

## Scope

- In:
  - The team-cache block of `onMembershipWrite`: names from `nameFromProfile`, emails from `emailFromProfile`, keeping `'Unknown'` and `''` as the none values.
  - The per-member profile reads become one `db.getAll` per company.
  - The tests below.
- Out (do not do in this task):
  - The claims and `users/{uid}.companyIds` sync (lines 19-39). They stay exactly as they are.
  - Any refresh of existing caches (owner decision above).
  - De-duplicating a user with two memberships in one company. They are listed twice today and still will be.
  - `listCompanyTeam`'s own per-member reads (`team.js:112-120`). They report a per-member `unreadable` status that one `getAll` cannot give.
  - Running the before and after companies in parallel (at most two, background work).
  - Any brief change (see Documentation).

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md`, and the Jest section of `.claude/rules/testing.md`: a file that queues any `*Once` value uses `jest.resetAllMocks()` and puts its defaults back after the reset; `functions/test/unit/mockResetHygiene.test.js` enforces it.
- `docs/APP_BRIEF.md` §6 (Team changes go through the server), §8 Firestore triggers, §9 (`users/{id}.companyIds` is load-bearing) and §13.
- `functions/shared/userIdentity.js` and `functions/test/unit/userIdentity.test.js`.

## Implementation steps

1. Tell the owner, in Russian, in three lines at most. Suggested text: «Сервер будет называть сотрудников в сохранённом списке команды так же, как вкладка Settings → Team. Права, роли и вход не меняю. Старые списки обновятся сами при следующем изменении команды.» Record their answer to the owner question in the PR.
2. If `functions/node_modules` is missing, run `npm ci` in `functions/`.
3. Write the failing tests first, in a new file `functions/test/unit/onMembershipWrite.teamMembers.test.js`:
   - Copy the `jest.mock` scaffolding from `onMembershipWrite.companyIds.test.js:1-60`.
   - Make the `users` `doc(uid)` double return `{ id: uid, set, get }`, where `get` is a recording spy that answers from a `profiles` fixture. The old code then still runs, so the naming cases fail for the right reason.
   - Add `getAll: (...refs) => mockGetAll(...refs)` to `db`. It answers each ref with `{ id: ref.id, exists, data: () => profile }` from the same fixture and records its calls.
   - Use `jest.resetAllMocks()` in `beforeEach` and restore every default after it, as the hygiene rule requires.
   - Run the file on the current code. Confirm that the `fullName` case, the first + last case and the one-request case fail.
4. In `functions/hrAdmin/membership.js`, add `const { nameFromProfile, emailFromProfile } = require("../shared/userIdentity");`.
5. Replace lines 53-71 with a helper in the same file, `async function teamOf(memberDocs)`:
   - `const memberships = memberDocs.map((d) => d.data() || {});`
   - `const uids = [...new Set(memberships.map((m) => m.userId).filter((id) => typeof id === 'string' && id))];`
   - `const snaps = uids.length ? await db.getAll(...uids.map((id) => db.collection('users').doc(id))) : [];` (`getAll` refuses zero references).
   - `const profiles = new Map(snaps.map((s) => [s.id, s.exists ? s.data() : null]));` It is keyed by id, so neither the order of the results nor duplicates matter.
   - Return `memberships.map((m) => { const p = profiles.get(m.userId) || null; return { userId: m.userId, role: m.role, name: nameFromProfile(p) || 'Unknown', email: emailFromProfile(p) || '' }; });`. This keeps the memberships' order and one entry per membership, as today. A membership without a usable `userId` gets today's entry (`'Unknown'`, `''`) and is not read.
   - In the loop, call `const resolvedTeam = await teamOf(teamSnap.docs);`.
6. Keep everything else in the block unchanged: the `teamSnap` query (51), the `update` payload with `teamUpdatedAt` (73-76), the log line (77) and the per-company `try/catch` (78-80). One case changes: when `getAll` fails, that company's rewrite is skipped and logged, where today the failed members are written as `'Unknown'` over a good list. Say so in the helper's comment, and say that the next membership write rewrites the list.
7. In `onMembershipWrite.companyIds.test.js` and `companyActivationClaims.test.js`, add `getAll: async (...refs) => refs.map((ref) => ({ id: ref.id, exists: false, data: () => undefined }))` to the `db` double. Make the `users` `doc` double carry its id: `doc: (uid) => ({ id: uid, ... })` in the first file, and `doc: (id) => ({ id, ... })` in the fallback branch of the second (line 128). Their runs then pass through the team step instead of logging a `TypeError`. Their assertions do not change.
8. Open the PR. The description starts with **Кратко**. Suggested text: «Сохранённый список команды теперь называет сотрудников так же, как Settings → Team (раньше часть людей показывалась по e‑mail), и читает профили одним запросом. Проверено: серверные тесты и линт. Риск низкий; это общий сервер Testing и Production, старые списки обновятся при следующем изменении команды. От вас нужен ответ: обновлять ли списки сразу (рекомендую нет).» Then follow `.github/pull_request_template.md`. Under what it touches, write: Cloud Function `onMembershipWrite`. What it writes to `companies/{id}.teamMembers` keeps the same fields and none values, with names filled in more often. No rules, indexes, callable contract or CSP change.

## Tests

- New `functions/test/unit/onMembershipWrite.teamMembers.test.js`:
  - Names a member from `fullName`, from `displayName`, and from first + last name, trimmed. Fails before for `fullName` and for first + last.
  - Writes `'Unknown'` and `''` when the profile is missing, or has no name and no email.
  - Reads every profile with one `db.getAll` and no per-user `get`. Fails before.
  - Keeps the memberships' order, one entry per membership, with `userId` and `role` as stored.
  - An empty team (a removed last membership) writes `teamMembers: []` and does not call `getAll`.
  - A membership without `userId` gives the `'Unknown'` entry and is not passed to `getAll`.
  - When `getAll` rejects, `companies/{id}` is not updated, the trigger resolves, and the claims and `companyIds` are still written. Fails before, because the old code never calls `getAll` and updates the company.
- `onMembershipWrite.companyIds.test.js`, `companyActivationClaims.test.js` and `userIdentity.test.js` keep passing, with their assertions unchanged.

## Documentation to update in the same PR

- None. The brief does not describe the team cache or its naming, so nothing in it becomes untrue. M1b adds one line when more screens depend on the cache. `docs/APP_BRIEF.md` is already past its size warning (`npm run check:agent-docs`: 1514 lines against 1500), so do not add to it here.
- `docs/OWNER_GUIDE.md` and `docs/RELEASE_CHECKLIST.md`: no change, because nothing they describe changes.

## Verify before opening the PR

- In `functions/`: `npm run lint`, then `npm test -- test/unit/onMembershipWrite.teamMembers.test.js test/unit/onMembershipWrite.companyIds.test.js test/unit/companyActivationClaims.test.js test/unit/userIdentity.test.js test/unit/mockResetHygiene.test.js`, then the full `npm test`.
- At the repository root: `npm run check:function-exports` and `npm run check:source-size`.
- No Playwright suite applies, because nothing in the browser changes. Say so in the PR.

## Verify after merge (on Testing, read-only)

- Watch the `main` run to completion and confirm that its Cloud Functions deploy step succeeded. If the run also deployed Testing, confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- There is nothing to click: the cache changes only at the next real team change. When the owner next adds or removes someone as part of normal work, they can open Company Leads, tick a lead, press Assign, look at the names and press Cancel, which writes nothing.

## Risks and safeguards

- The backend is shared with Production, so this is live for every company at merge. Safeguard: the fields and none values are unchanged, so every reader keeps working, and the new tests pin the shape.
- A transient `getAll` error skips one rewrite (logged) instead of writing `'Unknown'` over a good list. The next membership write repairs it.
- Until a company's list is rewritten, it still holds the old names (owner decision).
- Rollback: revert the PR. The next membership write then goes back to the old naming.

## Done when (acceptance criteria)

- [x] The trigger writes names with `nameFromProfile` and emails with `emailFromProfile`, and `'Unknown'` / `''` when there is none.
- [x] One `db.getAll` per company, none for an empty team, and no per-user `get`.
- [x] Entry order, fields and `teamUpdatedAt` are unchanged; lines 19-39 (claims and `companyIds`) have no diff.
- [x] The new test file fails on the old code and passes now; the full functions `npm test` and `npm run lint` pass.
- [ ] The PR starts with Кратко and records the owner's answer on the refresh.
- [ ] The `main` run's functions deploy succeeded.

As done (2026-11-04, batch C, on top of `62d76e1`). Every file:line in "Current behaviour" was re-checked: no commit since `11626a6` touched `membership.js`, `userIdentity.js`, `team.js`, `createUser.js`, the two trigger test files, `recentlyMessaged.js` or `publicProfileSync.js`; `useCompanyTeam.js` (M5) and `batchWorker.js` (T4.2) changed, but the cited lines stand. One reference was off from the start: the fallback `doc()` of `companyActivationClaims.test.js` is line 134, not 128. The installed `@google-cloud/firestore` 9.3.1 refuses `getAll()` with no reference ("requires at least 1 argument", tried offline). Р19 took its recommended answer, wait: no list is refreshed, and nothing was written to do it. Implemented as the steps say. Notes:
- **What else the shared rule changes**, both pinned by tests: an email is trimmed, and a name of only spaces falls through to the next field (it was written as is). The old per-member log line is gone; a failed `getAll` logs the existing "Failed to update team cache" line.
- **Tests:** 12 cases in the new file. 7 fail on the old code, each on its assertion: `fullName`, first + last trimmed, a name of only spaces, one `getAll` and no `get`, a membership without `userId` not read, a membership moved between companies (one `getAll` each), and a failed `getAll` that leaves the list alone. 5 pass before and after: `displayName`, `name` first, the none values, order and fields and `teamUpdatedAt` with the answers in another order, and an empty team without `getAll`. Two memberships of one user in one company are read once and listed twice. Without step 7's doubles the two older suites still passed but logged `TypeError: db.getAll is not a function` from the team step; with them it completes.
- **Not guarded:** a `userId` that is a string but not a document id (one `/`) makes `doc()` throw (tried offline), so that company's rewrite is skipped where the old code wrote `'Unknown'` for that one entry. Memberships are written by `createPortalUser` (an Auth uid from `getUserByEmail` or `createUser`) and by the Super Admin memberships manager (`addMembership`, the edited user's `users/{uid}` id, which cannot hold a `/`), so this was left as the steps say.
