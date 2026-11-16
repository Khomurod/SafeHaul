# SafeHaul audit — verification and implementation notes (§4 items 1–27)

Read-only check of `main` @ `9e243f6b` (2026-11-04). Nothing in the repo was changed. No live systems were touched.
Sources read: the audit, `AGENTS.md`, `docs/APP_BRIEF.md` (§4, §5, §6, §8, §9, §10, §12), `docs/firestore-data-model.md`,
`src/firestore.rules`, `src/storage.rules`, `firestore.indexes.json`, and the code cited per item.

Verdict key: **Confirmed** (the audit describes the code correctly) · **Partly** (true, with a correction an
implementer needs) · **Wrong** · **Already fixed**.

---

## 0. Constraints that apply to every item

- **Rules file headroom.** `src/firestore.rules` is **679 physical lines**; the size guard refuses >700
  (`.claude/rules/source-size.md`). Any rules change has ~20 lines of room, and every rules change needs the
  owner's explicit approval (AGENTS §1).
- **Team writes are broad today.** Team members may update *any* field of `applications`, `leads`,
  `signing_requests`, `notifications` and write `dq_files` (rules L377–416, L474–487, L347–364, L322–327). The only
  field checks are `companyId` immutability and `status ∈ allowedRecruiterPipelineStatus()` (L131–167). Most
  features below need **no** rules change. Two consequences:
  - **Any server write of a `status` outside that list makes every later client update of that record fail**,
    because the rule checks `request.resource.data.status`, unchanged or not (`applicationCompanyTeamUpdateAllowed`,
    `leadCompanyTeamWriteAllowed`). A rules change is needed only if an implementation writes a status outside
    `allowedRecruiterPipelineStatus()`; items 10 and 11 as planned below use allowed values or leave the status alone.
  - A callable added for "integrity" on `signing_requests` (items 14, 23) is not a security boundary while the team
    can write the same fields directly (already recorded for `signedCopy` in APP_BRIEF §12). It is still the right
    place for audit data, idempotency and rate limits.
- **Notifications have no idempotency.** `createNotification` (`functions/shared/createNotification.js`) uses an
  auto id. Firestore triggers deliver at least once, so new notification writers should pass a deterministic id
  (e.g. `seal_${requestId}`, `pev_done_${token}`). This needs a small, backwards-compatible change to
  `createNotification`: an optional `id`, written with `create()`, and ALREADY_EXISTS ignored.
- **The bell opens a dossier only for `relatedType` `'application'|'lead'`** (`NotificationDropdown.jsx:31-34`).
  New types must use those, or add a target.
- **A recipient-only notification is hidden in the UI only.** Rules let the whole team read every company
  notification (L323), and the hook filters out other people's `recipientId` rows (`useCompanyNotifications.js:72`).
  Keep content non-sensitive.
- **New callables:** a `wanted('…')` line in `functions/index.js`, `docs/callable-frontend-map.md`, a literal
  `httpsCallable(functions, '<name>')` (the `check-callable-contract.mjs` scan), and `check:function-exports`.
- **Files near the size guard:** `DQFileTab.jsx` 510, `PEVTab.jsx` 500, `DocumentsManager.jsx` 499,
  `guestApplication.js` 487, `facebook.js` 485, `SendTemplateWizard.jsx` 472, `postApplicationEdocs.js` 454. A change
  that grows these files must move code out (DQ, PEV, documents) instead of adding to them.
- **APP_BRIEF must change in the same PR** wherever a trigger, a workflow or a limitation changes (§4 E-documents /
  PEV, §8 trigger and job lists, §12 limitations).

---

## Item 1 — Automated SMS and campaigns honour "no SMS" and the opt-out list

**Verdict: Confirmed**, with one correction about "old applications".
- `functions/atsContactSms.js` `sendContactAttemptSmsIfNeeded` (L38–84) does not call `isBlacklisted` and does not read
  `sms-consent`. It records the outcome only in `console.log` / `console.error` (L80–82). It runs for applications
  **and** leads (`onApplicationAtsContactSms` L91, `onLeadAtsContactSms` L104).
- `sms-consent` is a top-level application field: `buildApplicationDoc` spreads `formData`
  (`functions/shared/buildApplicationDoc.js:224`). Its values are `'yes'|'no'` (Step1 `RadioGroup`,
  `Step1_Contact.jsx:320-327`). Nothing server-side reads it. It is mentioned only in `applicationSections.json:55`,
  `driverOnlyFields.json:9` and `submitReferralInterest.js:131` (which writes `'yes'` on referral leads).
- Campaigns check the blacklist per send (`sendLoop.js:142-147`) but ignore `sms-consent`. AudienceBuilder's default is
  `leadType: 'applications'` (`AudienceBuilder.jsx:89-93`), and `buildLeadQueries` picks `applications` unless
  `leadType === 'leads'` (`queryBuilder.js:48-52`).
- **Correction:** the question is **optional** (no `required`, no gate in `applicationGates.js`), so `sms-consent` is
  missing on *any* application whose driver skipped it, not only old ones. **No lead source except the referral form
  ever asks** (quick-add, import, Facebook have no such field). Treating "unanswered = do not text" would therefore stop
  every automated SMS to imported leads.

**Where to change.**
- `atsContactSms.js`: before `adapter.sendSMS`, (a) `afterData['sms-consent'] === 'no'` → skip; (b)
  `await isBlacklisted(companyId, phone)` from `functions/blacklist.js` → skip. It fails closed on a bad number, as
  campaigns do. (c) Write one `activity_logs` entry on the record, in the server shape already used by
  `submitReferralInterest.attachReferral` (L66–79): `{ action: 'Automated SMS', details, type: 'system', companyId,
  timestamp }`, with outcome `sent | skipped_no_consent | skipped_opt_out | skipped_no_template | failed`. Never log the
  message body or the number. A transition can fire twice (at-least-once). Use a deterministic log id, e.g.
  `auto_sms_${event.id}`, written with `create()`.
- Campaigns: in `sendLoop.js`, after the blacklist check, `config.method === 'sms' && leadData['sms-consent'] === 'no'`
  → `errorMsg = 'Driver declined SMS'`. That record already exists as `leadData`. For honest counts, add
  `'sms-consent'` to `fieldsNeeded` in `gatherTargets.js` (`gatherIdsFromQueries`, L94) and filter there too. Whatever
  the count/preview path uses must apply the same rule. Count, preview and launch share one rule today
  (`recentlyMessaged.js`).
- Related, out of scope: `useCallOutcome.js:206-221` sends an automated **email** (`sendAutomatedEmail`, trigger
  `no_answer`) on No Answer / Voicemail. `notifySignerSMS` and `resendSignerOnCorrection` do not check the blacklist
  (see §8.6).

**Rules/indexes:** no / no.
**Owner decision:** yes. (1) Unanswered on an application: text automatically or not? (2) Leads that were never asked
(import, quick-add, Facebook): text or not? (3) Should a campaign email (not SMS) also respect "no"? The audit's
"нет ответа = не писать" breaks lead SMS entirely if applied to leads.
**Dependencies:** none. Item 13's SMS sends and item 14's reminders should reuse the same consent + blacklist helper.
Put it in one place, e.g. `functions/shared/smsPermission.js`.
**Size:** S. **Risks:** legal (TCPA); the activity log write adds one doc per transition plus `stampActivityLogExpiry`;
no double send (the transition-only gate stays).
**Tests:** `functions/test/unit/atsContactSms.sender.test.js`, `atsContactSms.transition.test.js` (consent, blacklist,
log written once); `batchWorker.optOut.test.js` (declined SMS); `gatherTargets.parallel.test.js`;
`src/features/campaigns/components/AudienceBuilder.test.jsx` if counts change.

---

## Item 2 — Bell: "document signed" / "seal failed" for the sender

**Verdict: Confirmed.** `sealDocument` (`functions/digitalSealing.js`, v1 `onUpdate`, L72–339) writes only the request:
`status: 'signed', signedPdfUrl, sha256Checksum, completedAt` (L285–290). On failure it writes
`status: 'error_sealing', errorLog, missingFields?` (L234–238 and L322). Recruiter sends store `senderId =
auth.currentUser.uid` (`signingRequestWrite.js:55`). Post-application documents store `senderId: null`,
`senderName: 'SafeHaul Auto-Followup'`, `sourceApplicationId` (`postApplicationEdocs.js:385, 407-408`).

**Where to change.** In `sealDocument`, after the `'signed'` update and in both `error_sealing` branches, call
`createNotification(db, companyId, { type: 'document_signed' | 'document_seal_failed', recipientId: senderId, relatedType,
relatedId, title, message })`. Wrap it in its own try/catch so it can never fail the seal. When `senderId` is null
(post-application), read `applications/{sourceApplicationId}.assignedTo`: use it as `recipientId`, else write a
team-wide notification. Use `relatedType: 'application'` + `relatedId: sourceApplicationId` so the bell opens the
dossier. Recruiter-sent documents have no record link until item 5, so the row cannot open anything yet. Add a
`signing_request` target to `NotificationDropdown`, or accept that. Do not put the signer's email or the document
contents in the message.
**Rules/indexes:** no / no (the `recipientId + createdAt` index exists).
**Owner decision:** no (optional: who hears about post-application documents with no assignee).
**Dependencies:** 15 (per-user read) improves it; 5 adds record links for recruiter documents.
**Size:** S. **Risks:** duplicate notification on trigger redelivery (use a deterministic id, §0). The sealed PDF is
untouched.
**Tests:** `functions/test/unit/digitalSealing.test.js`, `digitalSealing.companySignature.test.js` (success, missing
company signature, exception path, post-app fallback); `src/features/company-admin/components/NotificationDropdown.test.jsx`
for any new icon or type.

---

## Item 3 — Driver's signing documents in the dossier, including required post-application forms

**Verdict: Confirmed.** The dossier tabs are application/documents/dq/pev/activity/notes (`DossierSidebar.jsx:40-47`,
`DossierContent.jsx:43-100`). No tab lists `signing_requests`. Post-application requests are created only by
`createPostApplicationSigningRequest` (`postApplicationEdocs.js:216`), called only from
`usePostSubmitDocuments.js:133`, with `sendEmail:false, sendSms:false` (L403–404). The confirmation email
(`notificationTriggers.js:149-227`) carries no form links. Correction to §3.3: the checklist is kept in
**`sessionStorage`** with a 24 h TTL (`postApplyDocsStorage.js:20,32-48`). It is per-tab and gone once the tab closes,
so "24 hours" overstates it.

**Where to change.**
- Read side: a hook, e.g. `src/features/company-admin/hooks/useRecordSigningRequests.js`, running
  `query(signing_requests, where('sourceApplicationId','==',id))` and, after item 5, the new link field. Use equality
  only and sort in memory, so no composite index is needed (same reasoning as `useSigningRequestCounts.js:19-21`). Merge
  in `companies/{id}.postApplicationTemplates` (team-readable; normalised as in `normalizePostSubmitTemplateConfig`)
  to show required forms with no request as "not started". Derive "expired" in the browser from `status==='sent' &&
  expiresAt < now`. Open signed PDFs with the existing `getSignedDocumentUrl` (`secure_documents/` only). Put it in a
  new dossier tab or a section in the DQ tab, which is already 510 lines, so use a new component.
- "Send to driver": a **new staff callable** (`assertCompanyAccessForRequest`). Do not reuse the guest callable: it
  authenticates by `confirmationNumber` and rate-limits by IP. Move request building (L216–415) into
  `functions/shared/postApplicationRequest.js` so both callables create the same deterministic
  `postapp_${applicationId}_${templateId}` document (`buildPostApplicationRequestId`, L203). Delivery can reuse
  existing machinery. When the request exists and is unsigned, setting `sendEmail`/`sendSms` to true in a transaction
  makes `resendSignerOnCorrection` (`routeChanged`, L19–24) settle the link and send exactly once
  (`settleSigningLink` claims the channel and extends `expiresAt`). When it does not exist, create it with
  `sendEmail:true` and `notifySigner`/`notifySignerSMS` (onCreate) send. SMS must apply item 1's consent and blacklist
  check.
**Rules/indexes:** no / no.
**Owner decision:** yes. Should "send to driver" also go out automatically right after submission, i.e. put links in
the confirmation email? That is an extra message, a consent question, and a change to the confirmation email.
**Dependencies:** recruiter-sent documents need item 5's link. Item 4 needs this list's linkage. Item 14's
"expired / remind" shows here.
**Size:** M. **Risks:** tenancy (the staff callable must check `companyId` and the application exists under it); a
double send if both the create path and the flag-flip path run, so decide in one transaction; the guest callable's
idempotency must be preserved (tests exist).
**Tests:** `functions/test/unit/postApplicationEdocs.test.js` (refactor keeps behaviour; staff callable auth, idempotency);
`resendSignerOnCorrection.test.js`; a new `src/...` hook test; `e2e/guest-post-application-edoc.spec.cjs`,
`e2e/driver-dossier.spec.cjs`.

---

## Item 4 — Sealed document filed in the DQ file automatically

**Verdict: Confirmed.** The seal writes nothing besides the request (L285–290). The patterns to reuse are
`fileRequestInDq` (`employmentVerification/requestAttachment.js:67-88`: `dq_files/pev_request_${requestId}`,
`isSynced: true`, `url: null`) and `dqUploads.js` (`removedAt` semantics). Sealed PDFs live at
`secure_documents/{companyId}/completed/{requestId}_signed.pdf`. Storage rules allow the team to read but not
delete there (`storage.rules:113-119`), which suits "remove hides only".

**Where to change.**
- Server: in `sealDocument`, after the `'signed'` update, `set` `…/{applications|leads}/{recordId}/dq_files/signed_${requestId}`
  with `{ type: 'signed_document', fileType: template title, label: 'Signed document', storagePath: signedPdfUrl,
  url: null, source: 'signed_document', isSynced: true, signingRequestId, sha256Checksum, signedAt, uploadedBy:
  'e_docs', createdAt }`. Owner fields go in as `dqRecordFor` does (`applicantId/driverId/userId/ownerUserIds`) so
  `canReadApplicationSubcollectionDoc` behaves the same. Use a deterministic id and `create()` or merge. Never copy
  the PDF.
- Client: the DQ tab can only open driver uploads, PEV request paths and the audited original
  (`openApplicationFile.js:22-29`, `DQFileTab.jsx:416-455`). Anything else falls through to
  `IconButtonLink href={file.url}`, which is null. Add a branch for `secure_documents/` paths using the existing
  callable `getSignedDocumentUrl` (in `applicationFileLink.js:19-28`, with the literal callable name). `confirmDelete`
  already marks `isSynced` rows `removedAt` instead of deleting the file (L281–285).
**Rules/indexes:** no / no.
**Owner decision:** no (optional: should only some templates file into DQ?).
**Dependencies:** post-application documents work now via `sourceApplicationId`. Recruiter documents need item 5.
**Size:** S for post-application, M with 5. **Risks:** signed-document integrity (path only, never a copy; the
checksum belongs to that one file); a seal retry (item 23) must not create a second entry, which the deterministic id
handles.
**Tests:** `functions/test/unit/digitalSealing.test.js`; `src/features/company-admin/components/tabs/DossierBodies.dqfile.test.jsx`
(open via `getSignedDocumentUrl`, delete hides); `openApplicationFile`/`applicationFileLink` unit tests.

---

## Item 5 — Template send: applicants in the picker, record link, prefill from the application

**Verdict: Confirmed.** `findPickerLeads` reads only `leads` (`pickerLeads.js:17-29`, `activeTab: 'leads'`). The wizard
says "Or choose an existing driver or lead" but searches leads (`SendTemplateWizard.jsx:177-183`). `handleQuickSelect`
keeps only name, email and phone and drops the record id (`useTemplateSendFlow.js:141-145`). `buildPrefillContext` gets
only name, email, phone and company (`useTemplateSendFlow.js:182-187`); `address/city/state/zip` are `''`
(`prefillEngine.js:51-65`). It does accept `extra` (L39, L67–71). `createSigningRequest` stores no record link
(`signingRequestWrite.js:46-60`).

**Where to change.** `pickerLeads.js`: also run `runDashboardSearch({ activeTab: 'applications', … })`. The same helper
serves the Applications page; tag each row with its collection. `handleQuickSelect`: keep `{ collectionName, id }`.
`executeTemplateSend`: pass `extra` built by a **browser port of `buildPrefillContextFromApplication`**, with a
denylist. Write `content.relatedRecord: { collectionName, id }`, or reuse the name `sourceApplicationId`, which
already means "the application" (decide one; leads need `collectionName`). The team may write any signing-request
field. Add "Send document" in the dossier to open the same wizard with the record preselected.
- **Integrity risk found:** `buildPrefillContextFromApplication` copies **every top-level scalar** of the application
  into the token context (`postApplicationEdocs.js:123-129`). Application docs hold `ssn` (used by
  `requestPdf.js:80`) and `signature` (data URL / `TEXT_SIGNATURE:`), so a template token `{{ssn}}` or `{{signature}}`
  resolves today in post-application documents, which are sealed and readable by the whole team. The port must not
  copy this. Add an explicit denylist (`ssn`, `signature`, `signatureType`, upload objects are already skipped) or an
  allowlist, and fix the server function in the same PR.
**Rules/indexes:** no / no.
**Owner decision:** no (the denylist is a safety fix, not a choice). Optional: may the dossier's "Send document" pick
any template?
**Dependencies:** enables 3 and 4 for recruiter documents. Pairs with 2.
**Size:** M. **Risks:** PII leakage into sealed PDFs (above); tenancy is fine (same-company search only); keep "Date
Signed stamped at signing" (`resolveSignedDateValue` exclusion at `useTemplateSendFlow.js:219-222` stays).
**Tests:** `src/features/company-admin/hooks/useTemplateSendFlow.leads.test.jsx` (+ applications), `useTemplateSendFlow.*`;
a prefill unit test for the denylist; `functions/test/unit/postApplicationEdocs.test.js` (`{{ssn}}` stays unresolved);
`e2e/edoc-send-template-wizard.spec.cjs`, `e2e/edoc-recruiter-send-flow.spec.cjs`.

---

## Item 6 — PEV result PDF filed in the DQ file

**Verdict: Confirmed**, plus two defects the audit missed.
- The portal answer: `generateVerificationPDF` stores `…/{collection}/{appId}/pev_results/PEV_…pdf` and records `pdfPath`
  on `verification_requests` (`pdf.js:298-312`). `submitVerificationResponse` mirrors `resultUrl: pdfPath` onto the
  employer row (`responses.js:249-279`). No DQ write.
- Manual "Upload Result" (`PEVTab.jsx:287-326`) uploads to `pev_results/`, stores a **`getDownloadURL`** link, and writes
  only the row.
- **Defect A (new):** the carrier's "complete" email says "Full details and PDF have been automatically added to the
  applicant's DQ file" (`emailTemplates.js`, `buildCarrierCompleteEmailHTML`). That is false today.
- **Defect B (new, important):** manual Upload Result never touches `verification_requests/{token}`. It stays
  `sent|opened|reminder_sent`, so `processVerificationReminders` keeps emailing the employer, and on day 30
  `updateApplicationVerificationStatus` sets the row to "No Response (Good Faith Documented)" unconditionally
  (`reminders.js:62-70, 134-146`). That **overwrites the "Completed" a recruiter uploaded**.

**Where to change.** Portal: in `responses.js` after `generateVerificationPDF`, call a new
`fileResultInDq(appRef, { token, path, employerName, applicantName })` beside `fileRequestInDq` in
`requestAttachment.js`, with an id that holds no token material, such as the requestId or a hash of the stored path
(the token must not appear in team-readable docs: PEV-SEC-3), `isSynced: true`, `url: null`. Manual upload: move it to a **callable** (e.g.
`recordManualVerificationResult`) that marks the matching request `completed`, so reminders stop. That fixes Defect B.
It mirrors the row (`resolveEmployerTarget`), files the DQ entry and stores `storagePath`, not a download URL. The client
still uploads the file (`pev_results` create-only rule, `storage.rules:100-102`). Client: `opensFromSignedLink` must
send `pev_results/` paths to `getSignedPevUrl`, which already accepts them (`getSignedPevUrl.js:42`). Today it matches
only `pev_requests/` (`pevRequestPath.js`).
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** 9 (late upload after no-response) should use the same callable. 8 (attempt record) needs the request
to know about manual results.
**Size:** S (portal) / M with the manual-upload callable. **Risks:** never write the portal token into the application
or DQ doc; reminder cost unchanged.
**Tests:** `functions/test/unit/employmentVerification.responses.test.js`, `pevResultPdf.test.js`, `pevCarrierNotifications.test.js`;
`src/features/company-admin/components/tabs/PEVTab.results.test.jsx`, `DossierBodies.dqfile.test.jsx`;
`e2e/pev-request-and-portal-response.spec.cjs`.

---

## Item 7 — PEV: bell notification for whoever sent the request

**Verdict: Confirmed.** `verificationData.createdBy = request.auth.uid` (`requests.js:255`). Carrier notices are emails to
`contact.email → adminEmail → email` only (`notifications.js:41-44, 49-75`). Nothing is sent when none is set or SMTP
is missing.

**Where to change.** `responses.js` after the row update (around L280): `createNotification(db, companyId, { type:
'pev_completed', recipientId: verificationData.createdBy || undefined, relatedType: verificationData.collectionName ===
'leads' ? 'lead' : 'application', relatedId: applicationId, … })`. `reminders.js` in the `daysSinceSent >= 30` branch:
`type: 'pev_no_response'`. Use deterministic ids (`pev_done_${requestId}`, `pev_nr_${requestId}`; not the token).
Requests from before `createdBy` existed go team-wide.
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** none (15 improves it).
**Size:** S. **Risks:** a public callable (`submitVerificationResponse`) now writes a notification; it is already
rate-limited and claim-guarded. Keep the employer's free-text answers out of the message.
**Tests:** `functions/test/unit/employmentVerification.responses.test.js`, `employmentVerification.test.js` (reminders),
`pevCarrierNotifications.test.js`.

---

## Item 8 — PEV: complete good-faith attempt record

**Verdict: Confirmed.** `lastReminderAt` is overwritten (`reminders.js:81,85,89`). The row gets an entry only on
day 30 (L70, L134–146). An open is recorded only on the request (`portal.js:46-52`). The request is stored before the
email (`requests.js:259-260` vs L263–281). A failed `sendDynamicEmail` throws (`emailService.js:80-82`), so the
callable throws, the request stays `status: 'sent'` and later gets reminders and a day-30 "No Response (Good Faith
Documented)" on the row (`reminders.js:24-26, 62-70`). The no-response email cites "§391.23(j)" and "All attempts …
recorded" (`emailTemplates.js:228-245`). Fax/manual requests get no reminders (`v.employerEmail` null).
- **New finding:** "Resend" (`PEVTabParts.jsx:155-164` → `handleInitiate`) creates a new request and **never retires the
  old one**. Nothing in `functions/employmentVerification/` supersedes. The old one keeps sending reminders, and its
  day-30 mark overwrites the row status of the new one, even "Completed".
- Nuance: `openedAt` is not strictly the first open. A reminder sets `status: 'reminder_sent'`, and the next open
  rewrites `openedAt` (`portal.js:47-51`).

**Where to change.**
1. Events: keep the authoritative log on the request (APP_BRIEF §5: `verification_requests/{token}` is authoritative,
   the row is a mirror). Use `arrayUnion` into `attempts[]` (`{ kind: 'sent'|'reminder'|'opened'|'call'|'fax'|'note'|
   'no_response'|'send_failed', at, by?, ok, error? }`) or a subcollection. Mirror a short entry into
   `employers[i].verification.history` through `resolveEmployerTarget`. Reminders: record each send and its outcome. On
   failure, today's catch (L92–94) skips the update and retries tomorrow; record the failure too. Portal: mirror only
   the first open.
2. "Record attempt": a new team callable (`verification_requests` is client-write-denied, rules L232–240). Do it as a
   **transaction** on the application. The current row writers are non-transactional read-modify-write
   (`reminders.js:115-145`, `responses.js:230-279`), and a fourth writer raises the lost-update risk.
3. Attempt-record PDF at day 30: pdf-lib like `requestPdf.js`. Store it under the **existing `pev_requests/` folder**
   (e.g. `PEV_ATTEMPTS_<employer>_<id>.pdf`) so `getSignedPevUrl` and the client's `isPevRequestPath` open it with no
   rules or signer change. File it with a `fileRequestInDq`-style writer.
4. Failed first email: catch the send error in `sendVerificationRequest`, update the request to `status: 'send_failed'`
   (outside the reminder query list) and return `{ success: false }` or throw after marking. Also retire earlier live
   requests for the same `employerId` on a new send (`status: 'superseded'`).
**Rules/indexes:** no. The reminder query (`status in [...]`) is single-field. `where('employerId','==')` for supersede is
single-field. No index.
**Owner decision:** yes. A compliance specialist should check the email wording ("§391.23(j)", "All attempts … recorded")
and the PDF title. Is the attempt PDF filed for every no-response?
**Dependencies:** 6 (manual result must complete the request), 9 (late result), 16 (a pending flag).
**Size:** M (8.4 + supersede alone: S). **Risks:** legal wording; never write the token into the application or DQ;
the scheduled job already scans the whole `verification_requests` collection daily with no limit (cost grows with
history, so consider a `createdAt` bound); per-step transactions.
**Tests:** `functions/test/unit/employmentVerification.test.js`, `employmentVerification.requestPdf.test.js`,
`pevRequestPdf.test.js`, `employerIdentity.test.js`; `src/.../tabs/PEVTab.flow.test.jsx`; `e2e/pev-request-and-portal-response.spec.cjs`.

---

## Item 9 — PEV: late result upload and "opened" shown

**Verdict: Confirmed**, with a correction. Upload Result renders only when `vStatus.status === 'Sent'`
(`PEVTabParts.jsx:133`). `openedAt` is on the request only (`portal.js:46-52`). The UI reads no `openedAt` anywhere,
and the company cannot read `verification_requests` (rules L232–234, super admin only). "Already recorded in the
request" is true, but **showing it needs a server mirror** onto the row.

**Where to change.** `PEVTabParts.jsx`: show Upload Result for `Sent`, `No Response (Good Faith Documented)` and
any non-Completed status after a send. Route it through item 6's callable, so the request becomes completed and the
no-response entry stays in history. `portal.js`: when the request has no `openedAt` yet, also mirror
`verification.openedAt` and a history entry onto the row. Do it once only: it is a public, token-addressed callable,
rate-limited at 20/min (L19).
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** 6 (the callable); 8.1 (events) overlaps; do them together or 9 first with a minimal mirror.
**Size:** S. **Risks:** write amplification from a public endpoint (mirror once).
**Tests:** `src/.../tabs/PEVTab.results.test.jsx`, `PEVTab.flow.test.jsx`; `functions/test/unit/employmentVerification.test.js`
(portal open mirrors once).

---

## Item 10 — A call result does not break the pipeline stage

**Verdict: Confirmed.** `OUTCOMES` (`src/shared/hooks/useCallOutcome.js:9-18`) map to `Contacted | Disqualified | Rejected
| Attempted`. `handleSave` always writes `status: newStatus` (L104–109) and `archived: true` for four outcomes
(L111–114). None of these is in `ATS_PIPELINE_STATUSES` or the dropdown list (`atsStatus.js:2-35`). Lead tabs look for
`Contact Attempt 1–3` / `In Process` / `Interested` (`dashboardQueries.js:49-54`). A status change on an application
notifies the whole team (`notificationTriggers.js:12-38`). `lastCallOutcome` is already stored (L107).

**Where to change.** `useCallOutcome.js` only: drop `status` from `updateData` unless the owner's table maps the outcome to
a pipeline stage. Keep `lastCallOutcome`, `lastContactedAt`, the activity log (which drives `statsDaily`) and the
note. Mapping to `Contact Attempt N` triggers the automated SMS (item 1 applies). Writing `statusEnteredAt` as
`useAppActions.handleStatusUpdate` does keeps lists consistent.
- Side effects to check: campaign filters offer `Contacted` (`functions/shared/constants.js:5`,
  `campaignConstants.js:13`). Saved campaign audiences filtering on `Contacted` would shrink. The application
  "declined" segment contains `Rejected` (`applicationStatus.js:20`), so "Not interested" already lands there;
  `Disqualified` lands in no segment. `archived` handling should follow the same table.
- `collectionName` is guessed (`lead.submittedAt || sourceType === 'Company App'`, L101). Leave it alone, but don't
  depend on it more.
**Rules/indexes:** no, as long as only already-allowed values are written. All mapped targets (`Interested`,
`Declined`, `Contact Attempt N`) are in `allowedRecruiterPipelineStatus`. A new value needs a rules change (§0). No
index.
**Owner decision:** yes (audit §8.2): No Answer / Voicemail keep the stage or advance to the next Contact Attempt
(which sends SMS)? Not interested / Wrong number / Not qualified / Hired elsewhere: set `Declined`, or only suggest it?
Interested: set `Interested`? Keep `archived`?
**Dependencies:** 1 (if mapping to Contact Attempt). 26 (status list).
**Size:** S. **Risks:** campaign audiences that filter on `Contacted`; existing records keep legacy values (do not
migrate).
**Tests:** `src/shared/hooks/useCallOutcome.reminder.test.js`, `useCallOutcome.noAnswerEmail.test.js` (+ a status-mapping
test); `src/tests/statusVocabulary.test.js`.

---

## Item 11 — Lead submits an application: lead and application linked

**Verdict: Confirmed.** `onApplicationSubmitted` (`driverSync.js:149-250`) attributes only through
`recruiterCode` / `referralCode` (L199–221). It never looks up leads. `buildLeadQueries` has no "has application"
filter (`queryBuilder.js:46-150`). **A better server pattern than the one the audit names exists:**
`existingRecord()` in `functions/referrals/submitReferralInterest.js:55-63` already queries `leads.normalizedPhone`,
`leads.email`, `applications.phoneNormalized` and `applications.emailNormalized` with `limit(1)` each.
(`leadImportMatches.js` is client-side.)

**Where to change.** In `onApplicationSubmitted`, after the attribution block (the idempotency guard
`processing_status/app_…` already holds): query this company's leads by `normalizedPhone == data.phoneNormalized` and by
a normalised email on both sides (see §8.1: lead emails are not normalised today). Skip placeholder emails (`isPlaceholderEmail`). On a match: in a
transaction, set on the lead `{ applicationId, appliedAt }` (**do not change its `status`**, or use an allowed value,
§0); add a lead `activity_logs` entry (`type: 'system'`); if the application is still unassigned and the lead's
`assignedTo` is a current member (`teamMemberName` in `shared/recruiterAssignment.js:44-62`), set `assignedTo/Name`;
notify the recruiter (`recipientId`). Write `fromLeadId` on the application. Campaigns: add the link field to
`fieldsNeeded` in `gatherTargets.js` and drop linked leads in memory. Firestore `== null` does not match a missing field,
so don't filter in the query. Dossier links: plain reads.
**Rules/indexes:** no. These are single-field equality queries, auto-indexed. No index.
**Owner decision:** yes. More than one matching lead (household phone)? Link them all or only an exact email match?
Should the lead's status change (to what)? Should a linked lead stay in campaigns when the campaign is explicitly about
it?
**Dependencies:** 15 (assignment notification); 22 (recruiter links reduce unassigned apps).
**Size:** M. **Risks:** false matches (link only, never merge); tenancy (same company only); 2–3 extra reads per
submission; trigger maxInstances 2; the application write retriggers update triggers (harmless today).
**Tests:** `functions/test/unit/driverSync.applicationWrites.test.js` (+ new lead-link cases), `submitReferralInterest.test.js`
(existing matcher), `bulkActions.filters.test.js`, `gatherTargets.parallel.test.js`.

---

## Item 12 — An application a recruiter prepared is assigned to them

**Verdict: Confirmed.** `preparedBy: { uid, name, at }` is written on the draft (`companyApplications/prepare.js:115-119`)
and carried on re-key (`companyPreparedDraft.js:115`). `submitGuestApplication` reads the draft as `submittedDraft`
(`guestApplication.js:283`) only for edits and locks. The invite URL carries no recruiter code (`useInviteLink.js:55-56`).
The draft is discarded right after the upsert (L308), so the `onApplicationSubmitted` trigger **cannot** read it later.

**Where to change.** In `submitGuestApplication`, after `upsertApplicationDoc`: when `submittedDraft?.origin === 'company'`
and `preparedBy.uid` is a current member (`teamMemberName`), update the application `{ preparedBy: { uid, name },
assignedTo, assignedToName }` in a transaction that writes `assignedTo` only if it is still empty. That avoids racing
the trigger's `recruiterCode` assignment. Then `createNotification` with `recipientId: preparedBy.uid`. Do it in the
callable, not in the trigger keyed on a doc field. The signed-in driver create path (rules L204–209, used at L385) blocks
`assignedTo/referral` but not an arbitrary `preparedBy`, so a trigger trusting `preparedBy` would be forgeable.
**Rules/indexes:** no (if done in the callable as above) / no.
**Owner decision:** no (optional: precedence if a prepared draft also arrives via a recruiter link).
**Dependencies:** 15.
**Size:** S. **Risks:** `guestApplication.js` is 487 lines; put the logic in `functions/shared/` to stay under 500.
**Tests:** `functions/test/unit/guestApplication.test.js`, `companyApplications.invite.*.test.js`; `e2e/company-prepared-application.spec.cjs`.

---

## Item 13 — The server sends the driver links

**Verdict: Confirmed.** `createChangeReview` returns `{ token, path }` (`applicationChanges.js:154-205`) and the client copies
it (`useApplicationChanges.js:56-67`). `mintApplicationInvite` returns `inviteToken` (`invite.js:119-197`) and the client
builds and copies the URL (`useInviteLink.js:46-62, 85-101`). The same callable serves continuation links for
driver-started drafts. APP_BRIEF §12 already names out-of-band delivery as the fix (L1355–1358).

**Where to change.** Add `deliver: 'email'|'sms'` to both callables, or add two small sender callables. The server sends
to the record's own `email` / `phone` (draft `contactEmail` / `contactPhone`; application `email` / `phone`) through
`sendDynamicEmail` / `SMSAdapterFactory`. The model is `notifySigner.emailSigningLink` / `notifySignerSMS.textSigningLink`.
Return only a masked destination. For continuation links, return no token to the caller at all when delivery is
requested (the security point of §12). Rate limit: `checkRateLimit` per user and per record, as `mintApplicationInvite`
does (L131). SMS: item 1's consent and blacklist helper. Keep Copy as a fallback (owner decision).
**Rules/indexes:** no / no.
**Owner decision:** yes. Keep "copy link" for continuation links at all? Removing it is what actually closes the §12
limitation. Allow SMS?
**Dependencies:** 1 (SMS permission helper); 24 (shows when email or SMS is not configured).
**Size:** M. **Risks:** a double send on a double press (claim in a transaction, as `claimDelivery` does in
`notifySignerSMS.js:21-28`); link leakage in logs; cost of messages.
**Tests:** `functions/test/unit/applicationChanges.test.js`, `companyApplications.invite.test.js`, `.privacy.test.js`;
`e2e/change-review-portal.spec.cjs`, `e2e/unfinished-applications-admin.spec.cjs`.

---

## Item 14 — Unsigned documents: "expired", "remind", "extend"

**Verdict: Confirmed.** Links last 7 days (`signingRequestWrite.js:14,54`; `signingLink.js:19`). `getSigningLink`
returns the link without extending it unless a correction replaced it (`getSigningLink.js:34-46` →
`settleSigningLink` L60–84 extends only when `replace` or a channel is claimed). The signer gets "This signing link has
expired" (`publicSigning.js:127-129, 237-239`). The workspace has no expired status (`documentsWorkspace.js:21-34`).
The details dialog shows only an "Expires" date (`SentDocumentDetailsDialog.jsx:96`).

**Where to change.** "Expired": derive it in the browser (`status==='sent' && expiresAt < now`) in `documentsWorkspace.js`
and its server-filter mirror `signingRequestQueries.js`. A server **count** of expired needs `status == 'sent' &&
expiresAt < now`, which needs a **new composite index** (`signing_requests`: `status ASC, expiresAt ASC`). The existing
`status+createdAt` index can approximate it but is wrong for re-issued links. "Remind": a new team callable
`remindSigner({ companyId, requestId })`. Add a `{ resend: true }` mode to `settleSigningLink` that, for `status ===
'sent'`, claims the channels again even when `linkSentTo` already holds them, and extends `expiresAt`. Today `send:
true` only claims unreached channels (`linkWork`, L41–50). Then call `emailSigningLink` / `textSigningLink`. Claim with
a `reminderClaimedAt` and a cooldown so one press is one send. Optional auto reminder: a scheduled job over a
collection-group `signing_requests` query (`status=='sent'`, `createdAt <= now-3d`, `autoReminderSentAt == null` is
not queryable, so use a numeric `reminderCount == 0`). That needs a collection-group composite index.
**Rules/indexes:** no rules / **yes, index(es)**: the expired count, and the auto reminder if chosen.
**Owner decision:** yes (audit §8.3): an automatic reminder (which day, email and/or SMS, company cost and consent)?
**Dependencies:** 1 (SMS permission); 3 (shows in the dossier); 16 (counts).
**Size:** S without auto reminder, M with. **Risks:** double sends (claim + cooldown); the scheduled job's cost; SMS
consent.
**Tests:** `functions/test/unit/getSigningLink.test.js`, `resendSignerOnCorrection.test.js`, `notifySignerSMS.test.js`;
`src/features/company-admin/utils/documentsWorkspace.test.js`, `signingRequestQueries.test.js`, `signingRequestIndexes.test.js`;
`e2e/edoc-documents-workspace.spec.cjs`, `e2e/edoc-envelope-history.spec.cjs`.

---

## Item 15 — Bell routed to the right person, read state per person

**Verdict: Confirmed.** Status changes go team-wide with no actor exclusion (`notificationTriggers.js:12-38`). The
dossier's status and assignment writes stamp no actor (`useAppActions.js:58-62, 89-97`; no
`lastModifiedBy`/`statusChangedBy` writer exists in `src/`). Lead assignment is `onDocumentUpdated` only (L41–69), so
imported leads created already assigned (`useCompanyLeadUpload.js:180-257`) never notify. There is no application
assignment trigger. `read` is one shared boolean (`createNotification.js:11`; `markAllAsRead` batch-updates the shared
docs, `useCompanyNotifications.js:116-132`).

**Where to change.**
- Per-user read: write `readBy: arrayUnion(uid)` instead of `read: true` (hook L105–132). Compute `unread` as `!readBy?.includes(uid)`
  (treat legacy `read: true` as read for everyone). `readBy` grows with the team size, which is small.
- Routing: in `onApplicationStatusChanged`, a `recipientId: after.assignedTo` when set. Skip when
  `after.statusChangedBy === after.assignedTo`, which requires the client to stamp `statusChangedBy: uid` in
  `useAppActions.handleStatusUpdate` and `useCallOutcome`. Add `onApplicationAssigned` (an update with `assignedTo`
  changed → `recipientId` = new owner, skip if `assignedBy === assignedTo`). Imports: the importer is an admin (route
  `adminOnly`, `companyRouteManifest.js:100-112`). After the batch, a callable (or the admin client, which rules allow
  to create, L324) writes one summary per recruiter, e.g. "15 leads assigned to you".
**Rules/indexes:** no. The existing rules allow any team update of a notification (L325); restricting updates to
`readBy` with one's own uid would be a hardening rules change, optional and needing approval. No index (the existing
`recipientId+createdAt` index covers the own-reads query).
**Owner decision:** yes. Should status changes reach only the assignee, or still the team when unassigned? Is "don't
notify me about my own action" wanted for every type?
**Dependencies:** improves 2, 7, 11, 12.
**Size:** M. **Risks:** the per-user read model must not break the 20-row merge logic. Other people's `recipientId` rows
remain team-readable by rules (§0).
**Tests:** `src/features/company-admin/hooks/useCompanyNotifications.test.js`, `notificationIndexes.test.js`,
`NotificationDropdown.test.jsx`; `functions/test/unit/callbackNotification.test.js` (+ new trigger tests);
`useCompanyLeadUpload.upload.test.js`.

---

## Item 16 — "Needs attention" panel on the dashboard

**Verdict: Confirmed** (absent). The dashboard shows four `MetricCard`s (`CompanyAdminDashboard.jsx:88-120`). No PEV or DQ
route exists (`companyRouteManifest.js`). The server-count pattern is `useSigningRequestCounts.js` (equality-only
`getCountFromServer`).

**Per row (source, index?):**
- Failed documents: `needsAttentionFilter` (exists).
- Awaiting signature >7 d: `status in AWAITING` + `createdAt <` uses the existing `signing_requests status+createdAt`
  index. Expired: new index (item 14).
- PEV pending / no response: `verification_requests` is unreadable by the company (rules L232–234). Add a
  server-maintained counter on the application (e.g. `pevOpenCount`, `pevNoResponseCount`) updated by
  `requests.js` / `responses.js` / `reminders.js` / item 6's callable. Count it with `where('pevOpenCount','>',0)`
  (single-field).
- Changes awaiting the driver: `hasPendingCompanyChanges == true` (single-field, exists on applications).
- Unfinished applications expiring within 5 d: drafts are server-only (rules L465), so a callable count with
  `where('expiresAt','<=', now+5d)` (Admin SDK). Single-field on `expiresAt` stays available unless exempted (TTL fields
  are not exempt here).
- Expiring med card / CDL: item 18.
**Rules/indexes:** no rules; an index only for expired documents (14) and expirations (18).
**Owner decision:** yes (audit: which rows customers want).
**Dependencies:** 8/6 (PEV counters), 14, 18.
**Size:** M. **Risks:** read cost on every dashboard open (each count is a billed aggregation). Cache it like
`useServerAggregate`.
**Tests:** `src/features/company-admin/components/CompanyAdminDashboard.reads.test.jsx`, `CompanyAdminDashboard.loading.test.jsx`;
backend tests for the counters.

---

## Item 17 — DQ file: "what's missing" checklist

**Verdict: Confirmed** (absent). `DQ_FILE_TYPES` (11, frozen and documented in `DQFileTab.jsx:30-42, 85-97`). The
automatic row names differ: "Application for Employment" (`preserveApplicationPdf.js:38`), "CDL Front"/"Medical
Card"/"MVR"… (`dqUploads.js:22-31`), "PEV Request – X" (`requestAttachment.js:72`). There is no hire date anywhere (no
`hiredAt` / `hireDate` writer).

**Where to change.** A pure mapping module (e.g. `src/features/company-admin/utils/dqChecklist.js`) from record
`type`/`fileType` to checklist items, plus PEV coverage from `employers[].verification`, with a 3-year window from the
employers' dates. Render it above the list in a new component (DQFileTab is 510 lines). The hire date: stamp
`hiredAt` when the status becomes Hired/Approved (`useAppActions.handleStatusUpdate`, or server in
`onApplicationStatusChanged`).
**Rules/indexes:** no / no.
**Owner decision:** yes (audit §8.4, §8.6): one list for all or per company? Does SafeHaul keep the hired driver's DQ
file? The wording must not claim FMCSA compliance (APP_BRIEF §10, `check:public-claims`).
**Dependencies:** 4, 6, 8, 19 (more automatic rows); 18 (expiry).
**Size:** M. **Risks:** a compliance claim in the wording; the frozen `DQ_FILE_TYPES` contract (tests pin it).
**Tests:** `src/features/company-admin/components/tabs/DossierBodies.dqfile.test.jsx` + a unit test for the mapping.

---

## Item 18 — CDL / med card expiry: "expiring soon"

**Verdict: Confirmed.** A manual DQ upload has no `expirationDate` (`DQFileTab.jsx:232-243`). The date comes only from
the application field (`dqUploads.js:46,57`) and refreshes only when the upload's key changes
(`driverSync.js:263-275` `isNew`). An approved change to `cdlExpiration` leaves the DQ date stale. The registry entry
`dq-expiry-monitoring` is `PLANNED` (`safehaulCapabilities.js:262-272`).

**Where to change.** (1) DQ tab: an optional "valid until" input saved as `YYYY-MM-DD` for Medical Card / MVR / CDL types.
(2) `onApplicationUpdated` (`driverSync.js:257`): when `cdlExpiration` / `medCardExpiration` / `twicExpiration` changes,
update `expirationDate` on the synced records of that type. (3) The "expiring in 30 d" list. Today `dq_files` has
**no collection-group rule** (only the `applications`, `leads`, `activity_logs`, `signing_requests` groups,
rules L660–678) and records carry no `companyId`. So either (a) a server-maintained denormalised field on the
application (e.g. `dqExpiresNext: 'YYYY-MM-DD'`, set by a `dq_files` write trigger), queried as `status in
[Hired, Approved] && dqExpiresNext <= X`, which needs a **new composite index** and no rules change; or (b) a
collection-group query, which needs a **rules change** (a new `{path=**}/dq_files` rule) and `companyId` stamping on
every record. Prefer (a). (4) The optional daily notification is a scheduled job (cost).
- Do **not** write the DQ date back into `medCardExpiration` on the application: that is the driver's answer, and
  company edits need driver approval (APP_BRIEF §5).
**Rules/indexes:** (a) no rules + **index yes**; (b) **rules yes** + collection-group index.
**Owner decision:** yes (audit §8.4): does SafeHaul track hired drivers? Marketing and the registry entry must change
at launch.
**Dependencies:** 16, 17.
**Size:** M. **Risks:** marketing claims (`check:public-claims`); scheduled-job cost; a trigger on `dq_files` writes runs
on every DQ write.
**Tests:** `functions/test/unit/driverSync.dqFiles.test.js`, `syncDqFiles.test.js`; `DossierBodies.dqfile.test.jsx`;
the registry test for `safehaulCapabilities`.

---

## Item 19 — The recruiter-attached PSP report goes into the DQ file

**Verdict: Confirmed.** `psp-report-upload` exists (`applicationSections.json:779-783`) and is offered in the recruiter's
panel (`ApplicationDocumentsPanel.jsx:21`). It is a guest upload, so `uploadKeys` would accept it, but it is not in
`DQ_UPLOADS` (`dqUploads.js:22-31`) or in `STANDARD_DOCUMENTS` (`DocumentsTab.jsx:37-46`).

**Where to change.** Add `{ field: 'psp-report-upload', type: 'psp_report', label: 'PSP Report' }` to `DQ_UPLOADS`, and the
same field to `DocumentsTab` if item 21 keeps that tab. Note that `syncDqFiles` (on DQ tab open) and
`onApplicationUpdated` will then **retroactively file** the PSP report of every existing application whose DQ tab is
opened. That is a behaviour change to state to the owner.
**Rules/indexes:** no / no.
**Owner decision:** yes (audit §8.5): keep the PSP report (an FCRA consumer report) in the DQ file? Retroactive filing
for existing applications?
**Dependencies:** 17 (checklist row), 21.
**Size:** S. **Risks:** the FCRA retention decision. The driver's own imported PSP stays unstored (APP_BRIEF §10), and
this field is only the recruiter-attached file.
**Tests:** `functions/test/unit/driverSync.dqFiles.test.js`, `syncDqFiles.test.js`; `DocumentsTab.contract.test.jsx` if changed.

---

## Item 20 — Consents shown individually on the DQ row

**Verdict: Confirmed.** The DQ entry for the original carries `snapshotId` (`preserveApplicationPdf.js:85-115`). The snapshot
is team-readable (`submission/{v}`, rules L445–448). The presenter already exists:
`toDisplayAgreements` / `describeAgreementEvidence` (`src/features/applications/services/submissionPresenter.js:217-219, 281`),
rendered in `PreservedApplicationView.jsx:296-303`.

**Where to change.** In the DQ tab, for `requiresAuditedAccess` rows, read `submission/{snapshotId}` once and render the
`toDisplayAgreements` list in a small sub-component. Keep the download on `downloadPreservedApplicationPdf`, which is
audited. Never regenerate the PDF.
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** none.
**Size:** S. **Risks:** one extra read per DQ open; the frozen DQ tab contract.
**Tests:** `DossierBodies.dqfile.test.jsx`; `submissionPresenter` tests; `PreservedApplicationView.test.jsx` (unchanged).

---

## Item 21 — One files tab instead of two

**Verdict: Confirmed.** `STANDARD_DOCUMENTS` is the same eight fields as `DQ_UPLOADS` (`DocumentsTab.jsx:37-46` vs `dqUploads.js:22-31`).
The tab id is `documents` (`DossierSidebar.jsx:42`). Contract tests pin it (`DocumentsTab.contract.test.jsx`,
`DossierContent.lazyTabs.test.jsx`, `DossierSidebar.contract.test.jsx`).

**Where to change.** Either remove the tab (and its image preview) or turn it into "All files" by merging DQ records,
signing requests (3) and PEV files. Move the preview into the DQ tab first.
**Rules/indexes:** no / no.
**Owner decision:** yes (remove or merge). Mild: it is a UI-only change, but `.claude/rules/ui.md` and roadmap updates apply.
**Dependencies:** 3, 4, 6, 19.
**Size:** S (remove) / M (merge). **Risks:** frozen contract tests; visual baselines (`app-visual` lane).
**Tests:** `DocumentsTab.contract.test.jsx`, `DossierSidebar.contract.test.jsx`, `DossierContent.lazyTabs.test.jsx`, `e2e/driver-dossier.spec.cjs`.

---

## Item 22 — "[Application link]" placeholder in campaigns and automated SMS

**Verdict: Confirmed.** The campaign variables are Driver Name / Company Name / Recruiter Name (`ContentComposer.jsx:38-42`),
filled in `sendLoop.js:49-52`. `[Recruiter Name]` is the **campaign sender's** name, not the lead's assignee. ATS SMS
supports `{driver name}`, `{user name}` (`atsSmsTemplate.js:10-17`). Attribution by `recruiterCode` works
(`shared/recruiterAssignment.js:19-33`, `driverSync.js:199-221`). `recruiter_links` is `code → { companyId, userId }`
(public read).

**Where to change.** `sendLoop.js` `fillPlaceholders` and `atsContactSms.js`: replace `[Application Link]` /
`{application link}` with `${baseUrl}/apply/${appSlug}?r=${code}`. `code` is the recipient's `assignedTo` recruiter
link: `recruiter_links where companyId==… && userId==…`, cached per batch. Fall back to the plain apply URL. Add the
variable to `ContentComposer`. Base URL: the company's `appUrl` or `APP_BASE_URL`, as in other senders.
**Rules/indexes:** no / no (two equality filters merge on single-field indexes).
**Owner decision:** no (optional: should a recruiter without a link get one created automatically?).
**Dependencies:** pairs with 11.
**Size:** S. **Risks:** SMS segment cost; no PII in the URL; the code must belong to this company (checked again at
submission).
**Tests:** `functions/test/unit/batchWorker.messageFields.test.js`, `atsContactSms.sender.test.js`, `src/tests/atsSmsTemplate.vitest.test.js`;
`src/features/campaigns/components/ContentComposer.test.jsx`.

---

## Item 23 — "Retry seal" button

**Verdict: Confirmed** (no retry). The trigger fires only on a transition into `pending_seal` (`digitalSealing.js:81-84`). The
UI shows "Seal Failed" with no action (`EnvelopeHistory.jsx:34, 225, 253`; `SentDocumentDetailsDialog.jsx:66, 104+`).
`postApplicationEdocs.js:213` already calls retry "a company-side concern". Safety analysis: §8.3 below.

**Where to change.** A team callable `retrySealDocument({ companyId, requestId })`. Transaction: allow only `status ===
'error_sealing'`, or `pending_seal` older than ~10 min, because a crash or 300 s timeout leaves `pending_seal`
forever (see §8.3). Set `status: 'pending_seal'`. Append `sealAttempts: arrayUnion({ at, by, previousError: errorLog })`,
clear `errorLog` and `missingFields`. The `error_sealing → pending_seal` update fires `sealDocument`. Accept no values
from the caller. Add the button in `SentDocumentDetailsDialog` / `EnvelopeHistory`. Fixing a missing company signature
on one document means setting that field's `companySignaturePath` (the team may write it today); record that in
`sealAttempts`.
**Rules/indexes:** no / no.
**Owner decision:** no (optional: should retry be admin-only?).
**Dependencies:** 2 (a failure notification tells someone to press it); 4 (deterministic DQ id survives retries).
**Size:** S. **Risks:** the certificate's "COMPLETED AT" is the seal time (`new Date()`, L253), so a retry stamps the retry
time. Consider printing `signedAt` instead; that changes future certificates, so it needs its own decision. The team can
already edit `fieldValues` directly (rules), so a retry seals whatever is stored. Optionally hash `fieldValues` in
`submitPublicEnvelope` and verify it at seal.
**Tests:** `functions/test/unit/digitalSealing.test.js`, `digitalSealing.companySignature.test.js` (retry after a missing
signature image; values unchanged; the signature PNGs deleted only after success); `e2e/edoc-envelope-history.spec.cjs`.

---

## Item 24 — "Company readiness" card

**Verdict: Confirmed.** `getEmailSettingsMeta` returns `isVerified` (`getEmailSettingsMeta.js:37-80`) and is **admin-strict**
(L27–28). SMS config is in `integrations/sms_provider` (admin-readable, rules L513–520). Post-application forms are in
`companies/{id}.postApplicationTemplates`. PEV CC is `companies/{id}.pevCcEmails` (`PevCopiesSection.jsx:11,39`).
The carrier PEV notices need `contact.email` (`notifications.js:41-44`). The company-signature image is a field of
templates.

**Where to change.** A dashboard card for admins only (the email meta callable refuses others). Data: email meta, SMS
integration doc, company doc (`contact.email`, `pevCcEmails`, `postApplicationTemplates`), plus templates with a
`company_signature` field lacking `companySignaturePath` (post-application sends are refused without it,
`postApplicationEdocs.js:314-319`).
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** none.
**Size:** S. **Risks:** a card for recruiters would need a non-admin meta callable.
**Tests:** `CompanyAdminDashboard.reads.test.jsx`; `functions/test/unit/saveEmailSettings.verify.test.js` (meta unchanged).

---

## Item 25 — Stop writing the unread `pending_updates` copy

**Verdict: Confirmed.** `processDriverData` writes `drivers/{uid}/pending_updates` (`driverSync.js:93-120`). It runs for every
application (L246) and every created lead (`onCompanyLeadSubmitted`, L345–351). Nothing in `src/` or `functions/` reads it
(only the SSN cleanup `maintenance/cleanup/ssnCopies.js` and the rules decisions table). `companyIds` stamping follows
it (L124–145).

**Where to change.** Delete the `stagingData` build and `add` (L93–122). Keep identity resolution (`auth.getUserByEmail`,
phone lookup) because the `companyIds` stamp needs `driverUid`. APP_BRIEF §8 "Driver sync" and the
`firestore-data-model.md` line mentioning `pending_updates` must be updated. Old docs: a Data cleanup item (owner-run).
**Rules/indexes:** no / no (the decisions table entries can stay; the path is already "nobody").
**Owner decision:** no for the code; yes for deleting existing docs (data deletion needs an explicit request, AGENTS §1).
**Dependencies:** none.
**Size:** S. **Risks:** `drivers.companyIds` is load-bearing for reads (APP_BRIEF §9): tests must pin that it is still set.
**Tests:** `functions/test/unit/driverSync.applicationWrites.test.js`, `driverSync.noSsnCopy.test.js` (no longer
writes; `companyIds` still stamped), `dataCleanup.ssnCopies.test.js` (unchanged).

---

## Item 26 — Shorter status list

**Verdict: Confirmed.** The dropdown is 8 funnel + `Interested` + 10 legacy (`atsStatus.js:30-35`), plus the current value
(`DossierHeader.jsx:73-79`). `New` (quick add, `ATS_STATUS_NEW`) vs `New Lead` (import, `LEAD_DEFAULT_STATUS`) vs
`New Application`.

**Where to change.** `DossierHeader.jsx` `statusOptions`: funnel + `Interested` + the current value only. Display labels
through `applicationStatusLabel` (APP_BRIEF §5 already does this for lists). Show `New`/`New Lead`/`New Application` as
"New". Stored values unchanged.
**Rules/indexes:** no / no.
**Owner decision:** light (is hiding legacy values from the picker OK?).
**Dependencies:** 10.
**Size:** S. **Risks:** users relying on legacy values lose them in the picker (they remain valid).
**Tests:** `DossierHeader.test.jsx`, `DossierHeader.contract.test.jsx`, `src/tests/statusVocabulary.test.js`.

---

## Item 27 — Edit Application: only editable fields

**Verdict: Confirmed** (already a documented limitation, APP_BRIEF §12 L1377–1380). `proposeApplicationChanges` skips
anything outside `EDITABLE_FIELD_KEYS` (`applicationChanges.js:87-89`, `shared/applicationEditableFields.js:19-26`). The
client only reports "No applicable changes" when **all** are skipped (`useApplicationChanges.js:40-44`) and ignores
`res.data.skipped`.

**Where to change.** Move `EDITABLE_FIELD_KEYS` into a JSON file under `functions/shared/`. The existing pattern is
`driverOnlyFields.json` / `applicationSections.json`, imported by both sides, e.g. `unfinishedEditorModel.js:28-29`.
Use it to make non-editable fields display-only in `SchemaRenderer` edit mode. Also surface `skipped` in the toast.
Update APP_BRIEF §12.
**Rules/indexes:** no / no.
**Owner decision:** no.
**Dependencies:** none.
**Size:** S. **Risks:** the JSON must stay the single list (keep the "written by hand" comment's intent).
**Tests:** `functions/test/unit/applicationChanges.test.js`; `src/shared/components/schema/SchemaRenderer.test.jsx`;
`ApplicationTab.contract.test.jsx`.

---

## §8 "Что проверить глубже" — answers from the code

### 8.1 Lead phone and email fields per source (for item 11)

| Source | Writer | `email` | `phone` | phone key |
|---|---|---|---|---|
| Quick add | `QuickAddLeadPage.jsx:114-131` (client) | as typed (not lowercased) | as typed | `normalizedPhone` = `helpers.normalizePhone` (digits; 11-digit leading `1` stripped) |
| CSV / sheet import | `import.worker.js:135-166` + `useCompanyLeadUpload.js:193-205` | as in file (not lowercased); missing → `placeholder_<hash>@<PLACEHOLDER_DOMAIN>` + `isEmailPlaceholder: true` | `formatPhoneNumber(raw)` | `normalizedPhone` (same helper) |
| Facebook (off) | `functions/integrations/facebook.js:462-483` | as Meta sends it | `phone_number` as sent | `normalizedPhone` = `normalizeSearchPhone` (identical rule) |
| Referral quick form | `submitReferralInterest.js:41-51, 118-133` | trimmed + **lowercased** | `normalizePhone` (E.164) | `normalizedPhone` (10 digits) |
| "Search DB Call" | `useCallOutcome.js:149-157` (`setDoc` copy when missing) | copied | copied | whatever the source had |
| Older leads | — | — | — | may lack `normalizedPhone`; backfilled by Data cleanup → lead fields (`maintenance/cleanup/leadFields.js:38-41`) |
| **Applications** | `buildApplicationDoc.js:233-264` | `email` lowercased+trimmed **and** `emailNormalized` | `phone` as typed | **`phoneNormalized`** (`normalizeSearchPhone`) |

Leads have **no** `emailNormalized` / `phoneNormalized`, and applications have no `normalizedPhone`. The two phone
normalisations are the same rule, so `applications.phoneNormalized == leads.normalizedPhone` matches. Email matching is
case-sensitive in Firestore and lead emails are not normalised (except referral), while an application keeps only the
lowercased form (`email` and `emailNormalized` alike), so `leads.email == app.emailNormalized` misses a lead typed in
another case. Compare canonical values on both sides: start writing `emailNormalized` (trimmed, lowercased) on leads,
with a Data cleanup backfill for existing leads, and match on it; phone matching works without that. Exclude placeholder emails (`isPlaceholderEmail`). `existingRecord()` in
`submitReferralInterest.js:55-63` is the server-side precedent.

### 8.3 Is re-running a failed seal safe? (item 23)

Mostly yes, with three caveats.
- **Signed values:** stable. `submitPublicEnvelope` writes the final `fieldValues` (signed date stamped) and, when stamped,
  `fields`, then `pending_seal` (`publicSigning.js:375-395`). The seal reads only those (`digitalSealing.js:126-127`), and
  the original PDF is at a timestamped `storagePath` that edits never overwrite (`envelopePersistence.js:273`).
- **Signature images:** present in every `error_sealing` case. The PNG deletions (L293–301) run only after the
  successful `'signed'` update (L285–290). Both failure paths (missing required/company signature L230–239; the
  exception catch L320–322) return before them. `cleanupOrphanedSignatures` only processes paths recorded after a
  *successful* seal. Corollary: failed documents keep signature PNGs indefinitely (a PII retention gap that a successful
  retry closes). Images saved by `submitPublicEnvelope` are all saved before `pending_seal`, since a failed wave rolls
  back (`publicSigning.js:279-292`).
- **Audit trail:** `auditTrail`, `signedAt` unchanged. **But** the certificate's "COMPLETED AT" is `new Date()` at seal
  time (L253), so a retry stamps the retry time. A new `sha256Checksum` is written (no earlier one exists for a failed
  seal; the output path `completed/{requestId}_signed.pdf` is simply overwritten).
- **Gaps:** (1) a crash, OOM or 300 s timeout leaves `status: 'pending_seal'` forever (never `error_sealing`), so the retry
  must also accept a stale `pending_seal`. (2) A failure caused by an unreadable signer PNG repeats on retry. (3) The
  team can write `fieldValues` directly today (rules L357–364), so a retry seals whatever is stored. Integrity relies
  on that rule, not on the retry.

### 8.5 Who may send PEV requests — code vs brief

- **Code:** any company team member: `company_admin`, `hr_user`, `recruiter`, or a super admin, plus the company owner
  fallback `ownerId/createdBy` (`requests.js:121` → `assertCompanyAccessForRequest` → `assertCompanyAccess`,
  `shared/companyAccess.js:48-93`). The UI does not gate either: the PEV tab shows for everyone
  (`DossierSidebar.jsx:44`; `PEVTab.jsx` checks only `features.pev`).
- **Brief / comments:** APP_BRIEF §4 L324 "A company admin sends a request"; the `requests.js` header L3 "Company admin
  triggers". The audit cites `requests.js:62`; the actual call is at **L121**.
- They disagree. This is an owner decision. If "admin only": `assertCompanyAdminStrict` in `sendVerificationRequest` and
  hide the actions for non-admins. Otherwise fix the brief and the comment.

### 8.6 Does `notifySignerSMS` check the opt-out list?

**No.** `textSigningLink` (`notifySignerSMS.js:35-81`) goes straight to `adapter.sendSMS` with no `isBlacklisted`. The same
function sends correction texts (`resendSignerOnCorrection.js:51`). The recipient is usually the signer the recruiter
named, a transactional message. Any added check should fail with a recorded `smsStatus: 'failed', smsError: 'opted out'`
(which shows as "needs attention" through `deliveryFailedFilter`) rather than silently.

---

## Audit claims that are wrong, imprecise or already fixed

None of the 27 is **already fixed**, and none is wrong in substance. Corrections an implementer needs:

1. **Item 1 / §8.1 "старые заявки без ответа"** — imprecise. The SMS question is **optional** for every applicant, and
   leads (other than referral) were never asked. "Unanswered = do not text" would stop all automated lead SMS.
2. **§3.3 "Экран «спасибо» хранится в браузере водителя 24 часа"** — imprecise. It is `sessionStorage` (one tab), with a
   24 h cap, and it is gone when the tab closes (`postApplyDocsStorage.js:20,32-48`). That makes the audit's point stronger.
3. **§3.5 "дата первого открытия"** — imprecise. After a reminder (`status: 'reminder_sent'`), the next open overwrites
   `openedAt` (`portal.js:47-51`).
4. **§3.18 "Почта компании не настроена — … PEV … молча не работает"** — partly. The *initial* PEV send fails loudly
   ("Failed to initiate verification"), while still leaving a phantom request (item 8.4). Signer emails record
   `emailStatus: 'failed'` (shown as needs-attention). Silent: the applicant confirmation, PEV reminders and carrier
   PEV notices.
5. **Item 6 "та же проверка прав (getSignedPevUrl)"** — the server signer supports `pev_results/`, but the DQ tab sends only
   `pev_requests/` paths to it (`pevRequestPath.js`). A client change is required.
6. **Item 9 "эта дата уже записывается в запросе"** — true, but the company cannot read `verification_requests` (super admin
   only), so showing it needs a server mirror onto the employer row.
7. **§8.5 citation** — `assertCompanyAccessForRequest` is at `requests.js:121`, not `:62`.
8. **APP_BRIEF §4 "Bulk SMS / email campaigns. Audiences over leads"** — the brief is wrong. The CRM audience defaults to
   `applications` (`AudienceBuilder.jsx:89-93`). The audit is right.

**Defects the audit missed (relevant to items 5, 6, 8, 9):**
- **A. Manual "Upload Result" never completes the request.** Reminders keep emailing the employer, and on day 30 the row's
  "Completed" is overwritten with "No Response (Good Faith Documented)" (`PEVTab.jsx:287-326`; `reminders.js:62-70, 134-146`).
- **B. PEV "Resend" leaves the earlier request live.** Duplicate reminders, and its day-30 mark overwrites the row (no
  supersede anywhere in `functions/employmentVerification/`).
- **C. The carrier "complete" email says the result PDF was "automatically added to the applicant's DQ file"**, which is
  false today (`emailTemplates.js`, `buildCarrierCompleteEmailHTML`).
- **D. Post-application prefill exposes every top-level application scalar as a token, including `ssn` and `signature`**
  (`postApplicationEdocs.js:123-129`). A template token `{{ssn}}` would put the SSN into a sealed, team-readable PDF.
- **E. `src/firestore.rules` is at 679 of 700 lines.** Any rules work (items 10/11 new statuses, 15 hardening, 18 option b)
  must also stay inside that limit.

## Summary table

| # | Verdict | Rules change? | Index? | Owner decision? | Size |
|---|---|---|---|---|---|
| 1 | Confirmed (scope corrected) | no | no | yes (unanswered apps; never-asked leads) | S |
| 2 | Confirmed | no | no | no | S |
| 3 | Confirmed | no | no | yes (auto-send links after submit?) | M |
| 4 | Confirmed | no | no | no | S (post-app) / M with 5 |
| 5 | Confirmed (+SSN prefill risk) | no | no | no | M |
| 6 | Confirmed (+defects A, C) | no | no | no | S / M with manual-upload callable |
| 7 | Confirmed | no | no | no | S |
| 8 | Confirmed (+defect B) | no | no | yes (legal wording) | M (8.4+supersede: S) |
| 9 | Confirmed (needs mirror) | no | no | no | S |
| 10 | Confirmed | no (only if a new status value) | no | yes (outcome→stage table) | S |
| 11 | Confirmed | no (unless new lead status) | no | yes (multi-match, lead status) | M |
| 12 | Confirmed | no (do it in the callable) | no | no | S |
| 13 | Confirmed | no | no | yes (keep copy link? SMS?) | M |
| 14 | Confirmed | no | yes (expired count; auto-reminder) | yes (auto reminder) | S / M |
| 15 | Confirmed | no (optional hardening = yes) | no | yes (routing scope) | M |
| 16 | Confirmed (absent) | no | via 14/18 | yes (which rows) | M |
| 17 | Confirmed (absent) | no | no | yes (list scope; post-hire) | M |
| 18 | Confirmed | no (option a) / yes (option b) | yes | yes (post-hire tracking) | M |
| 19 | Confirmed | no | no | yes (keep PSP; retroactive) | S |
| 20 | Confirmed | no | no | no | S |
| 21 | Confirmed | no | no | yes (remove vs merge) | S / M |
| 22 | Confirmed | no | no | no | S |
| 23 | Confirmed | no | no | no | S |
| 24 | Confirmed | no | no | no | S |
| 25 | Confirmed | no | no | yes only for deleting old docs | S |
| 26 | Confirmed | no | no | light | S |
| 27 | Confirmed | no | no | no | S |
