# Production readiness audit report

**Audit date:** 2026-05-21  
**Project:** `truckerapp-system` ([.firebaserc](../.firebaserc))  
**Production URL:** https://truckerapp-system.web.app  
**Auditor:** Cursor agent (automated + live smoke)

---

## Executive summary

| Verdict | **Conditional go** |
|---------|-------------------|
| Automated gates | **Pass** — lint, 217 Vitest, 129 Jest, callable contract (50), production build, 13/13 Chromium E2E |
| Security rules (emulators) | **Blocked** — Java not on PATH; emulator rules tests not executed |
| Cloud parity | **Pass** — guest callables deployed; rules compile on dry-run; production bundle includes `getSignedGuestUploadUrl` |
| Live production smoke | **Partial pass** — guest intake UI, invalid slug (G3); full upload/submit not run on live tenant (avoid test data in real company) |
| Manual UI/UX (devices) | **Pending** — requires human QA on iOS/Android and Slow 3G |

**Recommendation:** Safe to ship **backend/functions** changes already deployed (`getSignedGuestUploadUrl`, App Check removal). Deploy **hosting** if local `dist` is ahead of `index-B4PCKd3D.js` (verify after your next `main` push). Complete emulator rules tests after installing Java, and finish [QA_STAGING_SIGNOFF.md](QA_STAGING_SIGNOFF.md) on real devices before calling production “fully signed off.”

---

## 1. Environment (Tier 0)

| Check | Result |
|-------|--------|
| Firebase CLI project | **Pass** — `npx firebase use` → `truckerapp-system` |
| Firebase login | **Pass** — logged in (account present) |
| `.env` | **Missing** — use `.env.local` instead |
| `.env.local` | **Pass** — all `VITE_FIREBASE_*` populated; `VITE_SENTRY_DSN`, `PROCESS_BULK_BATCH_URL`, optional integrations set |
| `functions/.env` | **Fail** — file missing (local Functions/emulator Groq/bulk worker secrets) |
| Legacy `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in `.env.local` | **Info** — unused by app; safe to remove for clarity |
| App Check Console (Unenforced) | **Manual** — confirm in Firebase Console per [security-posture.md](security-posture.md) |

---

## 2. Automated results (Tier 1)

| Gate | Result | Notes |
|------|--------|-------|
| `npm run lint` | **Pass** | Frontend + functions |
| `npm test -- --run` | **Pass** | 217 passed, 18 skipped (rules tests) |
| `cd functions && npm test` | **Pass** | 129 passed |
| `node scripts/check-callable-contract.mjs` | **Pass** | 50 frontend callables verified |
| `npm run build` | **Pass** | Chunk size warnings only (main ~974 kB gzip 312 kB) |
| `npm run test:e2e -- --project=chromium` | **Pass** | 13/13 |

**App Check regression focus:** `getSignedGuestUploadUrl` exported, unit-tested, referenced from `PublicApplyHandler`; no App Check in local `dist` bundle.

---

## 3. Security rules — emulators (Tier 2)

| Check | Result |
|-------|--------|
| `firebase emulators:start --only firestore,storage` | **Fail** — `Could not spawn java -version` |
| `firestore.rules.security.test.js` | **Skipped** (no emulator host) |
| `storage.rules.security.test.js` | **Skipped** (no emulator host) |

**Remediation:** Install JDK 17+, add `java` to PATH, re-run:

```powershell
npx firebase emulators:start --only firestore,storage
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST="127.0.0.1:9199"
npm test -- --run src/tests/firestore.rules.security.test.js src/tests/storage.rules.security.test.js
```

Repo rules already updated for guest writes **without** App Check (see [storage.rules](../src/storage.rules), [firestore.rules](../src/firestore.rules)).

---

## 4. Cloud parity — read-only (Tier 3)

| Check | Result |
|-------|--------|
| Firestore + Storage rules dry-run | **Pass** — compile successfully |
| Firestore indexes dry-run | **Pass** |
| Deployed callables | **Pass** — `getSignedUploadUrl`, `getSignedGuestUploadUrl`, `submitGuestApplication` (v1, us-central1) |
| Production hosting bundle | **Pass** — `PublicApplyHandler-CNgaasEm.js` contains `getSignedGuestUploadUrl`; no `initializeAppCheck` in probed assets |
| Hosting site | **Pass** — `truckerapp-system.web.app` |
| `npm run deploy:functions:plan` | **N/A** — strict mode, no git range (not a git repo / no base ref) |
| `runSecurityAudit` snapshot | **Manual** — run from Super Admin System Health step 17 when logged in |

---

## 5. Live smoke results (Tier 4)

Test URL: https://truckerapp-system.web.app

| ID | Scenario | Result | Evidence |
|----|----------|--------|----------|
| L1 | Guest upload + preview | **Not run** | Avoid writing files to live `wenzellc` tenant; E2E covers upload path |
| L2 | Guest submit | **Not run** | Same; E2E `public-application.spec.cjs` passes full wizard |
| L3 | Rate limit sanity | **Not run** | Requires controlled burst against production |
| L4 | Callable / no App Check errors | **Pass** | Production console: no App Check / reCAPTCHA errors on `/apply/wenzellc` |
| L5 | System Health wizard | **Manual** | Super Admin only |
| L6 | E-Doc public sign | **Partial** | E2E `edoc-recruiter-send-and-sign` pass; live sign not re-run |
| — | Valid company intake UI | **Pass** | `/apply/wenzellc` — intake chooser + Step 1 wizard |
| — | Invalid slug (G3) | **Pass** | `/apply/bad-slug-audit-test` → “Company not found.” |
| — | Invalid E2E slug on prod | **Pass** | `/apply/e2e-company` → “Company not found.” (expected; E2E company is local-only) |

---

## 6. UI/UX matrix (Tier 5)

Mapped to [QA_STAGING_SIGNOFF.md](QA_STAGING_SIGNOFF.md). **Automated proxy** = covered by E2E or live smoke above.

### Guest (G1–G5)

| ID | Status | Notes |
|----|--------|-------|
| G1 | **Pending** | Slow 3G + real device — manual |
| G2 | **Partial** | Live Step 1 + date triplet UI OK; iOS/Android file upload — manual |
| G3 | **Pass** | Live invalid slug |
| G4 | **Pending** | Inactive company — manual |
| G5 | **Pass (E2E)** | `guest-post-application-edoc.spec.cjs` |

### Authenticated driver (A1–A5)

| ID | Status | Notes |
|----|--------|-------|
| A1 | **Pending** | Manual |
| A2 | **Pass (E2E)** | `guest-draft-resume`, `authenticated-driver-application` |
| A3 | **Pass (E2E)** | `guest-application-intake` |
| A4 | **Partial (E2E)** | Auth wizard paths in E2E |
| A5 | **Pass (E2E)** | `guest-offline-queue` |

### E-Docs (E1–E9)

| ID | Status | Notes |
|----|--------|-------|
| E1 | **Pending** | Manual 20+ fields |
| E2 | **Pending** | Manual locked fields |
| E3–E4 | **Pending** | Manual void/expired |
| E5 | **Pending** | Manual SMS/email flags |
| E6 | **Pending** | Manual resend |
| E7 | **Pending** | Manual mobile signing |
| E8 | **Pending** | Manual sealing failure |
| E9 | **Pending** | Manual feature flag |

**Commit-ready bar from sign-off doc:** G1, G3, A3, E1, E2, E7 — **2/6 automated/partial**, **4 require manual QA**.

---

## 7. Findings

| ID | Severity | Component | Finding | Recommendation |
|----|----------|-----------|---------|----------------|
| F1 | **Medium** | Local dev | `functions/.env` missing | Copy `functions/.env.example` → `functions/.env` and fill secrets for local Functions |
| F2 | **Medium** | CI / audit | Firebase emulators require Java | Install JDK; re-run rules security tests before release |
| F3 | **Low** | Env hygiene | `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` still in `.env.local` | Remove unused key (App Check removed) |
| F4 | **Low** | Deploy tooling | `deploy:functions:plan` needs git range or `DEPLOY_FUNCTIONS_FORCE_FULL=1` | Initialize git or set env when using incremental deploy script |
| F5 | **Low** | Performance | Main bundle > 500 kB | Consider code-splitting (non-blocking) |
| F6 | **Info** | Manual QA | Device matrices incomplete | Schedule QA session per sign-off doc |
| F7 | **Info** | Console | App Check enforcement state not CLI-verified | Confirm Unenforced in Firebase Console |

### Accepted risks

| ID | Risk | Status |
|----|------|--------|
| R1 | No Firebase App Check | **Accepted** — [security-posture.md](security-posture.md) |
| R2 | Public guest callables (rate limits + path validation) | **Accepted** — documented compensating controls |

---

## 8. Remediation backlog (priority)

1. Install Java and run emulator rules tests (F2).
2. Add `functions/.env` for local backend work (F1).
3. Complete manual QA sign-off on staging/production (F6) — especially G1, G2, G4, E1, E2, E7.
4. Confirm App Check Unenforced in Console (F7).
5. Remove legacy reCAPTCHA env var (F3).

---

## 9. Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Engineering (automated) | Cursor agent | 2026-05-21 | Conditional go |
| QA (devices / 3G) | _Pending_ | | |
| Engineering (final) | _Pending_ | | |

---

## Appendix: Commands run

```powershell
npx firebase use
npm run lint
npm test -- --run
cd functions; npm test
node scripts/check-callable-contract.mjs
npm run build
npm run test:e2e -- --project=chromium
npx firebase functions:list --project truckerapp-system
npx firebase deploy --only firestore:rules,storage --project truckerapp-system --dry-run
npx firebase deploy --only firestore:indexes --project truckerapp-system --dry-run
```

Live checks: https://truckerapp-system.web.app/apply/wenzellc , `/apply/bad-slug-audit-test`
