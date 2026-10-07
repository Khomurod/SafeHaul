/**
 * A driver's saves and resumes over a Company Admin's edits.
 *
 * Part of the `applicationDrafts` suite; see `applicationDrafts.support.js` for
 * the Firestore double and `shared/companyEdits.js` for the protocol. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const {
    mockStore, mockRunTransactionCalls, mockDeletedPaths, COMPANY, IDENTITY, CONTEXT, keyFor,
    saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

const drafts = require('../../applicationDrafts');

beforeEach(resetDraftState);

/** A revision is the edit's time in milliseconds. */
const EDITED_AT = 1791300000000;
const draftPath = (key = keyFor()) => `companies/${COMPANY}/application_drafts/${key}`;

/** What a Company Admin's edit leaves on a draft: the answers, and the revisions. */
function editAsCompany(changes, revision = EDITED_AT, key = keyFor()) {
    const current = mockStore.get(draftPath(key));
    mockStore.set(draftPath(key), {
        ...current,
        formData: { ...current.formData, ...changes },
        companyRevision: revision,
        companyEdits: {
            ...(current.companyEdits || {}),
            ...Object.fromEntries(Object.keys(changes).map((field) => [field, revision])),
        },
    });
}

const auditCount = () => [...mockStore.keys()].filter((key) => key.includes('application_draft_audit')).length;

describe('a save over a Company Admin\'s edit', () => {
    it('is refused, with nothing written, from a copy older than the edit', async () => {
        const { resumeToken, applicantKey } = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });

        const reply = await saveFirstPage({
            resumeToken,
            resumeApplicantKey: applicantKey,
            seenRevision: EDITED_AT - 1,
            formData: { firstName: 'Dana', city: 'Austin' },
        });

        expect(reply).toEqual({ saved: false, companyUpdated: true, applicantKey: null, resumeToken: null });
        expect(mockRunTransactionCalls.at(-1).writes).toEqual([]);
        expect(mockStore.get(draftPath()).formData.city).toBe('Dallas');
    });

    it('is not recorded as a probe: the browser proved the draft is its own', async () => {
        const { resumeToken } = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });
        const before = auditCount();

        await saveFirstPage({ resumeToken, seenRevision: 0 });

        expect(auditCount()).toBe(before);
    });

    it('is written from a copy that has taken the edit, and the record of the edit stays', async () => {
        const { resumeToken } = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });

        const reply = await saveFirstPage({
            resumeToken,
            seenRevision: EDITED_AT,
            formData: { firstName: 'Dana', city: 'Dallas', zip: '75001' },
        });

        expect(reply.saved).toBe(true);
        const stored = mockStore.get(draftPath());
        expect(stored.formData).toMatchObject({ city: 'Dallas', zip: '75001' });
        // Another copy of this application, on another device, may still predate it.
        expect(stored.companyRevision).toBe(EDITED_AT);
        expect(stored.companyEdits).toEqual({ city: EDITED_AT });
    });

    it('is written exactly as before from a browser that predates edits', async () => {
        // The Production page until a release is promoted. It never says a revision,
        // so it is never refused, and its copy wins as it always has.
        const { resumeToken } = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });

        const reply = await saveFirstPage({ resumeToken, formData: { firstName: 'Dana', city: 'Austin' } });

        expect(reply.saved).toBe(true);
        expect(mockStore.get(draftPath()).formData.city).toBe('Austin');
    });

    it.each([['a string', '9'], ['a negative number', -1], ['a fraction', 2.5]])(
        'reads %s as a browser that predates edits',
        async (_what, seenRevision) => {
            const { resumeToken } = await saveFirstPage();
            editAsCompany({ city: 'Dallas' });

            expect((await saveFirstPage({ resumeToken, seenRevision })).saved).toBe(true);
        },
    );

    it('is never refused, and adds nothing, on a draft nobody edited', async () => {
        const { resumeToken } = await saveFirstPage();

        expect((await saveFirstPage({ resumeToken, seenRevision: 0 })).saved).toBe(true);
        expect(mockStore.get(draftPath())).not.toHaveProperty('companyRevision');
        expect(mockStore.get(draftPath())).not.toHaveProperty('companyEdits');
    });

    it('is written from a copy whose revision is later than the draft\'s', async () => {
        // A draft deleted and started again has no edits, while the browser still
        // holds the old draft's revision. Revisions are times, so that leftover is
        // never later than an edit the new draft takes afterwards.
        const { resumeToken } = await saveFirstPage();

        expect((await saveFirstPage({ resumeToken, seenRevision: EDITED_AT })).saved).toBe(true);
    });
});

describe('a corrected email, which moves the application to a new id', () => {
    const correctedKey = () => keyFor(COMPANY, 'dana.corrected@example.test');
    const correct = (overrides) => drafts.saveApplicationProgress({
        companyId: COMPANY,
        email: 'dana.corrected@example.test',
        phone: IDENTITY.phone,
        lastName: IDENTITY.lastName,
        dob: IDENTITY.dob,
        ssn: IDENTITY.ssn,
        formData: { firstName: 'Dana', city: 'Dallas' },
        ...overrides,
    }, CONTEXT);

    it('carries the edits along, so the next edit is still newer than the copy', async () => {
        const first = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });

        const moved = await correct({
            resumeToken: first.resumeToken, resumeApplicantKey: first.applicantKey, seenRevision: EDITED_AT,
        });

        expect(moved.saved).toBe(true);
        const stored = mockStore.get(draftPath(correctedKey()));
        expect(stored.companyRevision).toBe(EDITED_AT);
        expect(stored.companyEdits).toEqual({ city: EDITED_AT });
    });

    it('is refused from a copy older than the edit on the draft its token opened', async () => {
        const first = await saveFirstPage();
        editAsCompany({ city: 'Dallas' });

        const moved = await correct({
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            seenRevision: 0,
            formData: { firstName: 'Dana', city: 'Austin' },
        });

        expect(moved).toMatchObject({ saved: false, companyUpdated: true });
        expect(mockStore.has(draftPath(correctedKey()))).toBe(false);
        expect(mockStore.get(draftPath()).formData.city).toBe('Dallas');
    });

    /** The same driver's other unfinished application, at the corrected email, as the carrier left it. */
    async function otherDraft({ edited }) {
        await correct({});
        if (edited) editAsCompany({ city: 'Dallas' }, EDITED_AT, correctedKey());
    }

    it('is refused onto the same driver\'s other draft a Company Admin edited, which this browser cannot fetch', async () => {
        const first = await saveFirstPage();
        await otherDraft({ edited: true });
        const before = auditCount();

        const joined = await correct({
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            // Later than that draft's edit, and still no sight of it: a revision
            // speaks for the draft its copy came from, never for another one.
            seenRevision: EDITED_AT,
            formData: { firstName: 'Dana', city: 'Austin' },
        });

        expect(joined).toEqual({ saved: false, applicantKey: null, resumeToken: null });
        expect(mockRunTransactionCalls.at(-1).writes).toEqual([]);
        expect(mockStore.get(draftPath(correctedKey())).formData.city).toBe('Dallas');
        // Nothing was joined, so the draft this browser's token opens is not retired.
        expect(mockStore.has(draftPath())).toBe(true);
        expect(mockDeletedPaths).toHaveLength(0);
        // Not a probe: the caller proved both drafts are theirs.
        expect(auditCount()).toBe(before);
    });

    it('still joins the same driver\'s other draft when nobody edited it', async () => {
        const first = await saveFirstPage();
        await otherDraft({ edited: false });

        const joined = await correct({
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            seenRevision: 0,
            formData: { firstName: 'Dana', city: 'Austin' },
        });

        expect(joined.saved).toBe(true);
        expect(mockStore.get(draftPath(correctedKey())).formData.city).toBe('Austin');
        expect(mockStore.has(draftPath())).toBe(false);
    });

    it('joins an edited one as before from a browser that predates edits', async () => {
        const first = await saveFirstPage();
        await otherDraft({ edited: true });

        const joined = await correct({
            resumeToken: first.resumeToken,
            resumeApplicantKey: first.applicantKey,
            formData: { firstName: 'Dana', city: 'Austin' },
        });

        expect(joined.saved).toBe(true);
        expect(mockStore.get(draftPath(correctedKey())).formData.city).toBe('Austin');
    });
});

describe('a resume', () => {
    const resume = (saved) => drafts.resumeApplicationDraft({
        companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: saved.resumeToken,
    }, CONTEXT);

    it('hands over the edited answers, the revision, and each edited answer\'s', async () => {
        const saved = await saveFirstPage();
        editAsCompany({ city: 'Dallas' }, EDITED_AT);
        editAsCompany({ employers: [] }, EDITED_AT + 60000);

        const { draft } = await resume(saved);

        expect(draft.formData.city).toBe('Dallas');
        expect(draft.companyRevision).toBe(EDITED_AT + 60000);
        expect(draft.companyEdits).toEqual({ city: EDITED_AT, employers: EDITED_AT + 60000 });
    });

    it('says nobody edited a draft nobody edited', async () => {
        const { draft } = await resume(await saveFirstPage());

        expect(draft.companyRevision).toBe(0);
        expect(draft.companyEdits).toEqual({});
    });
});
