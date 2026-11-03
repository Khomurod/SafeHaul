# M1b. Assign Leads and Import Leads: read the team in one request

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #8 — Fix N+1 queries (`LeadAssignmentModal` reads one profile per member, one after another); #3 — Prevent duplicate API calls (both screens re-read a team the app already keeps); #16 — Run independent requests in parallel (the serial awaits in the modal).
- **Size:** M · **Pull requests:** 1 · **Depends on:** M1a (merged, and the owner's answer on the refresh recorded) · **Owner decision needed:** none
- **Why it matters for users:** When an admin presses Assign on Company Leads, the window waits for one database trip per team member, one after another, before it shows the list. After this change it shows the list after a single read for every company whose saved team list (`teamMembers`) exists; a company without one still reads the memberships and one profile per member, but side by side instead of one after another. The change also fixes a real defect: with Round Robin, a team member whose profile has no `name` field makes the whole assignment fail with the message `Failed to assign leads.`

## Current behaviour (verified at 11626a6)

- `src/features/company-admin/components/LeadAssignmentModal.jsx:82-111`:
  - It queries `memberships` by `companyId` (85), then loops `for…of` with `await getDoc(users/{uid})` per member (89-96). That is serial, a true N+1.
  - Names come only from `users.name` (93). Members without a profile are left out (92). The list is sorted by name with `localeCompare` (99). Round Robin starts with everyone ticked (103).
- The Round Robin defect:
  - Round Robin writes `assignedToName: member.name` (149-151, 155-160). For a member with no `name`, that value is `undefined`.
  - The browser Firestore is initialised without `ignoreUndefinedProperties` (`src/lib/firebase/config.js:140-145`), so the batch refuses the undefined field and the user sees `Failed to assign leads.` (181-183). Manual mode already falls back to `"Unknown"` (144).
  - The same defect was fixed in the import hook (`useCompanyLeadUpload.js:12-21`), pinned by `useCompanyLeadUpload.teamNames.test.js:1-4, 48-63`.
- The modal's docblock lists the `memberships` query and the per-member `users/{userId}` read as frozen (18-20). That freeze came from the presentation-only design-system campaign. This task is a separately justified data-read change (`.claude/rules/ui.md` §5), so it updates the docblock.
- Only company admins (and super admins) open the modal: `src/features/company-admin/views/CompanyCandidatesListPage.jsx:23, 151, 269-276`. No unit test covers it.
- `src/features/company-admin/hooks/useCompanyLeadUpload.js:58-77` (Import Leads, an `adminOnly` page, `src/app/routes/companyRouteManifest.js:99-111`):
  - It reads `memberships`, then every member profile in parallel (68), keeps only existing profiles in the memberships' order (69-71), and ticks everyone (73).
  - Names come from the local `memberName` (17-21), which follows the same field order as `nameFromProfile`, then the email, then `'Unknown'`.
  - The contract suites pin the exact `{ id, name }` shape (`useCompanyLeadUpload.upload.test.js:62-71`), the parallel read (`useCompanyLeadUpload.lookups.test.js:174-190`) and the names (`useCompanyLeadUpload.teamNames.test.js:30-46`).
  - The harness header lists the team load from `memberships` + `users` as frozen (`useCompanyLeadUpload.contract.support.js:9-10`). Its defaults answer those reads (85-88, 94-109), and `makeMountHook` waits for two members (117-121). `useCompanyLeadUpload.repair.test.js` also answers `memberships` in its own `getDocs` doubles (35, 57, 103, 134).
- The rest of the app already takes the team from the cache through `useCompanyTeam` (`src/shared/hooks/useCompanyTeam.js:24-75`): `useCompanyDashboard.js:44` (the list's filter and assignee column), `useAppFetch.js:33` (the dossier's Assign To, which passes its own fresh company read from lines 51-56) and `AudienceBuilder.jsx:82`. For a company with no cache yet, it lists memberships, but only for admins (38-69).
- `currentCompanyProfile` is read once, when the user enters the company (`src/context/DataContext.jsx:40-79`, with a 60 s re-entry cache at 35-37). So a member added after entering would be missing from a team taken only from it; the dossier avoids that by passing a fresh read (`useCompanyTeam.js:20-22`).
- E2E: the mock company carries `teamMembers` (`DataContext.jsx:107`). Firestore points at a closed port (`src/lib/firebase/config.js:160-171`), and `e2e/driver-dossier.spec.cjs:222-226` notes that how a read fails there depends on the environment. No E2E opens the Assign Leads modal. `e2e/lead-intake.spec.cjs:164-176` checks the Distribute to Team panel with a `\d+ selected member` pattern.

## Scope

- In:
  - A new hook, `src/features/company-admin/hooks/useAssignableTeam.js`: one `getCompanyProfile(companyId)` when the screen opens, plus `useCompanyTeam(companyId, freshProfile)`.
  - `LeadAssignmentModal.jsx` and `useCompanyLeadUpload.js` switch to it.
  - The docblocks, the harness, the tests and one brief line.
- Out (do not do in this task):
  - `useCompanyTeam` itself, the list filter, the dossier picker and `AudienceBuilder`, which are already on the cache.
  - Pushing the fresh team into `DataContext`.
  - Any write behaviour: the `writeBatch` payload, `logActivity`, `onSuccess` before `onClose`, and every string.
  - Duplicate memberships (listed twice today and still listed twice after).
  - Referral Links counts (#8). `src/features/referrals/useReferralLinks.js:12, 43-44` with `referralLinksService.js:95-107` run 4 count queries per link (leads, applications, 2 hired statuses) for up to 50 links. They already run in parallel with equality filters only. A counter trigger would need a backfill, so leave this unless a customer reports the page as slow, and measure first.
  - `src/shared/components/modals/CompanyChooserModal.jsx:64` (one profile per company the user belongs to, usually 1–3).

## Read first

- `AGENTS.md` and `.claude/skills/implement/SKILL.md`.
- The Vitest section of `.claude/rules/testing.md`: `vi.resetAllMocks()` when a file queues `*Once` values; wait for the rendered consequence; the `findByText(name)` trap with people's names (wait for the member's own checkbox or option instead).
- `.claude/rules/ui.md` §5. This PR changes where a UI component gets its data, not how it looks: no components, tokens or strings change.
- `docs/APP_BRIEF.md` §4 Pipeline (assignment), §6 (memberships are readable only by admins; the whole team may read the company document), §8 Firestore triggers and §12 (an unassigned lead stores `assignedTo: ''`).
- `src/shared/hooks/useCompanyTeam.js` and `src/shared/hooks/useCompanyTeam.test.jsx:13-34`, which has the mocking pattern for `@/context/DataContext`.

## Implementation steps

1. Tell the owner, in Russian, in three lines at most. Suggested text: «Окно Assign Leads и выбор получателей при импорте будут загружать команду одним запросом (если у компании есть сохранённый список команды). Исправлю ошибку Round Robin для сотрудников без имени в профиле. Права, записи лидов и тексты не меняю.»
2. Write the failing tests first, in a new file `src/features/company-admin/components/LeadAssignmentModal.test.jsx`:
   - Mock `@/context/DataContext` so that `useData` returns `{ currentCompanyProfile: { id: 'co-1', teamMembers: [...] }, currentUserClaims: { roles: { 'co-1': 'company_admin' } } }`.
   - Mock `@features/companies/services/companyService` (`getCompanyProfile`), `@lib/firebase` (`{ db: {} }`), `@shared/utils/activityLogger`, and `firebase/firestore`, with `writeBatch` recording `update` payloads.
   - In the same `firebase/firestore` mock, answer `getDocs` for `memberships` and `getDoc` for `users/*`, so the file also runs against the old code. Give the old path a profile without `name` (only `email`), and the cache path the matching entry (`name: 'Unknown'` with that email).
   - The cases are listed under Tests. Confirm that the no-undefined `assignedToName` case and the no-memberships/users-reads case fail on the current code.
3. Create `src/features/company-admin/hooks/useAssignableTeam.js`:
   ```js
   import { useEffect, useMemo, useState } from 'react';
   import { getCompanyProfile } from '@features/companies/services/companyService';
   import { useCompanyTeam } from '@shared/hooks/useCompanyTeam';

   const NO_TEAM = Object.freeze([]);

   /** The team a bulk assignment offers: the company's team cache
    *  (companies/{id}.teamMembers, kept by functions/hrAdmin/membership.js),
    *  read fresh once when the screen opens so someone added since the company
    *  was entered is offered. One document read instead of the memberships and
    *  one profile per member, when the document carries the cache. If the read
    *  fails, the copy read on entering the company is used; with no cache in
    *  either, useCompanyTeam lists an admin's memberships (one profile read per
    *  member, in parallel). */
   export function useAssignableTeam(companyId) {
     const [fresh, setFresh] = useState({ companyId: null, profile: null });
     useEffect(() => {
       if (!companyId) return undefined;
       let cancelled = false;
       getCompanyProfile(companyId).then((profile) => { if (!cancelled) setFresh({ companyId, profile }); });
       return () => { cancelled = true; };
     }, [companyId]);
     const settled = Boolean(companyId) && fresh.companyId === companyId;
     // Until the read lands, an empty team of this company stands in, so
     // useCompanyTeam does not start its memberships fallback for nothing.
     const pending = useMemo(() => ({ id: companyId, teamMembers: NO_TEAM }), [companyId]);
     const { team, isLoading } = useCompanyTeam(companyId, settled ? fresh.profile : pending);
     if (!companyId) return { team: NO_TEAM, isLoading: false };
     return { team: settled ? team : NO_TEAM, isLoading: !settled || isLoading };
   }
   ```
   `getCompanyProfile` resolves `null` on any error and never rejects (`src/features/companies/services/companyService.js:18-31`). `useCompanyTeam(companyId, null)` then uses the copy from company entry, or, for an admin, the memberships when there is no cache. A fresh document without `teamMembers` takes precedence over the context copy (`useCompanyTeam.js:26`), so an admin gets the memberships fallback: one `memberships` query plus one `users/{uid}` read per member, in parallel (`useCompanyTeam.js:38-69`). The same happens when the read fails and the copy from company entry has no `teamMembers` either. So the one-read claim holds only where the cache exists (`functions/hrAdmin/membership.js:41-81` writes it on every membership change, so a company whose team has not changed since that trigger shipped has none); elsewhere the N reads remain, though no longer one after another, until the company's next team change writes the cache. Accepted: this task writes no cache itself; a one-time refresh of every company's list is M1a's owner decision.
4. In `LeadAssignmentModal.jsx`:
   - Line 2: add `useMemo` to the React import. Line 5: keep only `doc, writeBatch, serverTimestamp`. Add `import { useAssignableTeam } from '../hooks/useAssignableTeam';`.
   - Delete the `team` / `loadingTeam` state (59-60) and the `fetchTeam` effect (82-111).
   - Add `const { team: assignable, isLoading: loadingTeam } = useAssignableTeam(companyId);` and `const team = useMemo(() => [...assignable].sort((a, b) => (a.name || '').localeCompare(b.name || '')), [assignable]);`. This is the same comparator that keeps Round Robin from drifting.
   - Replace the select-all default (line 103) with a one-time seed: `const seeded = useRef(false);` and an effect on `[loadingTeam, team]` that, the first time `loadingTeam` is false, sets `seeded.current = true` and calls `setRrUserIds(team.map((m) => m.id))`.
   - Change the comment at 132 (`Pool is already sorted from useEffect`) to say it is sorted above. Leave the rest of `handleAssign` (113-188) and all JSX unchanged.
   - In the docblock (18-28), replace the memberships/users clause with: the team from `useAssignableTeam` (the company's team cache, read fresh when the modal opens). Add defect 11: Round Robin wrote an undefined `assignedToName` for a member whose profile had no `name`, and the batch failed.
5. In `useCompanyLeadUpload.js`:
   - Line 1: `import { useEffect, useMemo, useRef, useState } from 'react';`. Line 3: drop `query, where, getDoc` and keep `getDocs`, which `runDataRepair` uses (87). Add `import { useAssignableTeam } from './useAssignableTeam';`.
   - Delete `cleanText` and `memberName` (10-21), the `teamMembers` state (58) and the effect (61-77).
   - Add `const { team, isLoading: teamLoading } = useAssignableTeam(companyId);` and `const teamMembers = useMemo(() => team.map(({ id, name }) => ({ id, name })), [team]);`. The cache keeps the memberships' order, as before, and the shape stays exactly `{ id, name }`.
   - Seed `selectedUserIds` once per company: `const seededFor = useRef(null);` and an effect on `[companyId, teamLoading, teamMembers]` that returns early unless `companyId && !teamLoading && seededFor.current !== companyId`, then sets `seededFor.current = companyId` and calls `setSelectedUserIds(teamMembers.map((m) => m.id))`.
   - The returned object keeps every key.
6. Change the `useCompanyLeadUpload` contract harness and suites:
   - In `useCompanyLeadUpload.contract.support.js`, add a mutable `team` fixture: two artificial members, `{ id: 'artificial-user-a', name: 'Name artificial-user-a', email: '', role: 'recruiter' }` and the same for `artificial-user-b`, with `isLoading: false`, held in one array so it stays stable. The existing payload assertions then keep their names.
   - Add `export const assignableTeamMock = () => ({ useAssignableTeam: () => ({ team: team.members, isLoading: team.isLoading }) });`, and put the fixture's defaults back in `resetHarness`. Do not import anything new there (header lines 25-31).
   - Remove the `memberships` branch of `primeQueries` (97-98) and its `getDoc` profile default (101-108). Remove `MEMBERSHIPS` (85-88) once nothing uses it.
   - Rewrite header lines 9-10 to: the team from `useAssignableTeam` (its own test pins the read) and the select-all default.
   - In each suite (`upload`, `repair`, `lookups`, `reimport`, `teamNames`), add `vi.mock('./useAssignableTeam', async () => (await import('./useCompanyLeadUpload.contract.support')).assignableTeamMock());`.
   - `upload.test.js:62-71` becomes: lists the team `useAssignableTeam` gives, as `{ id, name }`, and preselects all. The exact shape is still asserted.
   - Delete the `lookups.test.js:174-190` block; the one-read case moves to the hook's own test. Then remove any imports it leaves unused (`renderHook`, `MEMBERSHIPS`).
   - In `repair.test.js`, remove the dead `memberships` branches (35, 57, 103, 134) and the `MEMBERSHIPS` import.
   - In `teamNames.test.js`, the per-field naming now belongs to M1a's trigger test and `useCompanyTeam.test.jsx`. Remove the `it.each` (30-46) and `profilesWith`, and update the header (1-5). Keep the Round Robin case: set `team.members` so that member a's name is an email, and assert defined `assignedTo` / `assignedToName` in every lead payload.
7. Write a new `src/features/company-admin/hooks/useAssignableTeam.test.jsx`, mocking the same way as `useCompanyTeam.test.jsx:13-34` plus `getCompanyProfile`.
8. Add the brief line (see Documentation).
9. Open the PR with **Кратко**. Suggested text: «Окна Assign Leads и Import Leads загружают команду одним чтением, а не по одному сотруднику, если у компании есть сохранённый список команды (иначе — по одному, но параллельно). Исправлена ошибка: Round Robin падал с «Failed to assign leads», если у сотрудника не было имени в профиле. Проверено: юнит‑тесты и браузерные тесты списка лидов и импорта. От вас ничего не нужно.» Under what it touches, write: no rules, indexes, callables or CSP. A membership whose profile cannot be read now appears as `Unknown` or by email, as it already does in the dossier's Assign To; before, these two screens left it out.

## Tests

- `src/features/company-admin/components/LeadAssignmentModal.test.jsx` (new):
  - In Round Robin, a member whose cache name resolves to their email gets that email in `assignedToName`, and no payload value is `undefined`. Fails before.
  - With `teamMembers` in the fresh document, opening calls `getCompanyProfile('co-1')` once and never queries `memberships` or reads `users/*`. Fails before.
  - Shows `Loading team...` and keeps Confirm disabled until the read settles.
  - Lists the fresh document's team, including a member missing from the copy in `useData`.
  - Round Robin starts with everyone ticked and distributes in name order. Manual mode writes the chosen member and keeps the `"Unknown"` fallback.
  - When the read gives `null`, the modal uses the `useData` copy.
  - Leaves `logActivity`, `onSuccess` and `onClose` in that order.
- `src/features/company-admin/hooks/useAssignableTeam.test.jsx` (new):
  - With `teamMembers` in the fresh document: one company read, no memberships or users reads, the cache's order kept.
  - `isLoading` stays true until the read settles.
  - Uses the context copy when the read gives `null`.
  - No `companyId` gives an empty team, not loading.
  - A fresh document without `teamMembers` lets an admin's memberships fallback run (one `memberships` query, then the profile reads), and so does a `null` read with no `teamMembers` in the context copy.
- The `useCompanyLeadUpload.*.test.js` suites, adjusted as in step 6, and `CompanyBulkUpload.*.test.jsx` (unchanged; they mock the hook) all pass.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md` §8 Firestore triggers: add one bullet of at most two lines: **Team cache** — a membership write rewrites `companies/{id}.teamMembers` (uid, role, name by `nameFromProfile` else `'Unknown'`, email); the team pickers and filters read it, and Assign Leads and Import Leads read it fresh when they open. The brief is already past its size warning, so make room by tightening wording elsewhere in §8 without removing any rule. `npm run check:agent-docs` must report no more lines for the brief than before (1514 at 11626a6).
- Roadmap and component docs: none, because nothing visible or interactive changes; say so in the PR. `OWNER_GUIDE.md`: none.

## Verify before opening the PR

- `npx vitest run src/features/company-admin/components/ src/features/company-admin/hooks/ src/features/company-admin/views/ src/shared/hooks/useCompanyTeam.test.jsx src/tests/mockResetHygiene.test.js`, then `npm run test:coverage` (what CI runs).
- `npm run lint:frontend`, `npm run typecheck`, `npm run build`, `npm run check:bundle-budget`, `npm run check:source-size`, `npm run check:agent-docs` and `npm run test:stories`.
- Playwright, one suite at a time. Check that port 5000 is free with `curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`, run `npm run test:e2e -- --project=chromium e2e/company-candidate-table.spec.cjs`, and after it finishes, `npm run test:e2e -- --project=chromium e2e/lead-intake.spec.cjs`.
- Do not add an E2E test that opens the modal and waits for the team: the outcome of the fresh read in E2E depends on the environment, so it would be flaky. The unit tests cover it.
- The pixel baselines `company-import-leads` and `company-import-preview` (`e2e/visual/app.spec.cjs:372-382`) show the Unassigned default, so no change is expected. If CI's visual lane differs, investigate; never update baselines from a local browser (`testing.md`, rule 6).

## Verify after merge (on Testing, read-only)

- Confirm that `https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner, on `https://truckerapp-system.web.app/company/drivers/leads/company`: tick one lead and press **Assign (1)**. The team appears with names. Press **Round Robin**: everyone is ticked. Then press **Cancel**, which writes nothing.
- Production changes only when the owner promotes. Repeat the same look after promotion.

## Risks and safeguards

- The fresh read may fail. The hook then uses the copy from company entry, which can miss someone added in this session, the same as every other team picker.
- A company with no team cache yet: the hook falls back, through `useCompanyTeam`, to the memberships and one profile read per member, in parallel. There the N reads remain until the company's next team change; only the one-after-another wait is gone. Say so in the PR instead of claiming one read everywhere.
- Names now come from the cache. A nameless member is shown and assigned by email instead of crashing Round Robin or showing a blank, and the sort stays deterministic.
- In a company whose cache has not been rewritten since M1a, a member whose profile keeps the name only as `fullName` or as first + last name appears in Import Leads by email until the next team change (today, by name). This follows from the owner's answer in M1a; say it in the PR.
- A membership whose profile is missing now appears instead of being left out. This matches the dossier picker and the list filter, and Settings → Team flags such members for removal. Noted in the PR.
- Rollback: revert the PR, and promote again if Production already has it.

## Done when (acceptance criteria)

- [ ] With the team cache present, opening Assign Leads or Import Leads reads one company document and nothing else; without it, the only extra reads are `useCompanyTeam`'s memberships fallback. Neither file contains a `memberships` query or a `users/*` read.
- [ ] Round Robin never writes an undefined `assignedToName`, pinned by a test that failed before.
- [ ] The modal's name sort and select-all default, the upload's `{ id, name }` shape and order, and every write payload are unchanged.
- [ ] The docblock and the harness header no longer describe the old read; the APP_BRIEF §8 line is added and `check:agent-docs` shows no growth in lines.
- [ ] Coverage, lint, typecheck, build, bundle budget, source size and both Playwright suites passed, each named in the PR; the PR starts with Кратко.
