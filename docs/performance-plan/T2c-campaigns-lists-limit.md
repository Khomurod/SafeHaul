# T2c. Limit the Campaigns lists while keeping live campaigns and totals right

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #5 — Paginate API results (sub-part c: Campaigns dashboard); #23 — Virtualize long lists (context: at most 50 cards per list until the user asks for more; no virtualization)
- **Size:** M · **Pull requests:** 1 · **Depends on:** T2a (`src/shared/hooks/useLoadMoreFocus.js`), T2b (`src/shared/hooks/useLiveQueryWindow.js`, `src/shared/hooks/useServerAggregate.js`) · **Owner decision needed:** none. Assumption to state in the PR: for a carrier with more than 50 campaigns, "Total Outreach" is a server total that refreshes within about 2 seconds of a change instead of with every single message.
- **Why it matters for users:** The Campaigns page keeps a live copy of every draft and every campaign the carrier ever ran, and older campaign records still carry up to 2,000 recipient ids each, so the page gets heavier with every campaign. After this task it loads the newest 50 of each (more on request), while every running, queued, scheduled or paused campaign is always listed and cancellable, and the two numbers at the top stay correct.

## Current behaviour (verified at 11626a6)

- `src/features/campaigns/CampaignsDashboard.jsx:53-78`: live listener on `campaign_drafts`, `orderBy('updatedAt','desc')` (`:69-72`), no limit, no error callback (`:73-76`): a failed listener leaves "Synchronizing…" (`:314`) forever.
- `:81-120`: live listener on `bulk_sessions`, `orderBy('createdAt','desc')` (`:99-102`), no limit; the mapping `:104-117` sets `matchCount` from `progress.totalCount || targetIds?.length` and spreads `...data`, so older sessions bring their up-to-2,000 `targetIds` (`functions/bulkActions/helpers/sessionTargets.js:3-9`). Sessions are created only by Cloud Functions (no client writes to `bulk_sessions` except delete, `:227`).
- Stats `:134-135`: Live Campaigns = sessions with status `active|queued|scheduled`; Total Outreach = Σ `progress.processedCount` over all sessions; shown at `:281` and `:288`.
- `:138` picks the list by tab; `:251` the details follow the live session by id (a session missing from the list returns to the list); cancel/delete capture the target when the dialog opens (`:183-236`); `requestDeleteCampaign` refuses a live session (`:211-214`); `isE2ECampaignMock` (`:46`) is also used by `handleNewCampaign` (`:143`). Live statuses: `CANCELLABLE_SESSION_STATUSES = ['active','queued','scheduled','paused']` (`src/features/campaigns/constants/campaignConstants.js:103`).
- The effects run before the paywall return (`:122-131`); `CampaignsDashboard.test.jsx:285-299` pins "no listeners when the feature is off".
- Rules: the team reads and writes both collections (`src/firestore.rules:285-297`).
- Tests: `CampaignsDashboard.test.jsx` routes listeners by call order in FOUR places — `:106-117`, `:175-178`, `:267-270`, `:466-469` (`if (!draftCb) draftCb = cb; else sessionCb = cb;` — a third listener would take `sessionCb`); asserts exactly 2 listeners (`:301-312`) and the stats 3 / 35 (`:314-332`); its fixtures give `createdAt` as `{ toDate }` only (`:132`, `:475`). The Firestore mock (`:27-41`) has no `limit`, `where` or aggregate functions. The file uses `vi.clearAllMocks()` and no `*Once` queue; `mockCancelCallable` gets its default by chaining at module scope (`:43`).
- E2E mock `?e2eCampaign=mock` (fixtures `:47-50`, `:56-66`, `:84-96`); pictured as `company-campaigns` (`e2e/visual/app.spec.cjs:127-128`); other suites click the one seeded session (`e2e/campaign-results-table.spec.cjs:17-18`, `e2e/campaign-report-modal.spec.cjs:15-16`), so the default fixtures must not change.
- Indexes needed by the new queries: `orderBy` on one field, `where('status','in',[…])` without `orderBy`, a count, and a `sum` over the whole collection — all single-field. No `firestore.indexes.json` change.
- Bundle: `sum` and `getAggregateFromServer` are imported nowhere yet; `@firebase/firestore` is in the startup `vendor` chunk (`vite.config.js:26-29`, `:38-41`).

## Scope

- In: a feature hook `useCampaignLists`; windows of 50 for drafts and sessions with Load more; a live listener for live sessions merged into Past Sequences; exact live stats; a server sum for Total Outreach when the session list is incomplete; "of N" counts; an error notice instead of an endless spinner; an E2E "many" fixture; tests; one APP_BRIEF sentence.
- Out (do not do in this task): any change to how campaigns are launched, cancelled, deleted, retried or sent; the editor, details or report (T2a); Cloud Functions or rules; removing `targetIds` from old documents (a data migration needs the owner's approval); a per-document listener to keep an old live campaign's details open after it stops (see Risks); virtualization.

## Read first

- `AGENTS.md`, `CLAUDE.md`, `.claude/skills/implement/SKILL.md`.
- `docs/APP_BRIEF.md` §4 "Bulk SMS / email campaigns" (lines 323-325), §8 "Bulk campaigns" (1049-1063), §10 (1123-1202), §13 (1403+).
- `.claude/rules/testing.md`, `.claude/rules/ui.md`, `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`, `src/design-system/README.md`, `src/design-system/components/notice/README.md`.
- The T2a/T2b shared hooks and their tests (`src/shared/hooks/useLoadMoreFocus*`, `useLiveQueryWindow*`, `useServerAggregate*`).
- Library docs: `npx ctx7@latest library "Firebase JavaScript SDK" "getAggregateFromServer with sum() over a nested field"`, then `npx ctx7@latest docs <that id> "getAggregateFromServer with sum() over a nested field"`. Planning-time facts: `sum` and `getAggregateFromServer` are exported by the installed SDK (`node_modules/@firebase/firestore/dist/index.d.ts:2752`, `:1318`); `sum` ignores non-numeric and missing values (same as today's `|| 0`); aggregates cannot be live listeners. If the quota is exhausted, say so and read the `.d.ts`.

## Implementation steps

1. Tests first, in `CampaignsDashboard.test.jsx`: add `limit`, `where`, `getCountFromServer`, `getAggregateFromServer`, `sum` to the mock (`:27-41`), each with a default at creation. Add one helper at the top, `listenerKind(q)` = `'drafts'` when `JSON.stringify(q)` contains `campaign_drafts`, `'live'` when it contains `__where`, else `'history'`, and replace all four call-order routings (`:106-117`, `:175-178`, `:267-270`, `:466-469`) with `callbacks[listenerKind(q)] = cb`; existing emits go to `history`. Keep `vi.clearAllMocks()` and queue no `*Once` value in this file (`src/tests/mockResetHygiene.test.js`); if one becomes necessary, switch the file to `vi.resetAllMocks()` and give `mockCancelCallable` its default at creation. Add, failing before: "the drafts and sessions lists ask for the newest 50" (`limit(50)` on both) and "a live session older than the newest 50 is still listed and cancellable" (emit it only on the live listener; its cancel button must exist on Past Sequences).
2. New `src/features/campaigns/hooks/useCampaignLists.js`: `export const CAMPAIGN_LIST_PAGE_SIZE = 50;` and `useCampaignLists({ companyId, enabled })`:
   - `drafts = useLiveQueryWindow({ buildQuery: () => query(collection(db,'companies',companyId,'campaign_drafts'), orderBy('updatedAt','desc')), resetKey: companyId, pageSize: 50, enabled: enabled && Boolean(companyId) && !isE2EMock, errorMessage: 'Campaign drafts could not be loaded.', logLabel: 'Error loading campaign drafts:' })`.
   - `history = useLiveQueryWindow({ buildQuery: () => query(collection(db,'companies',companyId,'bulk_sessions'), orderBy('createdAt','desc')), mapDoc: toSessionCard, pageSize: 50, errorMessage: 'Campaigns could not be loaded.', … })` where `toSessionCard` is the mapping moved verbatim from `:104-117`.
   - `live = useLiveQueryWindow({ buildQuery: () => query(collection(db,'companies',companyId,'bulk_sessions'), where('status','in',CANCELLABLE_SESSION_STATUSES)), pageSize: 100, mapDoc: toSessionCard, … })` (no `orderBy`, so only the automatic status index is used; 100 is a safety cap — live sessions are a handful).
   - `sessions` = `history.docs` in their server order, then the live sessions missing from them (older than the window), sorted newest first with a helper that reads `createdAt.toMillis()`, `createdAt.seconds` or `createdAt.toDate()` (the test fixtures carry only `toDate`), missing dates last. A session in both lists appears once (the history copy). No re-sort of the history rows.
   - `liveCount` = `sessions` with status `active|queued|scheduled` (exact and live, because the live listener holds every live session).
   - `outreach = useServerAggregate({ enabled: enabled && history.hasMore, refreshKey: history.snapshotVersion + ':' + live.snapshotVersion, run: async () => (await getAggregateFromServer(query(collection(db,'companies',companyId,'bulk_sessions')), { outreach: sum('progress.processedCount') })).data().outreach })` — always called (hooks rule), gated by `enabled`. `totalOutreach = history.hasMore ? outreach.value : sessions.reduce((acc, s) => acc + (s.progress?.processedCount || 0), 0)` (today's formula, `:135`); `null` while loading or failed.
   - `draftsTotal` / `sessionsTotal`: `getCountFromServer` of each base query through `useServerAggregate`, enabled only while that list `hasMore`; `null` otherwise.
   - E2E: move the fixtures from `:47-50`, `:56-66`, `:84-96` verbatim (`e2eCampaign=mock`, everything loaded, no reads). NEW `&e2eCampaignList=many`: 60 generated drafts and 60 completed sessions (artificial names), windowed locally 50 at a time with `loadMore` growing a local size, so the notices can be reviewed in a browser.
   - Return `{ drafts: { items, isLoading, error, hasMore, loadMore, isLoadingMore, loadMoreFailed, total, retry }, sessions: { items, isLoading, error, hasMore, loadMore, isLoadingMore, loadMoreFailed, total, retry }, liveCount, totalOutreach }` (`sessions.retry` retries both history and live).
3. `CampaignsDashboard.jsx`: call `useCampaignLists({ companyId, enabled: isCampaignsEnabled })` where the effects are now (before the paywall return); delete `:31-33`, `:47-120`, `:133-135`; keep `isE2ECampaignMock` (`:46`, used by `handleNewCampaign`); remove imports that become unused (`useEffect`, `collection`, `query`, `orderBy`, `onSnapshot`). `visibleCampaigns = activeTab === 'drafts' ? drafts.items : sessions.items`; `viewingSession` (`:251`) searches `sessions.items`; the spinner keeps following the drafts list (`loading = drafts.isLoading`). When the active list has an `error`, show `<Notice tone="danger" actions={<Button variant="secondary" size="sm" onClick={list.retry}>Try again</Button>}>{list.error}</Notice>` instead of the empty state. Under the card grid (`:335-346`), with one `useLoadMoreFocus` per tab (`resetKey: companyId`): when the active list `hasMore`, `<Notice tone="info" size="sm" className="mt-ds-4" actions={<Button ref={buttonRef} variant="secondary" size="sm" loading={list.isLoadingMore} onClick={press(list.loadMore)}>…</Button>}>` — drafts: `Showing the newest ${n} of ${total} drafts.` / "Load more drafts"; Past Sequences: `Showing ${n} of ${total} campaigns, newest first. Live campaigns are always listed.` / "Load older campaigns" (without a total, drop " of ${total}"); a load-more failure → `<p role="alert" className="text-ds-sm text-ds-status-danger-fg">Older campaigns could not be loaded.</p>` (drafts: "More drafts could not be loaded."); after the user loaded the last page, `<Notice ref={doneRef} tabIndex={-1} tone="info" size="sm" className="mt-ds-4">All ${n} drafts are shown.</Notice>` (sessions: `All ${n} campaigns are shown.`). Numbers via `toLocaleString('en-US')`. Stats: `value={liveCount}` and `value={totalOutreach ?? '—'}`. Cancel, delete, details and report wiring stays as is (`:183-259`, `:353-385`).
4. No index, rules or CSP change; say so in the PR.
5. `npm run check:source-size`: the dashboard shrinks below 388 lines; the hook stays below 300.
6. Docs (below), self-review per `/implement` §5, full diff read.
7. Open the PR. Suggested **Кратко** (name only the checks that actually ran): «Страница Campaigns теперь загружает последние 50 черновиков и 50 кампаний, остальные — по кнопке; идущие, запланированные и приостановленные кампании видны всегда и их можно остановить. Числа „Live Campaigns“ и „Total Outreach“ остаются верными (у очень больших компаний „Total Outreach“ обновляется через пару секунд). Проверено юнит- и браузерными тестами на компьютере и телефоне; база, правила и индексы не менялись. От вас: после слияния открыть Campaigns на тестовом сайте и посмотреть списки и числа, ничего не запуская и не удаляя».

## Tests

- New `src/features/campaigns/hooks/useCampaignLists.test.js`: three listeners with the exact queries (`limit(50)` twice; `where('status','in',['active','queued','scheduled','paused'])` with `limit(100)`); merge without duplicates, history order kept, older live sessions appended newest first (including `{ toDate }`-only dates); `liveCount` from merged items; local `totalOutreach` while the history is not full; server sum (`getAggregateFromServer` with `sum('progress.processedCount')`) when it is, `null` on failure; counts only for full lists; `loadMore` grows to `limit(100)`; disabled → no listeners and no aggregates; E2E `many` mode → 50 shown, `hasMore`.
- `CampaignsDashboard.test.jsx`: listener routing (step 1); `:301-312` now expects 3 listeners and 3 unsubscribes; `:314-332` stats stay 3 and 35; NEW (fail before): `limit(50)`; the old live session is listed with its cancel control; NEW: Total Outreach shows the server sum when the history is full and '—' when the sum fails; NEW: the notice and "Load older campaigns" re-subscribe with `limit(100)`; NEW: a drafts listener error shows the danger Notice with Try again instead of "Synchronizing…". The paywall test (`:285-299`), the cancel-vs-delete tests and the details tests ("updates the open details as the session sends", "goes back to the list when the open session is deleted") stay green.
- `e2e/campaigns-dashboard.spec.cjs`: NEW test on `?e2eAuth=company_admin&e2eCampaign=mock&e2eCampaignList=many`: Drafts shows "Showing the newest 50 of 60 drafts."; Load more drafts → 60 cards and "All 60 drafts are shown." is focused; Past Sequences the same with "Load older campaigns" and "All 60 campaigns are shown."; NEW `@mobile` overflow check with the notice. The default mock shows one card per tab, so the `company-campaigns` baseline must not change.

## Documentation to update in the same PR

- `docs/APP_BRIEF.md` §4 "Bulk SMS / email campaigns" (lines 323-325), one sentence: "The Campaigns page lists the newest 50 drafts and campaigns (more on request) plus every live one (active, queued, scheduled, paused); when the list is incomplete, Total Outreach is a server sum refreshed shortly after a change."
- Design-system roadmap: no change (approved `Notice` and `Button` only). OWNER_GUIDE / RELEASE_CHECKLIST: none ("Campaigns opens without error" stays true).

## Verify before opening the PR

- `npm run lint:frontend`, `npm run typecheck`, `npm run test:coverage`, `npm run build` then `npm run check:bundle-budget` (`sum`/`getAggregateFromServer` join the startup `vendor` chunk; never raise the ceiling), `npm run check:source-size`, `npm run test:stories`.
- Playwright, one at a time, port 5000 free first: `npm run test:e2e -- --project=chromium e2e/campaigns-dashboard.spec.cjs`, then `npm run test:e2e -- --project=mobile-chrome e2e/campaigns-dashboard.spec.cjs`, then chromium runs of `e2e/campaign-card.spec.cjs`, `e2e/campaign-details.spec.cjs`, `e2e/campaign-launch-and-control.spec.cjs`, `e2e/campaign-report-modal.spec.cjs`, `e2e/campaign-results-table.spec.cjs`, `e2e/table-layout.spec.cjs`, `e2e/a11y.spec.cjs`.
- `npm run test:visual` only with the pinned browser, else say so and rely on CI's `app-visual` lane.
- Desktop 1440 and phone 412 review with `e2eCampaignList=many` on both tabs; keyboard reaches the Load more buttons after the cards, with visible focus that stays on the button (or the "All … shown" line) after loading.
- Not run, with reason: `test:rules`, `functions` tests (nothing there changed).

## Verify after merge (on Testing, read-only)

- `curl -s https://truckerapp-system.web.app/release.json` names the merge commit.
- Owner: Testing → Campaigns. The two number cards show values; Drafts and Past Sequences list cards; if there are more than 50, the "Showing … of N" line and the Load more button appear. Any running campaign appears in Past Sequences (newest first; an old running one sits after the newest 50). Do not create, launch, cancel or delete anything.

## Risks and safeguards

- A live campaign older than the newest 50 could have vanished from the list and lost its Cancel button; the dedicated live listener prevents that, and a test pins it.
- Such an old live campaign leaves the list once it finishes or is cancelled (it is no longer live and is older than the window); if its details were open they return to the list, as for a deleted session. "Load older campaigns" shows it again. Rare (50 newer campaigns while an old one still runs); state it in the PR.
- Wrong stats from a partial list: Live Campaigns comes from the complete live listener; Total Outreach is local only when the list is complete, otherwise a server sum refreshed at most every 2 s (batch window, so it keeps moving while a campaign sends).
- One more listener (live sessions, usually 0-3 documents) and a few cheap aggregates against no longer reading every campaign document.
- Error handling changes from an endless spinner to a visible notice with Try again — a deliberate improvement; mention it in the PR.
- Bundle: `sum`/`getAggregateFromServer` add a little to the startup chunk; `check:bundle-budget` must pass unchanged.
- Rollback: revert the PR; no data, rules or index change.

## Done when (acceptance criteria)

- [ ] Drafts and sessions listeners use `limit(50)` and grow by 50 on Load more; the live-sessions listener uses `where('status','in',CANCELLABLE_SESSION_STATUSES)`.
- [ ] Every live (active, queued, scheduled, paused) session is listed on Past Sequences with its Cancel control, however old.
- [ ] Live Campaigns equals today's number; Total Outreach equals today's sum when everything is loaded, and shows the server sum (or '—' on failure, never a partial sum) otherwise.
- [ ] Each tab shows "Showing … of N" while incomplete and "All N … are shown." (focused) after the user loaded the last page.
- [ ] A failing drafts or sessions listener shows a danger Notice with Try again, not "Synchronizing…" forever.
- [ ] All four call-order routings in `CampaignsDashboard.test.jsx` are replaced; listed unit and Playwright suites pass; the two "fails before" tests were seen failing; the `company-campaigns` baseline is unchanged.
- [ ] APP_BRIEF §4 updated; Кратко first; the PR states "no index, rules or CSP change" and the Total Outreach assumption.
