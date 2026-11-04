# M3b. Campaign launch: check hand-picked leads and split queries side by side

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #16 — Run independent requests in parallel (`functions/bulkActions/controllers/session/gatherTargets.js`)
- **Size:** S · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** When an admin launches a campaign to hand-picked leads, the server checks that each lead belongs to the company with up to 34 database queries, one after another. With Not contacted since, it also runs its two audience queries one after another. Running them in waves of ten, and the two together, makes the launch start sooner. Who receives the messages does not change.

## Current behaviour (verified at 11626a6)

- `gatherTargets.js:29-71` (`verifyDirectSelection`, the BULK-2 ownership gate):
  - It allows at most 500 ids (34-37).
  - For `applications` and then `leads` (40-44), in chunks of 30 (46-48), each `await …where(documentId(), 'in', chunk).select().get()` (49-53) runs in series: up to 17 × 2 = 34 queries.
  - A failed chunk is logged and its ids are dropped (55-57).
  - The result keeps the caller's order (62). None owned gives `permission-denied` (67-69).
- `gatherTargets.js:77-140` (`gatherIdsFromQueries`):
  - `buildLeadQueries` returns one query, or two when Not contacted since splits it (`functions/bulkActions/helpers/queryBuilder.js:64-67, 108-127`; the split is its only one).
  - It runs them in series to identify which one fails (88-99).
  - A failure becomes `HttpsError('internal', 'Query execution failed: …')` (137-139).
- The only caller is `initBulkSession` (`functions/bulkActions/controllers/sessionController.js:43, 53`), after RBAC (27) and a fail-closed rate limit (32-35), with a 540 s timeout (16).
- The wave pattern is already in the repo: `functions/bulkActions/helpers/recentlyMessaged.js:14-17, 63-74` (10 in flight) and `src/features/company-admin/hooks/leadImportMatches.js:4-7, 41-43`.
- `functions/test/unit/sessionController.directSelection.test.js:164-221` pins ownership by document id, the oversized refusal and the none-owned refusal. Its double builds a new query chain on every `collection('applications'|'leads')` call (80-91), and its `get` reads the chunk at call time (43-60), so it already serves parallel lookups that each build their own chain.

## Scope

- In: `verifyDirectSelection` runs its chunk queries in waves of 10; `gatherIdsFromQueries` runs its 1–2 queries together; a new test file.
- Out (do not do in this task):
  - The 500-id ceiling, the 30-value chunks, the `select()` projections, the recently-messaged exclusion, Limit Volume and the import branch.
  - `sessionController.directSelection.test.js`'s double, which needs no change.
  - `functions/hrAdmin/membership.js`, which M1a covers because it rewrites the same lines.

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md` and the Jest section of `.claude/rules/testing.md`.
- `docs/APP_BRIEF.md` §8 Bulk campaigns (the 2,000 launch limit and the exclusion rule) and §6 (tenant isolation).
- `functions/bulkActions/helpers/recentlyMessaged.js:55-74`.

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «Запуск кампании по выбранным вручную лидам будет проверять их быстрее (пачками одновременно). Кто получит сообщения — не меняется.»
2. If `functions/node_modules` is missing, run `npm ci` in `functions/`. Write the failing tests first, in a new file `functions/test/unit/gatherTargets.parallel.test.js`:
   - Require `../../bulkActions/controllers/session/gatherTargets`.
   - Mock `firebase-functions/v2/https` as the sibling suites do, and `../../firebaseAdmin` with `admin.firestore.FieldPath.documentId` and a `db` whose queries record their chunk and return deferred results.
   - Mock `../../bulkActions/helpers/queryBuilder` (`buildLeadQueries`) and `../../bulkActions/helpers/recentlyMessaged` (`excludeWindow`, `recipientsMessagedWithin`).
   - Follow the mock-reset rule, and settle every deferred inside its test.
3. In `verifyDirectSelection`, replace lines 39-59 with the code below, keeping the BULK-2 comments:
   ```js
   const collections = ['applications', 'leads'];
   const CHUNK = 30; // Firestore 'in' takes at most 30 values
   const QUERIES_AT_ONCE = 10; // as recentlyMessaged.js
   const lookups = [];
   for (const name of collections) {
     for (let i = 0; i < targetIds.length; i += CHUNK) lookups.push({ name, chunk: targetIds.slice(i, i + CHUNK) });
   }
   const verifiedIds = new Set();
   for (let i = 0; i < lookups.length; i += QUERIES_AT_ONCE) {
     const wave = lookups.slice(i, i + QUERIES_AT_ONCE);
     await Promise.all(wave.map(async ({ name, chunk }) => {
       try {
         const snap = await db.collection('companies').doc(companyId).collection(name)
           .where(admin.firestore.FieldPath.documentId(), 'in', chunk).select().get();
         snap.forEach((d) => verifiedIds.add(d.id));
       } catch (queryErr) {
         console.warn(`[BULK-2] Ownership check query failed for ${name}:`, queryErr.message);
       }
     }));
   }
   ```
   Lines 34-37 and 61-70 stay as they are. Keep each query in one expression, from `collection(name)` to `.get()`.
4. In `gatherIdsFromQueries`, replace lines 88-99:
   - `const settled = await Promise.allSettled(selectQueries.map((q) => q.get()));`
   - Log each result by its index with today's text (`Query #i returned N docs.` or `Query #i failed:`).
   - `const failed = settled.find((r) => r.status === 'rejected'); if (failed) throw failed.reason;` This reports the lowest-numbered failure, as the series did.
   - `const snapshots = settled.map((r) => r.value);` keeps the queries' order, so the candidate map fills as before.
   - Update the comment at 88.
5. Open the PR with **Кратко**. Suggested text: «Запуск кампании по выбранным вручную лидам проверяет их принадлежность компании пачками по 10 запросов одновременно, а не по одному. Получатели и проверки не меняются. Проверено: серверные тесты. Риск низкий; общий сервер (Testing и Production сразу). От вас ничего не нужно.»

## Tests

- `functions/test/unit/gatherTargets.parallel.test.js` (new):
  - With 500 ids: 34 queries (17 per collection), 10 in flight in the first wave, and never more than 10. Fails before (1 in flight).
  - Keeps only owned ids, in the caller's order.
  - A failing chunk drops only its own ids and warns with the BULK-2 text.
  - None owned still gives `permission-denied`.
  - With two queries, both `.get()` calls start before either resolves. Fails before.
  - The ids and their order equal what the series produced.
  - Query #1 failing gives `internal` with #1's message; both failing gives #0's message.
- Existing suites pass: `test/unit/sessionController.directSelection.test.js`, `test/unit/sessionController.phoneCompat.test.js`, `test/bulkActions.session.test.js` and `test/bulkActions.filters.test.js`.

## Documentation to update in the same PR

- None. APP_BRIEF §8 Bulk campaigns describes limits and exclusions, not query order, and stays true.

## Verify before opening the PR

- In `functions/`: `npm run lint`, then `npm test -- test/unit/gatherTargets.parallel.test.js test/unit/sessionController.directSelection.test.js test/unit/sessionController.phoneCompat.test.js test/bulkActions.session.test.js test/bulkActions.filters.test.js test/unit/mockResetHygiene.test.js`, then the full `npm test`.
- At the root: `npm run check:function-exports` and `npm run check:source-size`.
- No Playwright suite reaches this code, because the campaign specs serve the callables in the browser. Say so in the PR.

## Verify after merge (on Testing, read-only)

- Watch the `main` run and confirm that its Cloud Functions deploy step succeeded. `initBulkSession` is live for Production users at once.
- Do not launch a test campaign: it sends real messages. If the owner launches a hand-picked campaign as part of normal work, it should start as before, only sooner.

## Risks and safeguards

- Up to 10 concurrent queries per launch: the same reads in total, a pattern already used in `recentlyMessaged.js`.
- The IDOR gate is unchanged: only ids found under the company's own path count.
- When query #0 fails, query #1 now also runs and logs its own line before the error is reported. The outcome is the same.
- Rollback: revert the PR.

## Done when (acceptance criteria)

- [x] Ownership checks run in waves of at most 10; the results, order, warnings and refusals are unchanged.
- [x] The split audience queries run together, and the reported error is the lowest-numbered failure.
- [x] The new tests fail on the old code; all functions tests and lint pass.
- [ ] The `main` run's functions deploy succeeded; the PR starts with Кратко.

As done (2026-11-04, batch C, on top of `62d76e1`). Every file:line in "Current behaviour" was re-checked: no commit since `11626a6` touched `gatherTargets.js`, `queryBuilder.js`, `recentlyMessaged.js`, `leadImportMatches.js` or `sessionController.directSelection.test.js`, so their lines stand. `sessionController.js` changed only in `retryFailedAttempts` (T4.2); lines 16, 27, 32-35, 43 and 53 stand. In the brief, "Bulk campaigns" is 1062-1078 and §6 starts at 872. Implemented as steps 3 and 4 say, with these differences:
- **Each collection's reference is built once, before the waves and outside the `try`, as before**, and its lookups share it; step 3 built it inside each lookup's `try`. `doc(companyId)` throws at once for a company id that is not a non-empty string. The old code let that error out as it is (the caller gets `internal`). Inside the `try`, every lookup would fail on its own and the answer would become `permission-denied`. A super admin can reach this with a numeric id: `assertCompanyAccess` returns before reading the company, and `bulk_init_42` is a valid rate-limit path. Firestore queries are immutable, so a shared reference is safe. The existing suite's double also still works, because its `get` reads the chunk when called.
- **`selectQueries.map(async (q) => q.get())`**, not `(q) => q.get()`. A query that throws as it starts becomes its own failure, logged with its number, and a lower-numbered failure still wins, as in the series. Called bare, such a throw would skip every log, report its own error over a lower-numbered one, and leave the reads already started unwatched. Firestore's `Query.get()` is `async`, so this is only a guard.
- **Tests beyond the list**, each passing before and after: more than 500 ids is refused before any lookup; every lookup failing gives `permission-denied`; a company path that cannot be built throws as it is, with no lookup and no warning. The 500-id case also checks that every lookup asks `companies/company-1/<collection>` by `__name__` `in`, 30 ids in the caller's order, with an empty `select()`. In gather: the five recipients reach `recipientsMessagedWithin` in query order, with the window and channel; Limit Volume breaks a tie between the two queries as the series did; the logs come in query order; a query that throws as it starts loses to query #0's failure; a single query reads once.
- Fails before (the new tests against `62d76e1`'s `gatherTargets.js`): 2 failed and 11 passed, each failure for the expected reason. The 500-id case waited 34 times on 1 lookup, not `[10, 10, 10, 4]`. The two-query case waited twice on 1 query, not once on 2. Ten mutations, each undone, failed at least one test: all 34 lookups at once; waves of 11; waves of 9; one lookup a wave; step 3's code as written (the path case); the filter queries through `Promise.all` (3 cases, via the logs and #0-first); the last failure reported (2); no `async` wrapper (1); snapshots in the order the queries answered (4); the series put back (1).
- Checks: in `functions/`, `npm run lint` passed, the six suites the task names passed (42 tests), and `npm test` passed (241 suites, 3,437 tests). At the root, `check:source-size` (`gatherTargets.js` 145 → 155 lines; 7 warnings, none in a changed file), `check:function-exports` (169 mapped), `node scripts/check-callable-contract.mjs` (116 callables), `check:agent-docs` (the brief's two warnings, as before) and `check:public-claims` passed. Playwright was not run: `e2e/campaign-launchpad.spec.cjs` launches through `e2eCampaign=mock`, which never calls `initBulkSession`, so no browser suite reaches this code. CI runs it.
- Brief: unchanged, as "Documentation to update" says. It describes limits and exclusions, not the order of reads. `M4-applications-list-payload.md` now points at `gatherTargets.js:59, 91-92` for the `select()` pattern, which this change moved.
- Open box: the deploy check and the Кратко belong to the batch PR.
