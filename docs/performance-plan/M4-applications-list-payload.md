# M4. Download less per Applications list page (measure first, then decide)

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #24 — Select only the columns you need
- **Size:** M (S if the gate stays closed, L if it opens) · **Pull requests:** 2 to 6: M4-1 now; M4-2 records the measurement (plan file only); M4-3a, M4-3b and M4-3c only if the gate opens and the owner says yes; M4-4 is optional · **Depends on:** T1 for the gate (M4-2 onward). M4-1 depends on nothing. · **Owner decision needed:** after M4-2, and only if the gate opens: "A page of the Applications list downloads N KB and a name search M KB. Shall we add a server function that sends the list only the columns it shows? It changes no stored data, needs no migration and no new indexes. The first page after a long idle may take 1-3 s longer." Recommended answer: yes if a Next page is over 300 KB or a 3-letter search is over 1 MB; otherwise no.
- **Why it matters for users:** Each page of the Applications list downloads 20 complete applications, with every answer, the employer history and the drawn signature image, although the table shows eight short columns. On a slow phone connection that can mean seconds per page, and today a single typed letter in the search box downloads up to 150 complete applications. The first step, a two-letter minimum for name search, is cheap and safe; the bigger change is worth doing only if the measured download is large.

## Current behaviour (verified at 11626a6)

- Browse page: `src/features/companies/hooks/useCompanyDashboard.js:35` sets `ITEMS_PER_PAGE = 20`. `:231-240` runs `getDocs(query(..., limit(20)))` and spreads each `docSnap.data()` whole into a row. The Firestore web SDK (`firebase` 11.10.0) cannot pick fields; it always returns whole documents.
- What the table shows: `src/features/company-admin/views/candidateListColumns.jsx:127-239`: name (`fullName`/`firstName`/`lastName`, `:35`), phone, status (plus `statusEnteredAt` for the Stale badge, `:84-96`), freight (`driverType`, `:57-61`), state, Applied (`createdAt`, else `submittedAt`, `:41-54`), last call (`lastCallOutcome`, `:71`) and recruiter (`assignedTo`/`assignedToName`, `:78-81`).
- What an application document holds: `functions/shared/buildApplicationDoc.js:223-268`: the whole `formData` spread (`:224`), the drawn `signature` (`:234`, a PNG data URL from `src/shared/components/signature/SignaturePad.jsx:120-121`), the `employers`, `violations`, `accidents`, `schools` and `military` arrays (`:245-249`), and the search fields (`:260-267`).
- Name search: `src/features/companies/hooks/dashboardSearch.js:43-64` classifies any term that is not an email, phone, confirmation number or id as `name`, with no minimum length (`:63`). `:104-113` builds 5 prefix plans: 3 normalized and 2 legacy title-cased. `src/features/companies/hooks/dashboardQueries.js:208-216` sends each plan with `limit(SEARCH_PLAN_LIMIT)`, which is 30 (`dashboardSearch.js:33`), all in parallel (`dashboardQueries.js:220`). So one letter, after the 400 ms debounce (`useCompanyDashboard.js:77-82`), downloads up to 150 whole documents, then merges them to at most 50 (`dashboardSearch.js:34`, `:325-335`).
- Leads get no normalized search fields from any writer (`functions/maintenance/cleanup/searchFields.js:9-10`). The two legacy plans are therefore what finds a lead by name, and they must stay.
- The same search runs in the E-Docs template picker: `src/features/company-admin/hooks/pickerLeads.js:17-28`, loaded lazily (`useTemplateSendFlow.js:23-24`) and called from `useTemplateSendFlow.js:69-95`. An empty term reads the newest 20 leads (`pickerLeads.js:18-24`); any other term runs the 5 prefix queries on leads. The picker waits 300 ms only for a non-empty term (`useTemplateSendFlow.js:90`).
- These are the only callers of `classifySearchTerm`/`runDashboardSearch` in `src/` (grep). Super Admin's company search is a different code path and is not touched.
- Code that reads a list row beyond the table: `src/shared/hooks/useCallOutcome.js` reads `driverType`, `experienceLevel`/`experience`, `positionApplyingTo` (`:35-37`), `submittedAt` and `sourceType` to choose the collection (`:103`), `id` (`:106`), and `email`, `firstName`, `lastName` (`:208-216`); `src/shared/components/modals/CallOutcomeModalUI.jsx:144` reads `phone`. It copies `{...lead}` into a new document only when the record no longer exists (`useCallOutcome.js:149-157`). The dossier loads its own copy by id (`src/features/applications/hooks/useAppFetch.js:50-62`).
- Existing patterns for "the server returns trimmed rows": `listApplicationDrafts` (`functions/drafts/list.js:63-91`, guarded at `:69` by `assertCompanyAccessForRequest`, called from `src/features/company-admin/views/UnfinishedApplicationsPage.jsx:2, 6, 178`), the company API `listSubmissions` (`functions/companyApi/routes.js:120-152`), and Admin `select()` (`functions/bulkActions/controllers/session/gatherTargets.js:52, 84-85`).
- `assertCompanyAccess` (`functions/shared/companyAccess.js:48-94`) calls `admin.auth().getUser` and reads the company document on every call but a super admin's (`:57-58`, `:65-66` via `assertCompanyActive`); when the claims hold no team role for the company, it also reads the team document and runs a `memberships` query (`:70-78`). No Cloud Function sets `minInstances` (grep over `functions/`), so a new callable would have cold starts.
- The list chunk already imports `firebase/functions`: `CompanyCandidatesListPage.jsx:10` → `CallOutcomeModal.jsx:3` → `useCallOutcome.js:4`.
- Other heavy reads named under #24 belong to other checklist items, so this task does not fix them:
  - E-Docs keeps a live listener on every envelope with no limit (`src/features/signing/hooks/useSigningRequests.js:40-47`). This is checklist #5, pagination.
  - NotesTab reads the whole application a second time just for `sharedHistory` (`src/features/company-admin/components/tabs/NotesTab.jsx:83-84`), although the dossier already holds that record (`DossierContent.jsx:26`). No code in `src/` or `functions/` writes `sharedHistory` at this commit. This is checklist #3 (M4-4 below is a fallback).
  - Super Admin's `src/features/applications/services/applicationService.js:4-20` and the team-name reads at `src/shared/hooks/useCompanyTeam.js:51` and `src/features/company-admin/components/LeadAssignmentModal.jsx:91` belong to checklists #3 and #5.
- Nothing has measured the real transfer sizes. T1's harness measures signed-out pages only (agents may not sign in).

## Scope

- In:
  - M4-1: a two-letter minimum for name search, in the candidate lists (Applications, Company Leads, My Leads) and the template picker.
  - M4-2: the measurement, the decision, and recording both.
  - M4-3a, M4-3b and M4-3c, only if the gate opens and the owner says yes: a staff callable that returns only the list fields (Admin `select()`) for the Applications tab's browse pages and name search.
  - M4-4, optional: NotesTab reuses the record the dossier already loaded, unless checklist #3's task has done it.
- Out (do not do in this task):
  - Lead lists. Lead documents are light, and the lists keep reading Firestore directly.
  - E-Docs pagination (#5), Super Admin reads (#5) and the team-name reads (#3).
  - Removing the legacy search plans, which leads depend on.
  - Changing the page size (20), the per-plan limit (30) or the debounces (400 ms list, 300 ms picker).
  - Changing the signature's format or resolution.
  - Any data migration or backfill.
  - Any change to Firestore rules or indexes; the recommended design needs neither.
  - `minInstances` or any other billing change.
  - A hint line under the search box, which would need a change to the `ListToolbar` API.

## Read first

- `AGENTS.md` §1-§5, `CLAUDE.md`, `.claude/skills/implement/SKILL.md`.
- `docs/APP_BRIEF.md`:
  - §4 "Pipeline, documents and operations" (lines 271-283)
  - §6 Permissions (from line 862)
  - §8 "Firestore triggers" (1019-1043), which explains why this plan adds no trigger
  - §9 ripples (from 1066)
  - §10 (from 1123)
  - §12 current limitations (1294-1305)
  - §13 testing (from 1403)
- `.claude/rules/testing.md`, for the mock-reset rules and one Playwright suite at a time.
- `.claude/rules/ui.md`. The changes are `.js`/`.jsx` under `src/` with no visual change, but its guards still apply.
- `src/features/companies/hooks/dashboardQueries.test.js:378-411`, the query-limit and index model tests.
- For M4-3a: `functions/drafts/list.js`, `functions/shared/companyAccess.js:40-163`, `docs/callable-frontend-map.md`, `scripts/retire-functions.mjs:1-40`, and `.claude/rules/release-pipeline.md` "How a release flows". A new function deploys to the shared backend at merge.

## Implementation steps

*PR M4-1: name search starts at two letters (no gate; do it first)*
1. Write the failing tests listed under **Tests** for M4-1 first.
2. `src/features/companies/hooks/dashboardSearch.js`:
   - After `SEARCH_RESULT_LIMIT` (line 34), add `export const MIN_NAME_SEARCH_LENGTH = 2;`.
   - After `classifySearchTerm` (after line 64), add a pure `export function searchableTerm(rawTerm)`. It returns `''` when `classifySearchTerm(rawTerm)` is `null`, or is `type: 'name'` with `value.length < MIN_NAME_SEARCH_LENGTH`. Otherwise it returns `String(rawTerm)` unchanged.
   - Email, phone, confirmation number and application id terms are never cut by it.
   - Give it a JSDoc comment that says why: one letter means 5 prefix queries of up to 30 whole documents each.
3. `src/features/companies/hooks/useCompanyDashboard.js:77-82`: in the debounce, call `setDebouncedSearch(searchableTerm(searchQuery))`, and add `searchableTerm` to the import block at lines 14-21.
   - Result: one letter keeps the list in browse mode, with the same rows, counts and pagination as an empty box, and sends no new query (the debounced value stays `''`). The box still shows the letter; deleting back to one letter restores the full list.
   - Nothing else in the hook changes, because `debouncedSearch` already decides search mode everywhere (`:117, 188, 279, 292, 296, 308, 329`), the E2E fixture path included (`:190-204`).
4. `src/features/company-admin/hooks/pickerLeads.js`:
   - Change the empty-term check at line 18 to `if (!searchableTerm(term))`, so one letter shows the newest 20.
   - In `matchPickerLeads` (`:31-33`), classify `searchableTerm(term)`, so the browser-test fixture path behaves the same.
   - Add `searchableTerm` to the import at `:13`.
   - Do not import `dashboardSearch` into `useTemplateSendFlow.js`: its comment at `:23-24` keeps the list's search code out of the Documents chunk. The picker therefore still waits 300 ms after a first letter and re-reads the newest 20 leads (accepted; see Risks).
5. `docs/APP_BRIEF.md` §4, Recruiter pipeline paragraph (lines 273-283): add one sentence: search finds a name from its start, two letters at least, or an exact email, phone, confirmation number or application id; the template picker uses the same rules.
6. PR description. Suggested Кратко: «Поиск по имени в Applications, Leads и в выборе водителя для документа начинается с двух букв: одна буква больше не скачивает до 150 анкет. Поиск по телефону, email и номеру подтверждения не изменился. Проверено: unit-тесты и браузерные тесты поиска. От вас ничего не нужно.»

*PR M4-2: measure and decide (no application code)*

7. If T1 recorded the transferred KB for these four cases, use them: (a) the Applications first page, (b) Next page, (c) a 3-letter name search, (d) opening E-Docs. Otherwise ask the owner (agents may not sign in) to send these steps in Russian, for a company with at least 40 applications, on Testing, in desktop Chrome:
   > Откройте truckerapp-system.web.app в Chrome на компьютере и войдите как сотрудник компании, у которой больше 40 анкет. Откройте Applications. Нажмите F12 → вкладка Network → поставьте галочку Disable cache → фильтр Fetch/XHR.
   > 1) Нажмите 🚫 (Clear), обновите страницу (F5), дождитесь списка, подождите 10 секунд и перепишите число «… kB transferred» внизу панели.
   > 2) 🚫, нажмите Next под списком, подождите 10 секунд, перепишите число.
   > 3) 🚫, введите в поиск три первые буквы любой фамилии из списка, подождите 10 секунд, перепишите число.
   > 4) 🚫, откройте E-Docs, дождитесь списка документов, подождите 10 секунд, перепишите число.
   > Пришлите четыре числа и примерное число анкет в компании. Ничего не нажимайте, кроме перечисленного.
   - Agent's sanity check: Firestore answers arrive on long-lived `…/Listen/channel` requests. If (b) is under 20 KB (under 1 KB per application, implausible with a signature image), ask the owner to repeat step 2 and wait 30 seconds before reading the number.
8. Apply the decision rule, and record the numbers, the date, the company size and the verdict in the plan's progress section. If the gate closes, this is a plan-file-only PR. If it opens, also copy them into the M4-3a PR description.
   - **Gate OPEN** if (b) is over 300 KB, or (c) is over 1 MB. Ask the owner the decision question. On yes, do M4-3a, M4-3b and M4-3c.
   - **Gate CLOSED** otherwise. M4 is done after M4-1 (and M4-4 if it applies). Build nothing else.
   - If (d) is over 1 MB, give the number to checklist #5's E-Docs pagination task; do not fix it here.
   - Why 300 KB: Lighthouse's mobile throttling is about 1.6 Mbit/s, roughly 200 KB/s, so 300 KB is about 1.5 s per page. Below that, the gain does not justify new server code. (b) is the gate rather than (a), because (a) also carries the app's start-up requests.

Design choice if the gate opens. The browser SDK cannot pick fields, so these are the honest options:

| | A. Summary document per application, kept by a trigger | B. Move large fields into subcollections or Storage | **C. Callable that returns only list fields (recommended)** |
|---|---|---|---|
| Stored data | A second copy forever; needs a backfill of every existing application (owner approval; Testing and Production share data) | Migrates real data; every reader changes (dossier, PDF, PEV, company API, frozen record, AI) | None changed |
| Production (older frontend) | Unaffected | **Breaks** until promoted, unless both places are written for a whole release | Unaffected |
| Rules / indexes | +4 lines in `src/firestore.rules` (679 of 700 lines) and +16 composite indexes (copies of the 16 `applications` ones in `firestore.indexes.json`), built on live data at merge | Rules for the new paths | None: the same queries on the same collection use the same indexes |
| Running cost | One extra write per application change, plus the backfill writes | Migration writes, then none | One function invocation per page or search, plus the access check: one Auth lookup and one company-document read when the caller's custom claims hold a team role for the company (`companyAccess.js:57-58, 65-66, 35-36`); without one, the Auth lookup plus a team-document read, a one-row `memberships` query and a company-document read (`:70-78`); a super admin, the Auth lookup only (`:64`) |
| Consistency | Trigger lag: after a call outcome, `refreshData` can show the old status for 1-3 s | Two places to keep in step | Reads the source of truth |
| Latency | None added | None added | One more network hop plus the access check; a cold start of 1-3 s after idle (no `minInstances`) |
| Logic duplication | None | None | None if the browser plans the query and the server only validates and runs it (M4-3b) |
| Rollback | Revert the frontend; summaries and trigger linger until retired | Hard | Revert the frontend; the callable stays deployed and unused |

Recommend C. It is the only option with no data change, no migration, no rules or index change and no effect on Production. Its costs (a cold start, an access check per call) are measured after merge and fully revertible. Reject B outright. Keep A only as the fallback if C's latency proves unacceptable, and then only with an owner-approved backfill.

*PR M4-3a: the callable, backend only (gate open and owner yes)*

9. New file `functions/applicationRows.js`, modelled on `functions/drafts/list.js:63-91`: `exports.listApplicationRows = onCallV2({ cors: true }, async (request) => …)`, importing `onCall`/`HttpsError` from `firebase-functions/v2/https` as `list.js:12` does.
   - Validate `companyId` with `docId` (`functions/drafts/identity.js:40`, as at `list.js:64`), then call `await assertCompanyAccessForRequest(request, companyId, 'listApplicationRows')`.
   - Input `queries`: 1 to 5 descriptors of the form `{ filters: [[field, op, value], …], order?: 'asc'|'desc', day?: { start, end } (ISO), afterId?: string, limit }`. Refuse anything else with `invalid-argument`.
   - Allowed filter fields:
     - `assignedTo`, `status`, `state` and `driverType`.
     - The 13 search fields from `buildSearchPlans` (`dashboardSearch.js:72-114`): `emailNormalized`, `email`, `phoneNormalized`, `phone`, `confirmationNumberNormalized`, `confirmationNumber`, `applicationIdNormalized`, `applicationId`, `firstNameNormalized`, `lastNameNormalized`, `fullNameNormalized`, `lastName` and `firstName`.
     - `__name__`, with `==` only, run as `FieldPath.documentId()`.
   - Allowed operators and bounds: `==`, `in` (at most 30 string values), or exactly one `>=`/`<=` pair on a single name field; `limit` 1-30; `order` applies to `createdAt` only; `day` only with `order`.
   - Run the query on `db.collection('companies').doc(companyId).collection('applications')`.
   - Cursors, in this order: `day` sets the same cursors as `buildDashboardConstraints` (`dashboardQueries.js:115-125`): asc `startAt(start).endBefore(end)`, desc `startAfter(end).endAt(start)`, with `Timestamp.fromDate`. Then `afterId`: read `col.doc(afterId).get()` and apply `startAfter(snapshot)`, which replaces the day's start cursor and keeps its end cursor, as the browser's `startAfter(lastDoc)` does (`dashboardQueries.js:120-121`, `useCompanyDashboard.js:221-229`). If the document is gone, return `{ restart: true }` for that query so the client goes back to page 1, as `:225-227` does today.
   - Then `.select(...ROW_FIELDS).limit(limit).get()`. `ROW_FIELDS` = `firstName, lastName, fullName, email, phone, phoneNumber, status, statusEnteredAt, driverType, state, createdAt, submittedAt, lastContactedAt, lastCall, lastCallOutcome, assignedTo, assignedToName, confirmationNumber, applicationId, sourceType, experienceLevel, experience, positionApplyingTo`: every field the columns, the search verifier and filters (`dashboardSearch.js:121-153, 259-322`), `useCallOutcome.js` and `CallOutcomeModalUI.jsx` read.
   - Each row is `{ id, ...fields }`. Convert every Admin `Timestamp` value explicitly to `{ seconds, nanoseconds }` (do not rely on the callable encoder for that shape). That plain form is what `dashboardSearch.js:231-239` and `candidateListColumns.jsx:44-54, 84-96` already accept.
   - Return `{ results: [{ rows, lastId } | { restart: true }] }`. On an unexpected error, throw `HttpsError('internal', 'The list could not be loaded.')` and log a line with no personal data, as `list.js:87-89` does.
   - The header comment must say:
     - It returns only what `isCompanyTeam` already lets a member read directly (`src/firestore.rules:398-399`). The allowlist bounds cost, not confidentiality.
     - `assertCompanyAccess` (`companyAccess.js:48-94`) also accepts team and membership documents and refuses a deactivated company.
10. `functions/index.js`: after line 107, add `if (wanted('listApplicationRows')) exports.listApplicationRows = require('./applicationRows').listApplicationRows;`.
11. `docs/callable-frontend-map.md`: add a row to the table at lines 209-218, caller "none yet (M4-3c)".
12. No change to rules, indexes or CSP. Admin queries use the same composite indexes as today's browser queries on the same collection; `select()` needs none. `https://us-central1-truckerapp-system.cloudfunctions.net` is already in `connect-src` (`firebase.json`, pinned by `src/tests/hostingConfig.test.js`).

*PR M4-3b: one query planner for both paths (frontend refactor, no behaviour change)*

13. `src/features/companies/hooks/dashboardQueries.js:86-128`: extract a pure `planDashboardQuery({ activeTab, pipelineSegment, filters, dateOrder, ordered })`. It returns the descriptor (`{ filters, order, day }`), or `null` for two assignees, as today. `buildDashboardConstraints` becomes a thin adapter from the descriptor to SDK constraints, keeping `ordered: false` for the counts (`useCompanyDashboard.js:146-148`). All of `dashboardQueries.test.js`, including the index model at 378-411, must pass unchanged; that is the proof.

*PR M4-3c: the Applications tab reads rows through the callable*

14. New file `src/features/companies/hooks/applicationRowsService.js`. It wraps `httpsCallable(functions, 'listApplicationRows')` (the literal form `scripts/check-callable-contract.mjs:38` detects), as `UnfinishedApplicationsPage.jsx:2, 6, 178` does, and turns the results into `{ id, companyId, ...row }`.
15. `useCompanyDashboard.js` `fetchData` (`:206-246`): when `activeTab === 'applications'` and not in E2E mode, send `planDashboardQuery(...)` with `limit: ITEMS_PER_PAGE` and `afterId`. For this tab, keep the last row id (a string) in `lastVisibleDocsRef`. Lead tabs keep `getDocs`. Counts (`:116-167`) stay on `getCountFromServer`, which downloads no documents.
16. `runDashboardSearch` (`dashboardQueries.js:185-228`): for `applications`, send all the plans in one callable call. `docId` becomes `['__name__','==',v]` with `limit: 1`, and `prefix` becomes the `>=`/`<=` pair with `PREFIX_END`. Merge, verify and filter stay in the browser exactly as now (`:225-227`). Leads and `pickerLeads.js` keep SDK reads.
17. Leave the E2E fixture branches (`useCompanyDashboard.js:125-131, 190-204`) untouched. Vitest (mocked `httpsCallable`) and Jest cover the callable path, as `unfinishedApplicationsMock.js` does for `listApplicationDrafts`. Run `npm run check:bundle-budget`; no new chunk is expected, because the list's import graph already holds `firebase/functions` (`useCallOutcome.js:4`).

*PR M4-4 (optional): the Notes tab reuses the dossier's record. Skip it if the progress table shows checklist #3 did it.*

18. Failing test first in `src/features/company-admin/components/tabs/DossierBodies.notes.test.jsx`:
    - Rewrite "reads the notes, the shared history and the writer's name side by side" (`:92-103`): the tab gets `sharedHistory` as a prop, and `fs.getDoc` is never called. It fails before, because the tab calls `getDoc` (`:97`).
    - In the two shared-history cases (`:61-86`), pass `sharedHistory` as a prop instead of mocking `fs.getDoc`.
    - Do the same in `DossierBodies.a11y.test.jsx:74-83`.
19. `NotesTab.jsx`:
    - Add the prop `sharedHistory = []` to the signature at `:52`.
    - Remove the parent `getDoc` (`:83-84`; `getDocs(q)` stays) and read the prop at `:94-95`.
    - Update the frozen-contract header (`:18-21`): the shared history now comes from the dossier's record.
20. `src/features/company-admin/components/modals/driver-dossier/DossierContent.jsx:94-98`: pass `sharedHistory={appData?.sharedHistory}`, and update the frozen-props comment (`:16-18`).

## Tests

- M4-1, `src/features/companies/hooks/dashboardSearch.test.js`: a new `describe('searchableTerm')`. `''`, `'a'`, `' a '` and `'1'` give `''`. `'ab'`, `'Ли'`, `'a@x'` (an email), `'(312) 555-0188'` and `'saf-2026-mar1a'` come back unchanged. It fails before the change, because the export is missing.
- M4-1, new `src/features/companies/hooks/useCompanyDashboard.search.test.jsx`:
  - Copy the mocks of `useCompanyDashboard.reads.test.jsx:11-44`, but make `getDocs` record `q.constraints` as well as the path (the original records the path only).
  - Wait for the first browse read, clear the record, `act(() => result.current.setSearchQuery('m'))`, wait 450 ms: no new `getDocs` call at all. This case fails before the change (5 prefix reads go out).
  - Then `setSearchQuery('ma')`: 5 reads go out, each with a `where(…, '>=', …)`; the values include `'ma'` on `firstNameNormalized` and `'Ma'` on `lastName`.
- M4-1, `src/features/company-admin/hooks/useTemplateSendFlow.leads.test.jsx`: a new case. After the picker opens and settles, `setSearchQuery('d')` leads only to reads whose clauses are `[{ orderBy: ['createdAt','desc'] }, { limit: 20 }]`. It fails before the change.
- M4-1, `e2e/applications-search-filters.spec.cjs`: a new test, "a one-letter name search keeps the whole list", using the spec's own `openApplications`, `searchFor` and `listCount` (`:13-30`).
  - `searchFor(page, 'ro')`: Rosa Rejectova and Aisha Robinson are visible, and James McDonald has count 0.
  - Then `searchFor(page, 'r')`: James McDonald is visible, and so is `listCount(page, 8)`.
  - It fails before the change, because with `'r'` the list stays narrowed to the two.
- M4-3a, new `functions/test/unit/applicationRows.test.js` (Jest; if any `*Once` is queued, use `jest.resetAllMocks()` and restore defaults in `beforeEach`, per `.claude/rules/testing.md`). It asserts:
  - Access: a call with no auth is refused, and a non-member gets permission-denied.
  - Refusals: an unknown field, `!=`, 31 `in` values, prefixes on two fields, `limit: 31`, and `order` on another field.
  - Query building: a browse descriptor applies where, orderBy, the day cursors, `select(...ROW_FIELDS)` and limit; with `afterId`, `startAfter(snapshot)` is applied after the day cursors and the end cursor is kept; a missing `afterId` document gives `{ restart: true }`.
  - Output: Timestamps come back as `{seconds, nanoseconds}`, and rows carry only `id` plus `ROW_FIELDS` (never `signature` or `employers`).
- M4-3b: the existing `dashboardQueries.test.js` passes unchanged. Add cases where `planDashboardQuery` matches the constraints for every tab × segment × filter combination.
- M4-3c: a new `src/features/companies/hooks/useCompanyDashboard.rows.test.jsx`.
  - Paging: the Applications tab calls the callable with the plan, and on page 2 with `afterId`; `restart` goes back to page 1.
  - Leads and counts: the lead tabs never call it, and counts still use `getCountFromServer`.
  - Search: in `dashboardQueries.test.js`, an Applications search sends one call with the 5 plans and keeps merge and verify.
  - Field coverage: a static test asserts that `ROW_FIELDS` includes every field read by `candidateListColumns.jsx`, by `recordMatchesSearch`/`applyClientSideFilters`/`sortByAddedDate`, by `useCallOutcome.js` and by `CallOutcomeModalUI.jsx`.
- M4-4: the rewritten `DossierBodies.notes.test.jsx` and `DossierBodies.a11y.test.jsx`; `DossierContent.lazyTabs.test.jsx` stays green.

## Documentation to update in the same PR

- M4-1: `docs/APP_BRIEF.md` §4, one sentence. `docs/OWNER_GUIDE.md` and `docs/RELEASE_CHECKLIST.md` do not describe search, so they do not change.
- M4-2: the plan's progress section only.
- M4-3a: `docs/callable-frontend-map.md`, and one line in APP_BRIEF §6: a staff callable, company-guarded, row fields only.
- M4-3c: the caller in the callable map. In APP_BRIEF:
  - §9: adding a list column means adding its field to `ROW_FIELDS`.
  - §12: lead lists still download whole documents.
  - `docs/RELEASE_CHECKLIST.md` §2 (lines 31-41): add, in Russian, «нажмите Next один раз и найдите водителя по трём буквам фамилии».
- M4-4: none beyond the frozen-contract comments in code.

## Verify before opening the PR

- Every PR runs:
  - `npm run lint:frontend`
  - `npx vitest run <changed folders>`, then `npm run test:coverage`
  - `npm run build`, then `npm run check:bundle-budget`
  - `npm run check:source-size`
  - `npm run test:stories` (the `ui.md` guard; no component, token or table change, so no visual or table-layout lane, and say so)
- M4-1 Playwright, one suite at a time, after checking that port 5000 is free (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5000`):
  - `npm run test:e2e -- --project=chromium e2e/applications-search-filters.spec.cjs`
  - then `npm run test:e2e -- --project=chromium e2e/edoc-send-template-wizard.spec.cjs`
  - then `npm run test:e2e -- --project=chromium e2e/company-candidate-table.spec.cjs`
- M4-3a: in `functions/`, `npm run lint` and `npm test`. At the root, `npm run check:function-exports` and `node scripts/check-callable-contract.mjs`.
- M4-3b and M4-3c: Playwright `applications-search-filters.spec.cjs`, `company-candidate-table.spec.cjs`, `driver-dossier.spec.cjs` and `list-page-tablet.spec.cjs`, one at a time with `--project=chromium`. M4-3c also runs `node scripts/check-callable-contract.mjs`.
- M4-4: Playwright `e2e/driver-dossier.spec.cjs` with `--project=chromium`.

## Verify after merge (on Testing, read-only)

- M4-1, for the owner, in Russian:
  - Applications: type one letter, and the list does not change; type a second letter, and the list narrows.
  - E-Docs → send a template → the driver picker: one letter leaves the newest leads. Send nothing.
- M4-3a: on the `main` run, the Cloud Functions deploy job deployed `listApplicationRows`, and `verify-shipped` is green. Nothing calls it yet.
- M4-3c, for the owner:
  - Applications loads; Next and Prev work; try a segment and Only mine, and a 3-letter search.
  - Open a dossier. Press a phone number to open the call log, then close it without saving.
  - Repeat the M4-2 DevTools steps 1-3. Expect a Next page under 50 KB.
  - Note how long the first page takes after 20+ minutes idle (cold start).
- In every case, do not create or edit records; Testing data is real.

## Risks and safeguards

- M4-1: a recruiter used to one-letter results now sees the full list after one letter. Two letters work, and the change is stated in Кратко and the brief. Leads keep their legacy plans, untouched.
- M4-1, picker: after a first letter the picker shows its loading state for 300 ms and re-reads the newest 20 leads (`useTemplateSendFlow.js:74, 90`). That is 20 light lead documents instead of up to 150; accepted to keep the Documents chunk free of the list's search code.
- M4-3, cold start and the extra hop:
  - The first page after idle can take 1-3 s longer, and every call adds the access check.
  - The owner measures after merge. If desktop recruiters are worse off, revert M4-3c. Testing redeploys at merge, Production is unaffected until promoted, and the Hosting rollback restores Production.
  - Never set `minInstances`, which is a billing change.
- M4-3, removal: once a release with M4-3c is promoted, Production calls `listApplicationRows`. Never remove it from `functions/index.js` while a promoted release calls it; retire it only through `scripts/retire-functions.mjs` `RETIREMENTS`.
- M4-3c, test coverage: the browser tests run without a backend (E2E fixture branches), so no Playwright suite exercises the real callable. The owner's Testing check above is the only end-to-end proof; that is why it is an explicit step and the revert is planned.
- A field missing from `ROW_FIELDS` would give a blank cell, or a wrong collection in the call log (`useCallOutcome.js:103`). The static field-coverage test guards against it.
- `useCallOutcome.js:149-157` copies `{...lead}` only when the record vanished meanwhile. With slim rows that copy would be partial. This is rare and pre-existing; say so in the PR and do not widen the scope.
- Authorization drift: the callable uses the established `assertCompanyAccessForRequest`, its tests cover member and non-member, and the difference from the rules is documented in its header.
- Two copies of the query logic drifting apart: M4-3b makes one planner. The server only validates and runs.
- Option A or B creeping in: no backfill, trigger, rules or index change may appear in these PRs. Reviewers check that `firestore.indexes.json` and `src/firestore.rules` are untouched.
- M4-4: `appData` is the dossier's read at opening; nothing writes `sharedHistory` today, so nothing goes stale.

## Done when (acceptance criteria)

- [ ] M4-1 merged. A one-letter name search sends no query in the lists and only the newest-20 read in the picker; email, phone, confirmation and id searches are unchanged. The four new tests failed before and pass after. APP_BRIEF §4 is updated.
- [ ] M4-2: the four numbers, the date, the company size and the verdict (OPEN or CLOSED) are in the plan's progress section. An E-Docs number over 1 MB is handed to checklist #5.
- [ ] If the gate is CLOSED: the item is marked closed with its numbers, and no further code was written.
- [ ] If the gate is OPEN and the owner said yes:
  - M4-3a, M4-3b and M4-3c are merged.
  - On Testing, a Next page transfers 20% or less of its M4-2 size, and a 3-letter search transfers less than before.
  - `firestore.indexes.json` and `src/firestore.rules` are unchanged.
  - The callable map, APP_BRIEF and RELEASE_CHECKLIST are updated, and the owner has noted the cold-start delay.
- [ ] M4-4 is merged, or marked "done under #3".
