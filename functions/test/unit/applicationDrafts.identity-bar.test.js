/**
 * Changing a draft that already exists: the identity bar, the refusal budget,
 * and the callers that legitimately clear it.
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
    mockStore, mockRunTransactionCalls, mockNonTransactionalWrites, mockCheckRateLimit,
    IDENTITY, COMPANY, CONTEXT, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

beforeEach(resetDraftState);

describe('changing a draft that already exists', () => {
    it('refuses a caller who knows only the contact details', async () => {
        // The whole point: those three values derive the document id, and until now
        // nothing else was checked, so knowing them was enough to overwrite.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Attacker', cdlNumber: 'FAKE' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(attempt.resumeToken).toBeNull();
        // The same shape a network failure returns, so the refusal does not confirm
        // to a stranger that this person has an application here.
        expect(attempt.applicantKey).toBeNull();
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.formData.cdlNumber).toBe('REAL');

        // A refusal spends two budgets: one per caller, one per *targeted draft*, so
        // spreading attempts across addresses does not spread the budget with them.
        // This caller supplied no identity facts at all, and the target budget is
        // charged anyway — which is the point: it is keyed on the document being
        // attacked, not on identity facts the caller chooses.
        const refusalKeys = mockCheckRateLimit.mock.calls
            .map(([key]) => key)
            .filter((key) => key.startsWith('draft_write_denied'));
        expect(refusalKeys.sort()).toEqual([
            `draft_write_denied_${CONTEXT.rawRequest.ip}`,
            `draft_write_denied_target_${keyFor()}`,
        ].sort());

        // Audited under its own action — a refused write is a different operational
        // signal from a resume lookup, and must not inflate the lookup count. Still
        // value-free: no name, no contact detail, no identity hash.
        const audit = [...mockStore.entries()]
            .filter(([key]) => key.includes('application_draft_audit'))
            .map(([, value]) => value);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('draft_write_refused');
        expect(audit[0].outcome).toBe('unauthorized_write');
        const auditText = JSON.stringify(audit[0]);
        expect(auditText).not.toContain(IDENTITY.email);
        expect(auditText).not.toContain('123456789');
        expect(auditText).not.toContain(IDENTITY.lastName);
    });

    it('charges the same target budget however the caller varies its identity', async () => {
        // Why the budget is keyed on the target and not on the identity the caller
        // claims: the caller supplies those facts, so varying or omitting the SSN
        // would produce a fresh key on every request while every one of them still
        // attacks the same document. Three differently-shaped refusals, one shared
        // target budget.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });
        mockCheckRateLimit.mockClear();

        const shapes = [
            {},
            { lastName: 'Nguyen', dob: '1990-07-04', ssn: '987-65-4321' },
            { lastName: 'Other', dob: '1975-01-02', ssn: '555-00-1111' },
        ];
        for (const shape of shapes) {
            const attempt = await drafts.saveApplicationProgress({
                companyId: COMPANY,
                email: IDENTITY.email,
                phone: IDENTITY.phone,
                ...shape,
                formData: { firstName: 'Attacker' },
            }, CONTEXT);
            expect(attempt.saved).toBe(false);
        }

        const targetKeys = mockCheckRateLimit.mock.calls
            .map(([key]) => key)
            .filter((key) => key.startsWith('draft_write_denied_target_'));
        expect(targetKeys).toEqual(Array(3).fill(`draft_write_denied_target_${keyFor()}`));

        // Its own key, never the match budget the real applicant needs to find
        // their own draft.
        const allKeys = mockCheckRateLimit.mock.calls.map(([key]) => key);
        expect(allKeys.some((key) => key.startsWith('draft_match_id_'))).toBe(false);
        // A hash, so the limiter holds no name, contact detail or SSN of either party.
        const keyText = allKeys.join(' ');
        expect(keyText).not.toContain('987654321');
        expect(keyText).not.toContain('123456789');
        expect(keyText).not.toContain('Nguyen');
        expect(keyText).not.toContain(IDENTITY.lastName);
        expect(keyText).not.toContain(IDENTITY.email);

        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('REAL');
    });

    it('checks and writes in one transaction, so nothing slips through the gap', async () => {
        // A standalone read followed by a later write leaves a window. Two ways
        // through it both defeat the ownership rule: two first saves can each see no
        // document and each mint a token, and a save that read "exists, authorized"
        // can land *after* Start Over deleted the draft, resurrecting an application
        // the applicant had just discarded.
        //
        // Asserted on the transaction rather than on a contrived interleaving, which
        // this double cannot produce: the read that decides authorization and the
        // write it authorizes must be the same transaction's.
        mockRunTransactionCalls.length = 0;

        await saveFirstPage();

        expect(mockRunTransactionCalls).toHaveLength(1);
        const [{ reads, writes }] = mockRunTransactionCalls;
        const draftPath = `companies/${COMPANY}/application_drafts/${keyFor()}`;
        expect(reads).toContain(draftPath);
        expect(writes).toContain(draftPath);
        // And nothing else was written to that document outside a transaction.
        expect(mockNonTransactionalWrites.filter((path) => path === draftPath)).toEqual([]);
    });

    it('records nothing more once the refusal budget is spent', async () => {
        // The reply is deliberately identical either way — saying "you exceeded the
        // refusal budget" would confirm that the earlier attempts were refusals.
        // What the budget bounds is the audit writes one caller can cause.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });
        const auditBefore = [...mockStore.keys()].filter((key) => key.includes('application_draft_audit')).length;
        mockCheckRateLimit.mockImplementation(async (key) => !String(key).startsWith('draft_write_denied'));

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            formData: { firstName: 'Attacker' },
        }, CONTEXT);

        expect(attempt.saved).toBe(false);
        expect(attempt.resumeToken).toBeNull();
        expect([...mockStore.keys()].filter((key) => key.includes('application_draft_audit')).length)
            .toBe(auditBefore);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('REAL');
    });

    it('accepts the browser that holds the draft\'s resume token', async () => {
        const first = await saveFirstPage({ formData: { firstName: 'Dana' } });

        const update = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            resumeToken: first.resumeToken,
            lastStep: 3,
            formData: { firstName: 'Dana', cdlNumber: 'TX99' },
        }, CONTEXT);

        expect(update.saved).toBe(true);
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.formData.cdlNumber).toBe('TX99');
    });

    it('accepts a browser that lost its token but clears the identity bar', async () => {
        // Same bar `findResumableApplication` requires to *read* the draft. A caller
        // who clears it can already retrieve the whole thing by design, so writing
        // is not a new exposure — and it is what keeps a cleared browser's autosave
        // working.
        await saveFirstPage({ formData: { firstName: 'Dana' } });

        const update = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            formData: { firstName: 'Dana', cdlNumber: 'TX77' },
        }, CONTEXT);

        expect(update.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('TX77');
    });

    it('accepts a second device once it clears the identity bar', async () => {
        // Named for what it proves. Cross-device resume is a supported flow: a
        // phone that never held this draft's token, on a different address, is
        // authorized by the full identity plus contact details that match the
        // stored draft — the same bar that already lets it *read* the draft.
        await saveFirstPage({ formData: { firstName: 'Dana', cdlNumber: 'REAL' } });

        const attempt = await drafts.saveApplicationProgress({
            companyId: COMPANY,
            email: IDENTITY.email,
            phone: IDENTITY.phone,
            lastName: IDENTITY.lastName,
            dob: IDENTITY.dob,
            ssn: IDENTITY.ssn,
            formData: { firstName: 'Dana', cdlNumber: 'CHANGED' },
        }, { rawRequest: { ip: '198.51.100.7' } });

        expect(attempt.saved).toBe(true);
        expect(mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`).formData.cdlNumber)
            .toBe('CHANGED');
    });
});
