# M3a. Signing room: run the independent server steps side by side

[← Plan, progress and owner decisions](README.md) · Checked at commit `11626a6` on 2026-11-03; re-check line numbers against the current `main` before you start.

- **Checklist item(s):** #16 — Run independent requests in parallel (`getPublicEnvelope` rate limits and reads; `submitPublicEnvelope` signature uploads)
- **Size:** M · **Pull requests:** 1 · **Depends on:** none · **Owner decision needed:** none
- **Why it matters for users:** Before a signer, often on a phone, sees the document, the server makes about six database round trips one after another; about half of them can run at the same time (an estimate, not a measurement). On submit, each drawn signature or initial is saved one after another, and they can be saved together. The change also closes a gap: today a submission that carries an unknown field can leave signature images saved before it is refused. After this change nothing is saved until every field has been checked.

## Current behaviour (verified at 11626a6)

- `functions/publicSigning.js`, `getPublicEnvelope` (58-167):
  - It awaits the per-envelope limit (69-70; 30 per 300 s, `'closed'`), then the per-IP limit (72-74; 100 per 300 s, `'closed'`).
  - Each `checkRateLimit` is its own Firestore transaction on its own `rate_limits/{key}` document. It returns `false` without counting when the limit is exceeded, and with `'closed'` also on any error (`functions/shared/rateLimiter.js:13-62`); it never rejects.
  - Then come the envelope get (78), the not-found check (80), the token get (85), the constant-time compare (87-93), the status and expiry checks (95-111), and a one-hour signed URL (113-127).
- Tests (`functions/test/unit/publicSigning.get.test.js`): the file uses `jest.resetAllMocks()` with defaults restored (46-75). A per-envelope refusal reads nothing (241-247), a per-IP refusal reads nothing (249-257), and the limit keys are pinned (259-263). The doubles answer the limits in call order, envelope first (`mockResolvedValueOnce`).
- A precedent for two fail-closed limits in parallel: `functions/drafts/save.js:327-338` (`(await Promise.all([...])).every(Boolean)`).
- `submitPublicEnvelope` (170-378):
  - It checks the limit (175), then a transaction claims `'processing'` (193-222).
  - A `for…of` over the submitted values (232-249) checks each id (233-235) and saves each `data:image` PNG to `secure_documents/{companyId}/signatures/{requestId}_{key}.png` with an `await` inside the loop (237-245). The saves are sequential, and an unknown id later in the object is refused only after earlier images were saved.
  - On any error the status rolls back to `'sent'` (361-371).
  - Drawn signatures are real data URLs (`src/features/signing/components/SignatureSheet.jsx:123-126`).
  - `functions/test/unit/publicSigning.submit.test.js` covers unknown ids (144-161) but no image saving. It uses `jest.clearAllMocks()` (55), which does not reset implementations, and module-scope `jest.fn().mockResolvedValue` defaults (13-41).

## Scope

- In:
  - `getPublicEnvelope`: the two limits run together (both must pass, with the same refusal messages and precedence), then the envelope and token reads run together, before any check.
  - `submitPublicEnvelope`: every submitted id is checked first, then the images are saved side by side, at most 4 at a time.
- Out (do not do in this task):
  - The limits, keys, windows and fail-closed behaviour.
  - The token check, the status, expiry and signed-URL steps, and their order.
  - The double-submit transaction (its two reads could become one `txn.getAll`, but it stays as written).
  - The per-IP key source (`request.rawRequest?.ip` at 72, while submit's audit uses `trustedClientIp`). That is a separate security decision.
  - `cleanupOrphanedSignatures` (it retries only deletions recorded after sealing, `functions/digitalSealing.js:284-291`).

## Read first

- `AGENTS.md`, `.claude/skills/implement/SKILL.md`, and the Jest section of `.claude/rules/testing.md`.
- `docs/APP_BRIEF.md` §4 E-documents and signing and Date Signed (285-300), §10 (App Check is absent; rate limiting is a compensating control) and §9 (callable names are a contract).
- `docs/security-posture.md` (rate-limit controls) and `functions/drafts/save.js:315-338`.

## Implementation steps

1. Tell the owner, in Russian. Suggested text: «Страница подписи документа станет открываться немного быстрее, а подписи сохраняться одновременно. Лимиты защиты, проверка ссылки и даты подписи остаются прежними.»
2. If `functions/node_modules` is missing, run `npm ci` in `functions/`. Write the failing tests first (see Tests) and confirm that they fail on the current code.
3. In `getPublicEnvelope`, replace lines 69-74 with the code below. Keep the A2 comment (66-68) and add: both limits count this request and both must allow it; each is its own transaction on its own document, so they run side by side, as in `drafts/save.js`. A request refused per envelope now also counts toward its network's limit, which only makes the pair stricter.
   ```js
   const ip = request.rawRequest?.ip || 'unknown';
   const [okEnvelope, okIp] = await Promise.all([
     checkRateLimit(`envelope_read_${requestId}`, 30, 300, 'closed'),
     checkRateLimit(`envelope_read_ip_${ip}`, 100, 300, 'closed'),
   ]);
   if (!okEnvelope) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait and retry.');
   if (!okIp) throw new HttpsError('resource-exhausted', 'Too many requests from this network.');
   ```
   The array order keeps the envelope limit as the first call, which the existing `mockResolvedValueOnce` doubles rely on.
4. In the same `try`, replace lines 78 and 85 with `const secretRef = docRef.collection('secrets').doc('token'); const [docSnap, secretSnap] = await Promise.all([docRef.get(), secretRef.get()]);` placed before line 80. Keep the order of decisions: not-found (80), the token fallback and compare (86-93), signed or voided, expiry, storage path, then signing. A missing envelope still answers `not-found` before any token comparison, and no data leaves before the compare.
5. In `submitPublicEnvelope`, replace lines 232-249:
   ```js
   const submitted = Object.entries(normalizedFieldValues);
   // Every id is checked before anything is saved: a refused submission leaves no image behind.
   for (const [key] of submitted) {
     if (!allowedFieldIds.has(key)) throw new HttpsError('invalid-argument', `Invalid field id submitted: ${key}`);
   }
   // Each image is its own object, so they are saved side by side, a few at a
   // time: nothing caps how many fields an envelope has or how large an image is.
   const saveValue = async ([key, value]) => {
     if (typeof value !== 'string' || !value.startsWith('data:image')) return [key, value];
     const buffer = Buffer.from(value.split(';base64,').pop(), 'base64');
     const filePath = `secure_documents/${companyId}/signatures/${requestId}_${key}.png`;
     await bucket.file(filePath).save(buffer, { metadata: { contentType: 'image/png' } });
     return [key, filePath];
   };
   for (let i = 0; i < submitted.length; i += SAVES_AT_ONCE) {
     const settled = await Promise.allSettled(submitted.slice(i, i + SAVES_AT_ONCE).map(saveValue));
     const failed = settled.find((r) => r.status === 'rejected');
     if (failed) throw failed.reason;
     settled.forEach(({ value: [key, value] }) => { finalValues[key] = value; });
   }
   ```
   Add `const SAVES_AT_ONCE = 4;` at module scope. No limit bounds the saves today: the callable is `onCall({ cors: true })` (170), with the default memory and no size check of its own; an envelope's `fields` have no cap (the `signing_requests` create rule, `src/firestore.rules:354`, checks only the team, and the envelope creator sets none); and every allowed field id accepts a `data:image` value, not only signature fields (237). So the saves go in waves of 4, as `functions/bulkActions/helpers/recentlyMessaged.js:65-67` reads in waves, which also keeps at most 4 decoded buffers in memory at once. `finalValues` keeps the submitted order. Object names are unchanged, so a retry overwrites. A failed save reaches the existing `catch` and its rollback to `'sent'` only after every save in its wave has settled (`Promise.allSettled`, not `Promise.all`, which rejects at the first failure). No save from this attempt can therefore land after the rollback and overwrite a retry's image at the same name. Later waves do not start.
6. `publicSigning.js` is 378 lines and must stay under 500.
7. Open the PR with **Кратко**. Suggested text: «Страница подписи открывается немного быстрее: проверки лимитов и чтения на сервере идут одновременно. Рисованные подписи сохраняются одновременно, и ни одна не сохраняется, если в отправке есть неизвестное поле. Проверено: серверные тесты. Риск средний: это общий сервер Testing и Production, лимиты остаются строгими. От вас ничего не нужно.» Under what it touches: Cloud Functions `getPublicEnvelope` and `submitPublicEnvelope`; no callable contract, data shape, rules or CSP change. Record the counting decision under what changed and why.

## Tests

- `functions/test/unit/publicSigning.get.test.js`:
  - Starts both read limits before either answers: with `checkRateLimit.mockImplementation` returning deferred promises, both calls are made before either resolves. Fails before. Resolve both before the test ends.
  - Refuses with the per-envelope message when both refuse.
  - Counts the network limit even when the envelope limit refuses: two calls. This pins the new counting.
  - Reads the envelope and its token side by side, only after both limits pass: with `mockGet` deferred, `mockSecretGet` has already been called. Fails before.
  - Answers `not-found` for a missing envelope, with the token read made.
  - Never signs a URL for a wrong token: `mockGetSignedUrl` is not called.
  - The existing cases at 241-263 pass unchanged. Add `expect(mockSecretGet).not.toHaveBeenCalled()` to the two refusal cases.
- `functions/test/unit/publicSigning.submit.test.js`:
  - Give each new case its own recording `file(path).save` double through `firebaseAdmin.storage.bucket.mockImplementation(...)`, and put the default bucket implementation back in `beforeEach`; `clearAllMocks` does not, so a per-test implementation would leak. Do not queue `*Once` values; if one is needed, switch the file to `jest.resetAllMocks()` and restore every default it relies on (update, delete, save, bucket, `checkRateLimit`).
  - Saves every drawn signature side by side: two `data:image` fields with deferred saves, both started before either resolves. Fails before.
  - Saves at most 4 at a time: six `data:image` fields with deferred saves; exactly 4 saves start before any resolves, the other 2 only after the first 4 settle, and the update stores all six paths in submitted order.
  - Rolls back only after the wave settles: two `data:image` fields, the first save held open, the second rejected. The status update to `'sent'` has not run while the first save is pending; it runs once that save settles, and the error reaches the client.
  - Saves nothing when any submitted id is unknown: `{ sig1: 'data:image/png;base64,…', bogus: 'x' }` is rejected with `invalid-argument` and no save. Fails before, because `sig1` was saved first.
  - Stores each image's path as its value (`secure_documents/c1/signatures/r1_sig1.png`, with the file's own ids).
  - Rolls back to `'sent'` when a save fails.
- `functions/test/unit/signedDateEndToEnd.test.js`, `functions/test/unit/rateLimiter.test.js` and `functions/test/unit/mockResetHygiene.test.js` pass.

## Documentation to update in the same PR

- None in the brief, which does not describe this order. Record the counting decision in the code comment (step 3) and in the PR.

## Verify before opening the PR

- In `functions/`: `npm run lint`, then `npm test -- test/unit/publicSigning.get.test.js test/unit/publicSigning.submit.test.js test/unit/signedDateEndToEnd.test.js test/unit/rateLimiter.test.js test/unit/mockResetHygiene.test.js`, then the full `npm test`.
- At the root: `npm run check:function-exports`, `npm run check:source-size` and `node scripts/check-callable-contract.mjs`.
- Playwright: check that port 5000 is free, then run `npm run test:e2e -- --project=chromium e2e/edoc-recruiter-send-and-sign.spec.cjs`. It drives the signing room against served callables, so it guards the browser side only; say so in the PR.

## Verify after merge (on Testing, read-only)

- Watch the `main` run to completion and confirm that its Cloud Functions deploy step succeeded. These functions are shared with Production, so they are live for real signers at once.
- Nothing to click by default: opening a real link counts against its limits, and signing changes real data. If the owner sends themselves an envelope as part of normal work, they can open it on a phone and sign it. Otherwise rely on the tests.

## Risks and safeguards

- This is a public, unauthenticated path. Safeguards: both limits must pass and fail closed; the refusal messages and their precedence are unchanged; the reads happen only after both limits pass; nothing is returned before the token compare. The tests pin each of these.
- Counting: the network counter now rises even on a per-envelope refusal. That is stricter, never looser. Someone hammering one envelope can now use up a shared network's 100 reads in 5 minutes, but varying the request id already allowed that, and a normal signer is far below the limits.
- If one image save fails, the rollback to `'sent'` waits until the rest of its wave of 4 has settled, so none of them can finish after a retry has started; later waves do not start. Today the images saved before a failure also stay. A retry overwrites the same names, and nothing cleans up an abandoned failed submission today either.
- Rollback: revert the PR; the functions redeploy on merge.

## Done when (acceptance criteria)

- [x] The two read limits run together; a request passes only when both allow it, with the same messages and precedence.
- [x] The envelope and token reads run together after the limits; the decision order and the token-before-data rule are unchanged.
- [x] Submit checks every id before saving, then saves the images side by side, at most 4 at a time, in submitted order, and rolls back only after the whole wave has settled; a refused submission saves nothing.
- [x] The new tests fail on the old code and pass now; the functions tests, lint and guards pass.
- [ ] The `main` run's functions deploy succeeded; the PR starts with Кратко and records the counting decision.

As done (2026-11-04, batch C, on top of `0769266`). Every file:line in "Current behaviour" was re-checked: no commit since `11626a6` touched `functions/publicSigning.js`, its two test files, `shared/rateLimiter.js`, `drafts/save.js`, `recentlyMessaged.js`, `SignatureSheet.jsx` or `src/firestore.rules`, so the lines stand. One statement does not hold: `checkRateLimit` can reject. It builds `rate_limits/{key}` before its `try`, and a request id with one `/` or a `//` is not a document path (tried offline with the installed Firestore SDK). Implemented as the steps say, with these differences:
- **`Promise.allSettled` for the two limits and for the two reads, not `Promise.all`.** `settledValue(outcome)` returns the value or throws the error, and the outcomes are taken one by one in the old order, so every answer stays what it was even when one step throws. With `Promise.all`, a per-envelope refusal beside an error from the network limit would have become `internal`, and a missing envelope whose token read failed would have answered `internal` instead of `not-found`. One test pins each.
- **Only images take a place in a wave of 4.** In step 5's code every submitted entry took one, so typed values between the images would have slowed the saves. The first loop checks every id and fills `finalValues` in submitted order; then only the `data:image` entries are saved, in waves of `SAVES_AT_ONCE = 4`, and each path replaces its data URL in place, so the stored key order is unchanged. A failed wave throws its first rejection in submitted order, the error the old loop met first.
- **"A refused submission saves nothing"** holds for an unknown id and for every refusal before the claim (limit, not found, wrong token, expired, already submitted). A missing required field is still found after the images are saved, and rolls back, as before: that check reads the saved values, and moving it is out of scope.
- **Tests beyond the list**, passing before and after unless marked: the two existing limit refusals also pin their messages and that the token was not read; a network-limit error does not replace the envelope refusal; an envelope-limit error passes on with nothing read; a missing envelope answers `not-found` even when its token read fails; a failed envelope or token read answers `internal` and signs nothing; a wrong token on a sent, signed or voided envelope is refused with no URL; the token kept on older envelopes is still accepted; missing data or parameters are refused before either limit counts; an envelope with no file, and a link that cannot be signed, keep their answers. In submit: typed values between the images keep their order and take no place in a wave (fails before); every refusal before the claim saves and writes nothing; a missing required field still rolls back.
- Fails before (the tests against `HEAD`'s `publicSigning.js`, restored after): 9 failed and 45 passed, each failure for the expected reason. The limits made 1 call where 2 were expected (twice); the token read had 0 calls where 1 was expected (twice); 1 save had started where 2 or 4 were expected (three times, the third the typed-values case); the rollback case found 1 save where it expected 2; the unknown-id case found `sig1` already saved. Thirteen mutations, each undone, failed at least one test: limits through `Promise.all`; limits one after the other; the network refusal checked first; reads through `Promise.all`; reads one after the other; reads started beside the limits; the token outcome taken before `not-found`; a wave through `Promise.all`; waves of 5; waves of 3; waves over every entry; ids checked after saving; image paths stored after the typed values.
- Checks: in `functions/`, `npm run lint` passed, the five suites the task names passed (63 tests), and `npm test` passed (239 suites, 3,407 tests). At the root, `check:source-size` (`publicSigning.js` 378 → 406 lines; 7 warnings, none in a changed file), `check:function-exports` (169 mapped), `node scripts/check-callable-contract.mjs` (116 callables), `check:agent-docs` (the brief's two warnings, as before) and `check:public-claims` passed. Playwright was not run: `e2e/edoc-recruiter-send-and-sign.spec.cjs` signs through `e2eSign=mock`, a browser-side double, so no browser suite reaches these functions. CI runs it.
- Brief: unchanged, as "Documentation to update" says; it describes neither this order nor when images are saved.
