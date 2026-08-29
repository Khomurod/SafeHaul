/**
 * Changing a draft that already exists: resume tokens — stale, rotated,
 * absent and replayed.
 *
 * Part of the `applicationDrafts` suite. The Firestore double, the fixtures and
 * the properties this surface has to hold are in
 * `applicationDrafts.support.js`. Each `jest.mock` below has to stay in this
 * file, because Jest hoists it per file and cannot register one from a helper.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const drafts = require('../../applicationDrafts');
const {
    mockStore, mockServerTimestamp, IDENTITY, COMPANY, CONTEXT, keyFor, saveFirstPage,
    resetDraftState,
} = require('./applicationDrafts.support');

beforeEach(resetDraftState);

describe('changing a draft that already exists', () => {
    it('refuses a stale token from a draft that was discarded', async () => {
        const first = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: first.resumeToken,
        }, CONTEXT);
        // Recreate a draft at the same key, as a genuinely new application would.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'FRESH' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Ghost', cdlNumber: 'STALE' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('FRESH');
    });

    it('refuses a token whose draft was discarded, even with the full identity', async () => {
        // The multi-tab resurrection, from the server's side. One tab discards; the
        // other still has a request on the wire carrying the token *and* the
        // applicant's own name, date of birth and SSN. The identity bar authorizes
        // that payload perfectly well — which is why staleness has to be judged
        // before ownership, not instead of it.
        const first = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: first.resumeToken,
        }, CONTEXT);

        const inFlight = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Dana', cdlNumber: 'DISCARDED' },
        }, CONTEXT);

        expect(inFlight.saved).toBe(false);
        expect(inFlight.applicantKey).toBeNull();
        expect(inFlight.resumeToken).toBeNull();
        // Nothing was recreated.
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toEqual([]);
    });

    it('refuses a stale token even when the draft was recreated underneath it', async () => {
        // The nastier shape: the other tab discarded *and* began again, so a document
        // exists at this key again. Matching on the target alone would say "no token
        // match", fall through to the identity check, and let the old answers
        // overwrite the new application.
        const first = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: first.resumeToken,
        }, CONTEXT);
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'FRESH' } });

        const inFlight = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Dana', cdlNumber: 'DISCARDED' },
        }, CONTEXT);

        expect(inFlight.saved).toBe(false);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('FRESH');
    });

    it('records a refused stale token as its own outcome, not as an attack', async () => {
        // A browser that had a token for a draft the applicant discarded is ordinary
        // multi-tab life. Filing it as an unauthorized write would make the audit
        // trail read as though somebody was probing.
        const first = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: first.resumeToken,
        }, CONTEXT);
        const auditBefore = [...mockStore.entries()]
            .filter(([key]) => key.includes('application_draft_audit')).length;

        await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Dana' },
        }, CONTEXT);

        const audit = [...mockStore.entries()]
            .filter(([key]) => key.includes('application_draft_audit'))
            .map(([, value]) => value)
            .slice(auditBefore);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('draft_write_refused');
        expect(audit[0].outcome).toBe('stale_token');
    });

    it('still accepts the token of a draft that is alive, on a different key', async () => {
        // The legitimate flow the staleness rule must not break: the applicant
        // corrects their email, so this save writes a new key while holding the
        // previous draft's token — and that draft is alive right up until this same
        // save retires it.
        const first = await saveFirstPage();

        const corrected = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: 'dana.corrected@example.test',
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Dana', cdlNumber: 'TX44' },
        }, CONTEXT);

        expect(corrected.saved).toBe(true);
        expect(corrected.resumeToken).toBeTruthy();
        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain(keyFor(COMPANY, 'dana.corrected@example.test'));
    });

    it('still accepts the token when the applicant corrected their identity too', async () => {
        // The case the first version of this rule broke. Correcting a contact field
        // *and* an identity field before the same save changes the document id and the
        // identity HMAC together, so neither the target nor the identity query can see
        // the live draft the token belongs to. Refusing there would refuse every save
        // after it — silently killing autosave for an applicant who fixed a typo.
        const first = await saveFirstPage();

        const corrected = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: 'dana.fixed@example.test',
            phone: IDENTITY.phone,
            // A corrected surname: a different identity HMAC from the stored draft's.
            lastName: 'Alvarez-Nguyen',
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            formData: { firstName: 'Dana', cdlNumber: 'TX55' },
        }, CONTEXT);

        expect(corrected.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor(COMPANY, 'dana.fixed@example.test')}`)
            .formData.cdlNumber).toBe('TX55');
    });

    it('resolves the token by the key the browser names, beyond the scan window', async () => {
        // The residual the bounded scan leaves: at a busy company the owned draft can
        // be older than the recent window, so an applicant who corrected a contact
        // field *and* an identity field would be refused for good. The browser already
        // knows which key its token belongs to, so it says so — and the server still
        // verifies the hash on that document, which is why naming one proves nothing
        // on its own.
        // Enough other drafts to push the owned one outside the scan's 50-document
        // window. The double returns documents in insertion order, so these have to be
        // seeded first — which is also why this asserts the *hint*, not the ordering
        // of a real Firestore query.
        for (let i = 0; i < 60; i += 1) {
            mockStore.set(`companies/${COMPANY}/application_drafts/filler${i}`, {
                companyId: COMPANY,
                identityKey: `other-identity-${i}`,
                resumeTokenHash: `hash-${i}`,
                updatedAt: mockServerTimestamp(),
            });
        }
        const first = await saveFirstPage();

        const corrected = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: 'dana.moved@example.test',
            phone: '(469) 555-0142',
            lastName: 'Alvarez-Nguyen',
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            formData: { firstName: 'Dana', cdlNumber: 'TX66' },
        }, CONTEXT);

        expect(corrected.saved).toBe(true);
    });

    it('gains nothing from naming a key whose token does not match', async () => {
        // The hint is verified, not trusted. Pointing at somebody else's live draft
        // does not make a stale token valid.
        const victim = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: victim.resumeToken,
        }, CONTEXT);
        const other = await saveFirstPage({
            email: 'someone.else@example.test',
            phone: '(972) 555-0100',
            lastName: 'Nguyen',
            dob: '1990-07-04',
            ssn: '987-65-4321',
        });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: victim.resumeToken,
            resumeApplicantKey: other.applicantKey,
            formData: { firstName: 'Ghost' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
    });

    it('keeps accepting the first device after another device merely looked', async () => {
        // A resume lookup rotates the token on a *live* draft, before the applicant has
        // chosen anything — so a second device reaching the prompt, and then closing it,
        // must not make the first device's saves look like writes against a deleted
        // draft. Getting this wrong ends server autosave for somebody who deleted
        // nothing, and every save after it.
        const first = await saveFirstPage();

        const looked = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: IDENTITY.email,
        }, CONTEXT);
        expect(looked.resumable).toBe(true);
        expect(looked.resumeToken).not.toBe(first.resumeToken);

        const stillSaving = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            formData: { firstName: 'Dana', cdlNumber: 'TX77' },
        }, CONTEXT);

        expect(stillSaving.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${first.applicantKey}`)
            .formData.cdlNumber).toBe('TX77');
    });

    it('refuses a token rotated further back than the draft remembers', async () => {
        // The window is deliberately short: two generations. A token older than that is
        // old enough that refusing the write is the safer answer.
        const first = await saveFirstPage();
        for (let i = 0; i < 3; i += 1) {
            await drafts.findResumableApplication({
                companyId: COMPANY,
                lastName: IDENTITY.lastName,
                dob: IDENTITY.dob,
                ssn: IDENTITY.ssn,
                email: IDENTITY.email,
            }, CONTEXT);
        }

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            formData: { firstName: 'Dana', cdlNumber: 'TX88' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
    });

    it('still refuses a rotated token once the draft itself is gone', async () => {
        // The prior generations answer liveness only. Once Start Over has removed the
        // draft there is nothing to be live, and the old token opens nothing.
        const first = await saveFirstPage();
        const looked = await drafts.findResumableApplication({
            companyId: COMPANY,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            email: IDENTITY.email,
        }, CONTEXT);
        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: looked.resumeToken,
        }, CONTEXT);

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            formData: { firstName: 'Ghost' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
    });

    it('accepts a token-less first save, which is what a discarded tab sends next', async () => {
        // After a discard the client clears the shared token, so the tab's next save
        // presents none. That has to keep working: it is the new application.
        const fresh = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Dana', cdlNumber: 'BRAND-NEW' },
        }, CONTEXT);

        expect(fresh.saved).toBe(true);
        expect(fresh.resumeToken).toBeTruthy();
    });

    it('stays idempotent for a retried save with the same token', async () => {
        const first = await saveFirstPage();
        const payload = {
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            clientSeq: 4,
            formData: { firstName: 'Dana' },
        };

        const a = await drafts.saveApplicationProgress(payload, CONTEXT);
        const b = await drafts.saveApplicationProgress(payload, CONTEXT);

        expect(a.saved).toBe(true);
        expect(b.saved).toBe(true);
        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        // A token is minted once and never handed out again.
        expect(a.resumeToken).toBeNull();
        expect(b.resumeToken).toBeNull();
    });
});
