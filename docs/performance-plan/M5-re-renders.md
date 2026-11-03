# M5. Fewer re-renders where measured

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #26 — Prevent unnecessary re-renders
- **Size:** S (M only if the wizard's gate opens and attribution picks fix W-b) · **Pull requests:** 1 to 3: M5-1 records the measurement (plan file only, or folded into M5-2); M5-2 for the list; M5-3 for the wizard, only if its gate opens · **Depends on:** T1 (its measurement conventions and any numbers it recorded) · **Owner decision needed:** none (React Compiler is not proposed; see Out of scope)
- **Why it matters for users:** In the driver application, every key a driver types redraws the whole current page; on a cheap phone that can make typing lag. In the recruiter list, every key typed in the search box redraws the 20-row table, although nothing in it changes until the search runs. Nobody has measured whether either is slow enough to notice, so this task measures first and fixes only what crosses the line.

## Current behaviour (verified at 11626a6)

- Wizard state and the shared updater:
  - `src/features/driver-app/components/application/PublicApplyHandler.jsx:58` keeps every answer in one `formData` state.
  - `handleUpdateFormData` (`:285-290`) is a new function on every render; it is not wrapped in `useCallback` (already imported at `:2`). It goes to `Stepper` as `updateFormData` (`:464-477`).
  - So `DynamicRow`'s `handleChange` (`src/shared/components/form/DynamicRow.jsx:26-36`, deps `[updateFormData, listKey]`) is also recreated on every keystroke.
- Wizard re-renders and recomputation on each keystroke:
  - Each keystroke re-renders `PublicApplyHandler` with all its hooks and `resolveApplyStatusScreen` (`:406-440`), then `Stepper` (`src/shared/components/layout/Stepper.jsx:56-170`) and the whole current step.
  - Each keystroke also re-evaluates the company's rules: `useStepIssues` (`src/features/driver-app/hooks/useApplicationRules.js:35-51`) memoizes on `formData`, which changes on every key. `useStepGate` (`:65-91`, Continue gate `refuseIfBlocked` at `:78-88`) is used by Steps 1, 2, 3, 4, 5 and 7; `Step6_Employment.jsx` calls `useStepIssues` directly (`:79`) and also recomputes `employmentStepIssues` (`:91`) and `computeEmploymentCoverage` (`:115`); its gate is `handleContinue` (`:150-181`). The hook's header (`useApplicationRules.js:8-11`) records this as intended: "every render re-evaluates, nothing is cached across answers".
- Memo coverage:
  - `driver-app` has no `React.memo`.
  - `src/` has four: `src/design-system/components/data-table/DataTable.jsx:189`, `src/features/companies/components/DashboardToolbar.jsx:35` (a feature component, not design system), `ResizableDraggableField.jsx:46` and `FieldPropertiesPanel.jsx:22`.
  - Nothing in `src/` uses `useDeferredValue`, `useTransition` or `startTransition`.
  - `PublicApplyHandler.jsx` has 496 lines; the source-size warning starts at 500.
- Candidate list: `src/features/company-admin/views/CompanyCandidatesListPage.jsx` passes new values on every render to the memoized `DataTable` and `DashboardToolbar`:
  - `getRowTone` (`:153-157`)
  - `segments` (`:186-190`)
  - `onAssignLeads` (`:197`)
  - `onToggleMyAssignments` (`:201-203`)
  - `onSortChange` (`:215`)
  - `getRowLabel` (`:216`)
  - `empty` (`:220-223`)
  - `error` (`:224-229`)
  - `selection`, with its inner `getRowLabel` (`:230-236`)
  - `pagination` (`:243-251`)
- Two more sources defeat the memo:
  - The selection reset (`:61-70`) runs on every `dashboard.searchQuery` change and calls `setSelectedRowIds([])`, a new empty array each time. That forces one more render per keystroke and, on Company Leads for an admin (`canAssign`, `:151`), a new `selection.selectedIds` for the table.
  - `src/shared/hooks/useCompanyTeam.js:72` and `:74` return a new `[]` on every render when the company document carries no `teamMembers` (for a non-admin, or while memberships load). The page's `columns` memo depends on `teamMembers` (`CompanyCandidatesListPage.jsx:163-168`), so the columns, and the table, rebuild on every render in that case. Its other consumers (`AudienceBuilder.jsx:82`, `useAppFetch.js:33`) only read the array.
- The hook adds more: `setFilters` (`src/features/companies/hooks/useCompanyDashboard.js:298-306, 343`), `refreshData` (`:318-322`) and `nextPage`/`prevPage` (`:331-332`) are new functions on every render. `useCompanyDashboard` has one consumer, this page.
- So each key typed in search (the `searchQuery` state, debounced 400 ms at `:77-82`) redraws all table rows, although they do not change until the debounced search returns. The toolbar must redraw anyway, because `searchQuery` is its prop.
- No effect in the page lists `refreshData`, `setFilters`, `nextPage` or `prevPage` (`:38-40, 54-58, 61-70`), and `DashboardToolbar` has no effect; making them stable changes no effect timing.
- Measurements so far:
  - The #26 findings' Lighthouse runs used no CPU slowdown.
  - A one-off planning dry run (not in the repository, not reproducible from it, not a baseline) reported INP-like values of 64-112 ms at 4x CPU slowdown and 288-472 ms at 10x for typing on Personal Information and on Employment History with 6 employers. Close to the line, so the real measurement decides.
- Real-user data may exist: Sentry's `browserTracingIntegration` measures INP by default (`enableInp: true` in the installed `@sentry/browser` 11.8.0), sampled at 20% (`src/lib/monitoring/sentry.js:31, 43`), attached only once the page is idle (`sentry.js:20-26, 87`). Transaction names are raw URLs until checklist #30's task changes them.
- React Compiler is not adopted:
  - `eslint.config.js:39-47` keeps its lint rules off: 89 errors across 69 files, measured 2026-09-08.
  - The installed `@vitejs/plugin-react` 6.1.2 offers it only as an experimental Rust `compiler` option, which needs the `oxc-transform-react` package, or through three extra Babel dev dependencies (`node_modules/@vitejs/plugin-react/README.md:80-145`).
- Unit tests run in Vitest 5 with the happy-dom environment.

## Scope

- In:
  - M5-1: measure the wizard and the list, then decide.
  - M5-2: stable props for the candidate list, an S-size change in `CompanyCandidatesListPage.jsx`, `useCompanyDashboard.js` and `useCompanyTeam.js`.
  - M5-3: the single wizard fix the attribution points to, only if the wizard's gate opens.
- Out (do not do in this task):
  - React Compiler, whether the experimental `compiler: true` or the Babel preset with three new dev dependencies. It means 89 lint errors to migrate across 69 files, with the effect-timing risk recorded at `src/shared/components/feedback/ToastProvider.jsx:96-99`, and no measurement asks for it. If measurement later shows wide re-render cost, it comes back as its own owner-approved project, piloted with `compilationMode: 'annotation'`.
  - An app-wide memo campaign, or `React.memo` on any component not measured.
  - Custom `memo` comparators.
  - Per-field or uncontrolled wizard state.
  - Changing when rule issues are shown (still only after a Continue attempt), the Continue gate's verdicts, draft saving, the 400 ms debounce or the page size.
  - Any change to `DataTable`, `ListToolbar` (design system) or `DashboardToolbar` (the feature's toolbar).
  - Sentry or real-user monitoring setup (#30) and slow-phone CI lanes (#31).

## Read first

- `AGENTS.md` §1-§5, `CLAUDE.md`, `.claude/skills/implement/SKILL.md`.
- `.claude/rules/testing.md` and `.claude/rules/ui.md`. Confirm against `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` and `src/design-system/README.md` that no design-system piece changes.
- `docs/APP_BRIEF.md`:
  - §5 "What the application asks and enforces" (602-685) and the unfinished-application draft rules (363-551), for the wizard.
  - §10 (from 1123) and §13 (from 1403).
- `useApplicationRules.js:1-91`, `ToastProvider.jsx:96-103`, `e2e/helpers/wizardHelpers.cjs`, and T1's results and conventions.

## Implementation steps

*M5-1: measure and decide*
1. Use T1's recorded values if it measured these scenarios; otherwise measure them here. Report INP-like values as the median of 3 runs at 4x, plus 10x for information, for:
   - **W1**: typing in the first-name field on Personal Information (`/apply/e2e-company`, filled as `e2e/helpers/wizardHelpers.cjs` `fillStep1` does).
   - **W2**: typing in an employer name field on Employment History with 6 employers added through `+ Add Employer`, reached as `e2e/public-application.spec.cjs:70-83` does.
   - **L1**: typing `maria` into "Search name, phone, email..." on `/company/drivers/applications?e2eAuth=company_admin`, then clicking `New` and `All Applications`, at a desktop 1440×900 viewport and at Pixel 7.
2. Harness (self-contained; everything stays in your session's scratchpad and is never committed):
   - Build the production E2E bundle: `VITE_E2E_TEST_MODE=1 npx vite build --outDir <scratchpad>/dist-e2e --emptyOutDir`. A production build fetches `/__/firebase/init.json` (`src/lib/firebase/config.js:79-120`), so write `<scratchpad>/dist-e2e/__/firebase/init.json` with the placeholder values of `PLACEHOLDER_FIREBASE_CONFIG` (`config.js:57-64`). Never put real `VITE_FIREBASE_*` or real init values there.
   - Serve it with `npx vite preview --outDir <scratchpad>/dist-e2e --host 127.0.0.1 --port 4173 --strictPort`, keeping its PID to stop exactly that process.
   - In a Playwright script (Chromium, `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` locally), abort every request whose host is not `127.0.0.1` with `page.route('**/*', …)`: the production build does not redirect Firestore to the closed port (`config.js:168-170` is development-only), so nothing may leave the machine.
   - Slow the CPU with CDP `Emulation.setCPUThrottlingRate`, type with `pressSequentially(…, { delay: 150 })`.
   - Compute INP-like with `PerformanceObserver({ type: 'event', durationThreshold: 16, buffered: true })`: the longest entry per `interactionId`, unreported interactions counted as 0, sorted descending, the value at index `floor(interactions / 50)`.
   - Record the machine (T1's Lighthouse `benchmarkIndex` if available) next to the numbers. The list fixture has 8 rows, not 20; say so next to L1.
3. Attribute, only for a scenario at 100 ms or more, with scratch scripts in the scratchpad:
   - (a) In Node, with artificial data (the 6-employer answers), time `evaluateApplicationRules({ rules, applicationConfig, formData, strict: true })`, `employmentStepIssues` and `computeEmploymentCoverage` over 1000 iterations, and report ms per call.
   - (b) In Vitest (happy-dom, the development React build), wrap `Stepper` or the list page in React `<Profiler>` and count commits and `actualDuration` per keystroke. React's production build disables the Profiler (react.dev, `<Profiler>` caveats), so this is relative evidence only.
4. Apply the decision rule per screen, and record the numbers, the date, the harness and the verdict in the plan's progress section.
   - **Act** if the median of 3 at 4x is 200 ms or more (Google's "good" INP line; 4x is Lighthouse's mobile CPU factor). Do M5-2 for the list, M5-3 for the wizard.
   - **100-199 ms**: act only with an S-size local fix whose tests prove unchanged-prop renders are skipped. M5-2 qualifies; W-a and W-b do not. Otherwise record "watch".
   - **Under 100 ms**: no code change. M5-2 may still be done later as its own small PR, by an agent who is changing `CompanyCandidatesListPage.jsx` or `useCompanyDashboard.js` anyway.
   - **Real-user override**: if checklist #30's work shows Sentry p75 INP over 200 ms on `/apply/*` or `/company/drivers/*`, treat that screen as "act".

*M5-2: the candidate list stops redrawing unchanged rows*

5. Write the failing tests first (see Tests).
6. `useCompanyDashboard.js`:
   - Wrap `handleSetFilters` (`:298-306`) in `useCallback(…, [])`; it uses only the state setter.
   - Add `const refreshData = useCallback(() => { setListCountError(''); fetchListTotalCount(); fetchData(); }, [fetchListTotalCount, fetchData]);`.
   - Add `const nextPage = useCallback(() => setCurrentPage((p) => p + 1), []);` and `const prevPage = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);`.
   - Return these at `:318-322`, `:331-332` and `:343`. Behaviour stays the same; only the function identities become stable.
7. `src/shared/hooks/useCompanyTeam.js`: add a module-level `const NO_TEAM = [];` and return it instead of the literal `[]` at `:72` and `:74`. Behaviour is the same; no consumer mutates the array (grep `useCompanyTeam(`).
8. `CompanyCandidatesListPage.jsx`. At module scope (pure, no component state), add:
   - `rowTone(item)`, the body of `:153-157`
   - `dossierRowLabel(item)` (`:216`)
   - `selectRowLabel(item)` (`:235`)
   - `EMPTY_STATE` (`:220-223`)
9. Inside the component:
   - `const { setFilters, refreshData, nextPage, prevPage } = dashboard;`
   - The selection reset (`:61-70`): `setSelectedRowIds((prev) => (prev.length === 0 ? prev : []))`, so an empty selection keeps its identity. Same behaviour, same dependency list.
   - `handleSortChange = useCallback(({ direction }) => setDateOrder(direction), [setDateOrder])`
   - `toggleRowSelection` → `useCallback(…, [])`, because it uses a functional update
   - `toggleSelectAllPage` → `useCallback(…, [sortedData])`
   - `selection = useMemo(() => (canAssign ? { … getRowLabel: selectRowLabel } : undefined), [canAssign, selectedRowIds, toggleRowSelection, toggleSelectAllPage])`
   - `tableError = useMemo(…, [dashboard.error, dashboard.listCountError, refreshData])`
   - `pagination = useMemo(…, [dashboard.currentPage, dashboard.totalPages, dashboard.totalCount, nextPage, prevPage])`
   - `segments = useMemo(…, [pipelineTabs, dashboard.pipelineSegment, dashboard.setPipelineSegment])`
   - `handleAssignLeads = useCallback(() => setAssigningLeads(selectedRowIds), [selectedRowIds])`, replacing `handleOpenAssignment` (`:85-87`, used only at `:197`)
   - `handleToggleMyAssignments = useCallback((next) => setFilters((prev) => ({ ...prev, myAssignmentsOnly: next })), [setFilters])`
10. Rules for these edits:
    - Leave the `columns` memo and its existing eslint comment (`:160-168`) as they are.
    - Primitive strings (`ariaLabel`, `loadingLabel`) stay inline.
    - Every hook goes before the `return` (the component has no early return), with full dependency arrays.
    - Add no new `eslint-disable` and no custom comparator.
11. Do not touch `DataTable`, `DashboardToolbar` or `ListToolbar`. No design-system work means no roadmap, story or baseline change; say so in the PR.
12. Re-measure L1 with the same harness, and put the before and after numbers in the PR. Suggested Кратко: «Список Applications/Leads не перерисовывает таблицу, пока вы печатаете в поиске; внешне ничего не меняется. Замер до/после: … мс при 4-кратном замедлении. Проверено: unit- и браузерные тесты списка. От вас ничего не нужно.»

*M5-3: the wizard (only if its gate opens). Pick the fix by attribution.*

13. Always do this first; it is S-size and makes W-b possible. Wrap `PublicApplyHandler.jsx:285-290` `handleUpdateFormData` in `useCallback(…, [])`; it uses only `setFormData`. That keeps `DynamicRow.handleChange` stable. Keep the file under 500 lines, and put anything bigger in a hook.
14. **W-a**, when the rule and issue computation is at least half of the keystroke time (step 3a):
    - In `useStepIssues` (`useApplicationRules.js:35-51`), compute the returned (displayed) verdict from `const shownData = useDeferredValue(formData)`.
    - Keep the live answers in a ref updated each render, and return a stable `blockingNow()` that runs `evaluateApplicationRules` + `issuesForStep` on them and returns the blocking issues.
    - `useStepGate.refuseIfBlocked` (`:78-88`) decides with `blockingNow().length`, not the displayed `blocking.length`. Steps 1, 2, 3, 4, 5 and 7 get this through `useStepGate` without edits.
    - `Step6_Employment.jsx` `handleContinue` (`:150-181`) uses `blockingNow()` (filtered as `otherBlocking` is at `:83`) for its refusal; `fieldIssues` and `coverage` stay as they are unless step 3a shows they dominate.
    - Update the header comment at `useApplicationRules.js:8-11`: the gate decides on the answers at the moment of Continue, and the shown verdict follows within a frame.
15. **W-b**, when employer rows dominate:
    - Turn `renderEmployerRow` (`Step6_Employment.jsx:193`) into a memoized `EmployerRow` component with explicit props: `index`, `item`, a stable `onChange` (`DynamicRow.handleChange`), that row's issues, and config primitives.
    - Give `DynamicRow` an optional `RowComponent` prop, used instead of `renderRow`. Update the contract header at `DynamicRow.jsx:8-17`.
    - This is M-size. Write the design in the PR description first, and abandon W-b if any prop (for example `errorFor`, `lockedEmployers`) cannot be made stable without a custom comparator.
16. If the cost is spread over many fields with no dominant part, record "watch" and stop. No campaign.
17. Re-measure W1 and W2 with the same harness, and put the before and after numbers in the PR.

## Tests

- M5-2, new `src/features/companies/hooks/useCompanyDashboard.stable.test.jsx`, with the mocks of `useCompanyDashboard.team.test.jsx:12-50` (a hoisted, stable profile; the `reads.test.jsx` mock builds a new profile on every call, which would make `teamMembers` unstable by itself):
  - Capture `setFilters`, `nextPage`, `prevPage` and `refreshData`, then `act(() => result.current.setSearchQuery('m'))`. All four identities stay the same. This fails before the change.
  - With a hoisted profile `{ id: 'co-1' }` (no `teamMembers`) and claims that are not admin, `teamMembers` keeps its identity across the same re-render. This fails before the change (`useCompanyTeam.js:72`).
  - `setFilters('state', 'Texas')` still updates `filters`, `nextPage`/`prevPage` still move `currentPage`, and `refreshData()` still sends one count read and one list read.
- M5-2, new `src/features/company-admin/views/CompanyCandidatesListPage.renders.test.jsx`. Mock as in `CompanyCandidatesListPage.sort.test.jsx:14-54`, with `searchQuery`, `loading` and `scope`-dependent values held in the hoisted fixture, plus:
  - `vi.mock('@/design-system/components', async (importOriginal) => { const actual = await importOriginal(); const { createElement } = await import('react'); return { ...actual, DataTable: (props) => { fx.tableProps.push(props); return createElement(actual.DataTable, props); } }; })`: a plain recorder that renders the real table.
  - `DashboardToolbar: (props) => { fx.toolbarProps.push(props); return null; }` in the `@features/companies` mock.
  - It asserts, comparing the last recorded props with the ones before by `Object.is` on every key:
    - Applications scope, re-rendered with only `searchQuery` changed: every `DataTable` prop is identical, so the real memo skips. This fails before the change (`getRowTone` and others differ).
    - Company Leads with admin claims, same re-render: every `DataTable` prop is identical, `selection` included. This fails before the change (the selection reset).
    - Re-rendered with only `loading` changed: every toolbar prop is identical.
    - Company Leads with admin claims: ticking a row's checkbox in the real table gives props whose `selection.selectedIds` contains that row, so the memo never blocks a real update.
  - The file queues no `*Once` values; if it ever does, use `vi.resetAllMocks()`.
- Behaviour stays the same. These stay green, unchanged:
  - `CompanyCandidatesListPage.dossier.test.jsx`, `.segment.test.jsx` and `.sort.test.jsx`
  - `useCompanyDashboard.order.test.jsx`, `.reads.test.jsx`, `.segment.test.jsx` and `.team.test.jsx`
  - `DataTable.test.jsx`, `DataTable.sort.test.jsx`, `DataTable.d0.test.jsx` and `tableColumnContract.test.js`
- M5-3:
  - All 11 `PublicApplyHandler.*.contract.test.jsx` files, `PublicApplyHandler.test.jsx`, `PublicApplyHandler.companyScope.test.jsx` and the `steps/Step*_*.test.jsx` files stay green, unchanged.
  - W-a is a refactor, not a defect fix, so its guards pass before and after: new cases in `Step1_Contact.gates.test.jsx`, `Step3_License.gates.test.jsx`, `Step7_General.gates.test.jsx` and `Step6_Employment.issues.test.jsx`, where pressing Continue right after typing a blocking value is refused and proceeds once the last issue is fixed. Plus a new `src/features/driver-app/hooks/useApplicationRules.test.jsx` that mocks React's `useDeferredValue` to return a stale value and asserts that `refuseIfBlocked()` follows the live answers both ways.
  - W-b: a new render-count test with `./components/EmployerNameAutocomplete` mocked as a counting stub keyed by its `id` (`emp-name-<index>`): typing in row 6 of 6 renders `emp-name-0` to `emp-name-4` zero more times. It fails before the change.

## Documentation to update in the same PR

- M5-1: the plan's progress section only.
- M5-2: none; nothing changes for users, so APP_BRIEF, OWNER_GUIDE and the roadmap stay true. Say so in the PR.
- M5-3 W-a: the `useApplicationRules.js` header comment. Check APP_BRIEF §5 (602-685) for any sentence that promises re-evaluation on every keystroke; none was found at 11626a6. W-b: the `DynamicRow.jsx` contract header.

## Verify before opening the PR

- Every PR runs:
  - `npm run lint:frontend`, with zero new `react-hooks/exhaustive-deps` warnings on touched lines
  - `npx vitest run <changed folders>`, then `npm run test:coverage`
  - `npm run build`, then `npm run check:bundle-budget`
  - `npm run check:source-size`
  - `npm run test:stories` (no component, token, style or table change, so no visual or table-layout lane; say so)
- M5-2 Playwright, one suite at a time, after checking that port 5000 is free:
  - `npm run test:e2e -- --project=chromium e2e/company-candidate-table.spec.cjs`, then the same file with `--project=mobile-chrome` (it has `@mobile` tests)
  - `npm run test:e2e -- --project=chromium e2e/applications-search-filters.spec.cjs`
  - `npm run test:e2e -- --project=chromium e2e/list-page-tablet.spec.cjs`
  - `npm run test:e2e -- --project=chromium e2e/driver-dossier.spec.cjs`
- M5-3 Playwright, one at a time, with `--project=chromium`:
  - `e2e/public-application.spec.cjs`
  - `e2e/public-application-responsive.spec.cjs` (it sets its own phone viewports; it has no `@mobile` tests)
  - `e2e/guest-application-intake.spec.cjs`
  - `e2e/guest-draft-resume.spec.cjs`
  - `e2e/guest-offline-queue.spec.cjs`
  - `e2e/wizard-double-submit.spec.cjs`
  - `e2e/employer-safer-lookup.spec.cjs`
  - `e2e/application-signature.spec.cjs`
  - then `npm run test:e2e -- --project=mobile-chrome e2e/guest-application-phone-layout.spec.cjs` for its `@mobile` tests.

## Verify after merge (on Testing, read-only)

- M5-2, for the owner, in Russian:
  - Applications: type in search; page Next and Prev; use a segment and Only mine; open and close a dossier.
  - Company Leads: tick a few rows and select all, but do not press Assign.
  - Everything should look and behave as before.
- M5-3, for the owner, on a phone, at `/sandbox/apply` only. A real company link saves an unfinished application at that company.
  - Type on Personal Information and Employment History.
  - Press Continue with a required field empty: it is refused.
  - Use Magic Fill and go on, but do not submit.
  - Typing should feel at least as quick as before.

## Risks and safeguards

- Stale closures from memoization (a missing dependency keeps an old value). Safeguards: full dependency arrays, `react-hooks/exhaustive-deps` clean, no custom comparators, no new `eslint-disable`, and a test that a real update (a ticked row) still reaches the table.
- Effect timing from identity changes, the problem `ToastProvider.jsx:96-99` records: no effect in the page or the toolbar lists the callbacks made stable here, so no effect starts or stops running at a different time.
- The selection reset keeps its dependency list and still empties a non-empty selection; only an already empty one keeps its identity.
- `NO_TEAM` is shared by three consumers; none mutates the array. If one ever did, the shared constant would leak, so a reviewer checks the grep.
- `rowTone` runs only when the table re-renders. The 48-hour Stale badge had no timer before either, so a badge that crosses the line while the page is open updates on the next data change, as it does in practice today.
- W-a could let Continue use a stale verdict. Safeguards: the gate evaluates the live answers at the moment of Continue; the `useDeferredValue`-stubbed test pins it both ways; the shown verdict lags at most one deferred render.
- Rollback: revert the PR. No data, rules, indexes or backend change is involved.

## Done when (acceptance criteria)

- [ ] M5-1: W1, W2 and L1 are recorded (median of 3 at 4x, and 10x), with the date, the harness, the machine and a verdict per screen (act, watch or closed).
- [ ] M5-2, if the list verdict allows it: merged; the three new failing-first cases (hook identities, team identity, table props on Applications and on Company Leads) failed before and pass after; all list tests and the list Playwright suites are green; L1 is re-measured; no design-system file changed. Otherwise marked "deferred until the list is next changed".
- [ ] M5-3, only if the wizard verdict is act: one fix (W-a or W-b) merged with its tests, W1/W2 lower after than before, and `PublicApplyHandler.jsx` still under 500 lines. Otherwise marked "watch" or "closed" with the numbers.
- [ ] No React Compiler, no new dependency and no new `eslint-disable` came in under this task.
