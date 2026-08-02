# Driver Application and E-Doc Staging QA Sign-Off

Run on **staging** after automated tiers 1–4 pass on CI. Record date, tester, environment URL, and pass/fail per row.

## Guest application (G1–G5)

| ID | Scenario | UI check | Backend check | Pass | Tester / Date |
|----|----------|----------|---------------|------|---------------|
| G1 | Real device, Slow 3G, full apply | No duplicate confirmations | One `applications` doc per applicant | ☐ | |
| G2 | iOS Safari + Android Chrome | Date triplet, file picker, signature canvas; upload preview via signed URL callable | Uploads in `guest_uploads` (no App Check) | ☐ | |
| G3 | Invalid slug `/apply/bad-slug` | Clear error, no wizard crash | No writes | ☐ | |
| G4 | Company inactive | Friendly block before submit | `assertCompanyAcceptingIntake` error | ☐ | |
| G5 | Post-application E-Doc | All field types fillable; locked fields read-only | `signing_requests` → `pending_seal` → `signed` | ☐ | |

## Authenticated driver (A1–A5)

| ID | Scenario | Pass | Tester / Date |
|----|----------|------|---------------|
| A1 | Apply from public application link (`/apply/:slug`) with `pending_application_company` in session | ☐ | |
| A2 | Save & Exit mid-wizard → dashboard → resume | ☐ | |
| A3 | Custom questions required → cannot skip dynamic step | ☐ | |
| A4 | Modal wizard (`isOpen`) vs full-page route — both paths | ☐ | |
| A5 | Network flap on final submit → queue or clear error | ☐ | |

## E-Docs (E1–E9)

| ID | Scenario | Fill/sign | Backend | Pass | Tester / Date |
|----|----------|-----------|---------|------|---------------|
| E1 | Template with 20+ fields across 3 pages | Scroll/zoom; all fields reachable | All `fieldValues` persisted | ☐ | |
| E2 | Locked prefill fields | Cannot edit locked text/date | Submit accepts locked values | ☐ | |
| E3 | Voided envelope | Signing room shows voided | Status `voided`; submit rejected | ☐ | |
| E4 | Expired token | Clear message | `getPublicEnvelope` failed-precondition | ☐ | |
| E5 | Email + SMS delivery flags | N/A | `notifySigner` / SMS callable | ☐ | |
| E6 | Correct sent envelope | Creator reopens; resend | New request or updated fields | ☐ | |
| E7 | Mobile signing | Pinch/zoom PDF; tap targets | Signature PNGs in Storage | ☐ | |
| E8 | Sealing failure recovery | User sees error state | `error_sealing` doc; admin retry | ☐ | |
| E9 | `eDocs` feature off | FeatureLockedModal | No accidental sends | ☐ | |

## Commit-ready bar (staging once)

- [ ] G1, G3, A3 completed
- [ ] E1, E2, E7 completed
- [ ] Automated: `npm test -- --run`, `cd functions && npm test`, rules tests with emulators, `npm run test:e2e -- --project=chromium`

## Sign-off

| Role | Name | Date |
|------|------|------|
| QA | | |
| Engineering | | |
