# Issues To Address — SafeHaul

This document consolidates the issues discovered during the audit and provides practical, non-destructive remediation guidance and best-practices for each item. For each issue: Summary, Impact, Verification, Non-destructive mitigation steps, Testing & rollback, and Estimated effort.

---

## 1. Employer field name mismatches
Summary: Multiple components and exporters use different keys for employer entries (e.g., `companyName` vs `name`, `street` vs `address`, `reason` vs `reasonForLeaving`).
Impact: Incorrect rendering in admin UI, missing data in PDFs, and inconsistent search/indexing.
Verify: Inspect `src/features/driver-app/components/application/steps/Step6_Employment.jsx`, `src/shared/utils/pdf/pdfSections.js`, `src/features/company-admin/components/modals/driver-dossier/tabs/ApplicationTab.jsx`.
Mitigation (safe):
- Reader fallbacks: update renderers to prefer canonical key and fall back to legacy keys, e.g. `const companyName = emp.companyName || emp.name || emp.company || ''`.
- Dual-write: update writers (imports, `guestApplication`, admin forms, `driverSync`) to write canonical keys in addition to legacy keys.
- Backfill: create an idempotent backfill job that only sets missing canonical keys (example implemented in `functions/backfillEmployerFields.js`). Run dry-run first.
Testing & rollback: dry-run → staging run → sample production slice → full run. Keep legacy fields during rollout and remove only after long validation and retention policy.
Effort: Small-medium (1–3 dev days including backfill testing).

---

## 2. CDL expiration badge showing `--`
Summary: Renderer uses `appData.cdlExpiration || appData.cdlExpirationDate` and expects a date; mismatch of field name or Firestore Timestamp vs ISO string can yield invalid Date.
Impact: False-negative “unknown” badges in admin UI.
Verify: `src/features/company-admin/.../ApplicationTab.jsx` logic that computes `expDate` and `daysUntilExp`.
Mitigation:
- Normalize stored dates on ingest (timestamp or ISO) using helper `toDateOrNull(value)`.
- Reader sanity: treat Firestore Timestamps (`val.toDate`) and strings consistently.
Testing: Unit tests for date parsing; sample documents with both timestamp and string.
Effort: Small (half-day).

---

## 3. SchemaRenderer cannot render array sections / missing file-type rendering
Summary: The schema renderer lacks robust array and file-upload rendering paths.
Impact: Complex form sections (employment history, file uploads) may render incorrectly.
Verify: `SchemaRenderer` and `DynamicQuestionRenderer.jsx` (file uploads handled in `DynamicQuestionRenderer`).
Mitigation:
- Add explicit handlers for `type: 'array'` and `type: 'file'` that map to `DynamicRow` and file preview components.
- Ensure `file` type rendering uses `fileUrls` passed from backend or resolves signed URLs via `getSignedUploadUrl`.
Testing: Add snapshot tests and manual QA with sample schema sections.
Effort: Medium (1–2 dev days).

---

## 4. ExperienceTimeline shows incomplete employer fields
Summary: `ExperienceTimeline` renders only a subset of employer fields.
Impact: Missing information in summary views and exports.
Mitigation:
- Align `ExperienceTimeline` field mapping with canonical schema.
- Use `getFieldValue()` helper to handle multiple legacy key fallbacks.
Testing: Compare timeline output against `pdfSections` and `Step6_Employment` sample data.
Effort: Small.

---

## 5. Deterministic application ID mismatch (client vs server)
Summary: `functions/guestApplication.js` computes `applicationId` with SHA-256 and truncation; client-side `applicationId.js` must match exactly (same normalization and substring length).
Impact: Duplicate/unknown documents or inability to find existing applications.
Mitigation:
- Keep single source of truth for ID generation: centralize algorithm in a shared library (or copy identical logic into client & server and add unit tests ensuring equality).
- Do not change ID algorithm in-place; if changing, create `applicationIdV2` and backfill aliases.
Testing: unit tests that compute hash on client & server for identical inputs.
Effort: Small.

---

## 6. Placeholder email domain mismatch in imports and sync
Summary: Code checks for placeholder domains (e.g., `@placeholder.com`, `@system.local`) inconsistently.
Impact: Identity resolution failures and duplicate shadow profiles.
Mitigation:
- Standardize placeholder domains in a single config (e.g., `config/placeholderDomains.js`) and reference it in `driverSync`, import workers, and any onboarding code.
- Normalize email inputs (lowercase, trimmed) before checks.
Testing: import worker tests using representative CSV/Excel entries.
Effort: Small.

---

## 7. Phone validation rejects 11-digit US numbers
Summary: `src/shared/utils/validation.js` `isValidPhone` only accepts 10 digits.
Impact: Valid US numbers including leading `1` get rejected; imports and matching by phone can fail.
Mitigation:
- Accept 10 or 11 digits and normalize by removing leading `1` for US numbers. Provide `normalizePhone()` used across codebase.
- Update import workers and `driverSync` phone queries to use normalized phone field (e.g., `phoneNormalized`).
Testing: Unit tests for `formatPhone` and `isValidPhone` with variants.
Effort: Small.

---

## 8. `serviceAccountKey.json` not in `.gitignore` / secrets present
Summary: Sensitive keys should never be committed.
Impact: Security breach risk.
Mitigation:
- Ensure `.gitignore` contains `serviceAccountKey.json` and any `*-key.json` patterns.
- If keys are found in git history, rotate the key immediately and remove it from history via `git filter-repo` or `bfg`, then rotate credentials.
Testing: `git ls-files` + `git log --all --name-only` checks.
Effort: Small but high priority.

---

## 9. SSN printed unmasked in generated PDFs
Summary: `src/shared/utils/pdfGenerator.js` writes `applicant?.ssn` into PDFs, potentially unencrypted.
Impact: PII exposure and compliance violation.
Mitigation:
- Mask SSN by default in any PDF (e.g., show only last 4 digits). Use explicit opt-in to show full SSN in very limited contexts.
- Ensure backend stores SSN encrypted at rest (example: `driverSync` uses `encrypt(data.ssn)` for master profiles). Decrypt only in secure server contexts and never send plaintext to clients.
Testing: Unit tests confirm PDFs contain masked SSN; manual inspection of generated PDFs for sample data.
Effort: Medium (encrypt/decrypt + PDF change).

---

## 10. Firestore rules overly permissive for global leads update
Summary: Possibly permissive rules left over for `leads` or `general-leads` collections.
Impact: Unauthorized writes/updates.
Mitigation:
- Audit `src/firestore.rules` and tighten write rules: require `isSignedIn()` plus `isCompanyTeam(companyId)`/`isOwner` checks where appropriate.
- Where guest writes are needed, require App Check or controlled Cloud Functions (Admin SDK) with strong logging.
Testing: Use the Firestore emulator and `firebase emulators:exec` test harness to run negative and positive permission tests.
Effort: Medium.

---

## 11. `confirmDriverInterest` has no authentication check
Summary: `functions/leadDistribution.js` calls `confirmDriverInterest` without enforcing `request.auth` at the callsite.
Impact: An unauthenticated caller could trigger side effects.
Mitigation:
- Enforce auth and authorization at the handler entrypoint. Add explicit checks `if (!request.auth) throw HttpsError('unauthenticated')` and verify role/ownership where needed.
- Also validate inputs robustly.
Testing: Unit tests for function with and without `request.auth` contexts.
Effort: Small.

---

## 12. Guest vs Authenticated application payload differences
Summary: Guest submissions (via `functions/guestApplication.js`) and authenticated submissions use different shapes.
Impact: UI rendering inconsistencies and backend processing divergence.
Mitigation:
- Normalize and sanitize the application payload as close to ingestion as possible (Cloud Function or server-side layer) to a canonical `application` shape.
- Document canonical schema and enforce minimal validation checks.
Testing: Schema validation unit tests; end-to-end submission tests.
Effort: Medium.

---

## 13. Guest-uploaded files inaccessible due to storage rules
Summary: Storage rules may prevent guest-read or guest-write flows.
Impact: Uploaded files not visible to intended consumers.
Mitigation:
- Use signed URLs for guest uploads or require App Check + temporary auth tokens.
- Tighten storage rules to allow writes only to specific paths with validation and App Check.
Testing: Emulator tests for upload/readscenarios.
Effort: Medium.

---

## 14. Mixed Firebase Functions v1 and v2 usage
Summary: Some functions import `firebase-functions/v1` while others use `v2`.
Impact: Inconsistent runtime behavior and migration complexity.
Mitigation:
- Plan and execute migration to `v2` in phases. Prefer new functions in `v2` and gradually update legacy ones. Keep consistent import style in `functions/index.js`.
Testing: Deploy to staging and smoke test scheduled and HTTP triggers.
Effort: Medium-large.

---

## 15. SMTP transporter created per-send
Summary: `functions/emailService.js` constructs a new transporter for every send.
Impact: Performance overhead and potential connection rate-limits.
Mitigation:
- Cache `nodemailer` transporter instances per-company in memory (with time-based expiry) or reuse a pooled transport.
- If using high volume, consider a transactional email service (SendGrid, SES) and use provider SDKs with pooling.
Testing: Load test sending, measure connection churn.
Effort: Small.

---

## 16. Guest endpoints don't require App Check verification
Summary: `functions/guestApplication.js` logs missing App Check and does not enforce it.
Impact: Potential automated abuse.
Mitigation:
- Enforce App Check where feasible; if guest UX requires looser constraints, add other mitigations: reCAPTCHA, rate-limiting, content validation, and server-side anti-abuse checks.
Testing: Verify requests without App Check are rejected or rate-limited.
Effort: Medium.

---

## 17. Rate limit records accumulate indefinitely (no TTL)
Summary: Rate-limit records are stored without TTL.
Impact: Storage growth and cost.
Mitigation:
- Add a TTL field and Firestore TTL policy or use a time-window counter document with periodic cleanup.
Testing: Monitor collections for growth; test TTL cleanup.
Effort: Small.

---

## 18. Signature image paths not validated in digital sealing
Summary: Document sealing code may assume valid signature image URLs/paths.
Impact: Missing signatures or errors during sealing.
Mitigation:
- Validate image availability and contentType before sealing; fallback to placeholder or fail gracefully with clear audit logs.
Testing: Unit tests for unavailable/malformed signature paths.
Effort: Small.

---

## 19. Audit trail checksum not cryptographic
Summary: Document audit trail uses non-cryptographic checksum.
Impact: Weak tamper-evidence.
Mitigation:
- Use HMAC-SHA256 with a server-held key or a proper cryptographic hash (SHA-256) and sign metadata; store hash with timestamp and signer.
Testing: Verify reproducibility and tamper detection.
Effort: Small-medium.

---

## 20. Misc: mixed phone formats in blacklist, address key bugs, PDF mismatches
Summary: A number of UI and mapping bugs (e.g., `IdentityCard` using wrong address key) were observed.
Mitigation:
- Consolidate helpers in `src/shared/utils/helpers.js` and `config/applicationSchema.js`. Use canonical keys and central `normalizeApplicant()` helper.
Testing: Unit tests for normalization.
Effort: Small.

---

## Rollout & Operational Recommendations (applies to multiple items)
- Always take a Firestore export before bulk writes: `gcloud firestore export gs://BUCKET/backup-$(date +%F)`.
- Use staged rollout: dev → staging → small production slice → full production.
- Use feature flags for reader-only behavior changes and a rollback window.
- Make backfill idempotent, resume-capable, and rate-limited; log progress to a `jobs/backfills/{id}` document.
- Add monitoring and alerts for error spikes during migrations (Cloud Logging, Sentry).

---

## Documentation & Runbook
- Update `README.md` and `ARCHITECTURE.md` with canonical schema, ID algorithm, placeholder domains, and migration runbook.
- Add a `RUNBOOK.md` with steps to rollback a backfill (restore from export and re-run corrections), and contacts for security incidents (key rotation) and legal/POLICY for SSN handling.

---

If you want, I will expand any single issue into a step-by-step implementation checklist including code snippets, tests, and a CI/CD plan. Tell me which issue to expand first.
