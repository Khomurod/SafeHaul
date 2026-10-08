/**
 * A Company Admin deleting an unfinished application with everything in it:
 * what the preview shows, which drafts go, and what is written as they go.
 *
 * Part of the `applicationDrafts` suite; the Firestore and Storage doubles are in
 * `applicationDrafts.support.js`. The files are `applicationDrafts.purge-files`,
 * and what a deleted application's own tab and link are told is
 * `applicationDrafts.removed`.
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
    mockStore, mockDeletedPaths, mockRunTransactionCalls, mockAssertCompanyAdmin, mockCheckRateLimit,
    mockServerTimestamp, COMPANY, resetDraftState,
} = require('./applicationDrafts.support');

const ADMIN = { uid: 'admin-1' };
const DRAFTS = `companies/${COMPANY}/application_drafts`;
const AUDIT = `companies/${COMPANY}/application_draft_audit`;
const DANA = 'aaaa1111bbbb2222cccc';
const DANA_AGAIN = 'aaaa1111bbbb2222dddd';
const SHARED_PHONE = 'aaaa1111bbbb2222eeee';
const STRANGER = 'aaaa1111bbbb2222ffff';
const IDENTITY = 'f'.repeat(64);

function seed(key, { formData = {}, ...fields } = {}) {
    mockStore.set(`${DRAFTS}/${key}`, {
        status: 'in_progress',
        contactEmail: 'dana@example.test',
        contactPhone: '2145550147',
        identityKey: IDENTITY,
        resumeTokenHash: `${key.slice(-4)}`.padEnd(64, 'a'),
        formData: { firstName: 'Dana', lastName: 'Alvarez', ...formData },
        createdAt: mockServerTimestamp(),
        updatedAt: mockServerTimestamp(),
        ...fields,
    });
}

/** Dana, Dana again under another email, a stranger on the same phone, and a stranger. */
function seedFamily() {
    seed(DANA, { formData: { 'cdl-front': { name: 'front.jpg', storagePath: `companies/${COMPANY}/applications/guest_uploads/1_a_front.jpg` } } });
    seed(DANA_AGAIN, { contactEmail: 'dana.alvarez@example.test', contactPhone: '9725550100' });
    seed(SHARED_PHONE, {
        contactEmail: 'sam@example.test', identityKey: 'c'.repeat(64), formData: { firstName: 'Sam', lastName: 'Ortiz' },
    });
    seed(STRANGER, {
        contactEmail: 'lee@example.test', contactPhone: '4695550199', identityKey: 'd'.repeat(64), formData: { firstName: 'Lee' },
    });
}

const purge = (data, auth = ADMIN) => drafts.purgeApplicationDraft({ auth, data: { companyId: COMPANY, ...data } });
const auditRows = () => [...mockStore.entries()].filter(([path]) => path.startsWith(`${AUDIT}/`));

beforeEach(() => {
    resetDraftState();
});

describe('who may ask', () => {
    it('answers only a Company Admin, before reading anything', async () => {
        seedFamily();
        mockAssertCompanyAdmin.mockRejectedValueOnce(Object.assign(new Error('Company Admin only.'), { code: 'permission-denied' }));

        await expect(purge({ applicantKey: DANA, preview: true })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(purge({ applicantKey: DANA }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockRunTransactionCalls).toHaveLength(0);
        expect(mockStore.has(`${DRAFTS}/${DANA}`)).toBe(true);
    });

    it('spends the preview and the deletion from budgets of their own', async () => {
        seedFamily();
        await purge({ applicantKey: DANA, preview: true });
        await purge({ applicantKey: DANA });

        const budgets = mockCheckRateLimit.mock.calls.map(([key, limit]) => [key, limit]);
        expect(budgets).toEqual([
            [`draft_admin_purge_preview_${COMPANY}_admin-1`, 120],
            [`draft_admin_purge_${COMPANY}_admin-1`, 30],
        ]);
    });

    it('stops a runaway loop', async () => {
        seedFamily();
        mockCheckRateLimit.mockResolvedValueOnce(false);

        await expect(purge({ applicantKey: DANA })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockStore.has(`${DRAFTS}/${DANA}`)).toBe(true);
    });
});

describe('the preview', () => {
    it('names the application, its files, and every draft that shares the identity, email or phone', async () => {
        seedFamily();

        const result = await purge({ applicantKey: DANA, preview: true });

        expect(result.application).toMatchObject({ applicantKey: DANA, firstName: 'Dana', fileCount: 1 });
        const related = Object.fromEntries(result.related.map((row) => [row.applicantKey, row.shares]));
        expect(related).toEqual({ [DANA_AGAIN]: ['identity'], [SHARED_PHONE]: ['phone'] });
        expect(result.related.find((row) => row.applicantKey === SHARED_PHONE)).toMatchObject({ firstName: 'Sam', fileCount: 0 });
        // A summary, as the list shows: never the answers, an identity key or a token.
        expect(JSON.stringify(result)).not.toMatch(/identityKey|resumeTokenHash|cdl-front/);
    });

    it('changes nothing', async () => {
        seedFamily();
        const before = new Map(mockStore);

        await purge({ applicantKey: DANA, preview: true });

        expect(mockStore).toEqual(before);
        expect(mockDeletedPaths).toEqual([]);
    });

    it('matches a prepared application, which has no identity key, by email or phone', async () => {
        seed(DANA, { identityKey: null, origin: 'company', status: 'prepared' });
        seed(DANA_AGAIN, { contactPhone: '9725550100' });

        const { related } = await purge({ applicantKey: DANA, preview: true });

        expect(related.map((row) => [row.applicantKey, row.shares])).toEqual([[DANA_AGAIN, ['email']]]);
    });

    it('never reaches another company', async () => {
        seed(DANA);
        mockStore.set(`companies/other-co/application_drafts/${DANA_AGAIN}`, {
            contactEmail: 'dana@example.test', contactPhone: '2145550147', identityKey: IDENTITY, formData: {},
        });

        const { related } = await purge({ applicantKey: DANA, preview: true });

        expect(related).toEqual([]);
    });

    it('answers not-found for an application that is gone', async () => {
        await expect(purge({ applicantKey: DANA, preview: true })).rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('the deletion', () => {
    it('deletes the application and the drafts the admin confirmed, and keeps the one they did not', async () => {
        seedFamily();

        const result = await purge({ applicantKey: DANA, alsoDelete: [DANA_AGAIN] });

        expect(result).toMatchObject({ deleted: [DANA, DANA_AGAIN], skipped: [] });
        expect(mockStore.has(`${DRAFTS}/${DANA}`)).toBe(false);
        expect(mockStore.has(`${DRAFTS}/${DANA_AGAIN}`)).toBe(false);
        expect(mockStore.has(`${DRAFTS}/${SHARED_PHONE}`)).toBe(true);
        expect(mockStore.has(`${DRAFTS}/${STRANGER}`)).toBe(true);
    });

    it('records each deletion, value-free, in the same transaction as the deletion', async () => {
        seedFamily();

        await purge({ applicantKey: DANA, alsoDelete: [DANA_AGAIN] });

        const entries = auditRows().map(([, row]) => row).filter((row) => row.action === 'company_purged_draft');
        expect(entries).toEqual([
            expect.objectContaining({ applicantKey: DANA, actorUid: 'admin-1', origin: 'driver', outcome: 'ok' }),
            expect.objectContaining({ applicantKey: DANA_AGAIN, withApplicantKey: DANA }),
        ]);
        expect(JSON.stringify(entries)).not.toMatch(/Dana|dana@|2145550147/);
        const [transaction] = mockRunTransactionCalls;
        expect(transaction.writes.filter((path) => path.startsWith(`${AUDIT}/auto-`))).toHaveLength(2);
    });

    it('leaves a removal mark holding every token the draft could still be named by', async () => {
        seed(DANA, {
            resumeTokenHash: '1'.repeat(64),
            priorResumeTokenHashes: ['2'.repeat(64)],
            inviteResumeTokenHash: '3'.repeat(64),
            inviteTokenHash: '4'.repeat(64),
            inviteTokenExpiresAt: new Date(Date.now() + 86400000),
        });

        await purge({ applicantKey: DANA });

        expect(mockStore.get(`${AUDIT}/removed_${DANA}`)).toMatchObject({
            action: 'draft_removed',
            tokenHashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
            expiresAt: expect.any(Date),
        });
    });

    it('keeps an earlier mark at the same key, for a driver whose second application went too', async () => {
        seed(DANA, { resumeTokenHash: '1'.repeat(64) });
        mockStore.set(`${AUDIT}/removed_${DANA}`, { action: 'draft_removed', tokenHashes: ['9'.repeat(64)] });

        await purge({ applicantKey: DANA });

        expect(mockStore.get(`${AUDIT}/removed_${DANA}`).tokenHashes).toEqual(['1'.repeat(64), '9'.repeat(64)]);
    });

    it('leaves alone a confirmed draft that no longer shares anything with the application, and says so', async () => {
        seedFamily();
        // Since the preview, the second draft's email and phone were corrected.
        seed(DANA_AGAIN, { contactEmail: 'someone@example.test', contactPhone: '8175550111', identityKey: 'e'.repeat(64) });

        const result = await purge({ applicantKey: DANA, alsoDelete: [DANA_AGAIN, STRANGER, 'not a key'] });

        expect(result).toMatchObject({ deleted: [DANA], skipped: [DANA_AGAIN, STRANGER] });
        expect(mockStore.has(`${DRAFTS}/${DANA_AGAIN}`)).toBe(true);
        expect(mockStore.has(`${DRAFTS}/${STRANGER}`)).toBe(true);
    });

    it('deletes nothing when the application itself is gone', async () => {
        seed(DANA_AGAIN);

        await expect(purge({ applicantKey: DANA, alsoDelete: [DANA_AGAIN] })).rejects.toMatchObject({ code: 'not-found' });
        expect(mockStore.has(`${DRAFTS}/${DANA_AGAIN}`)).toBe(true);
        expect(auditRows()).toEqual([]);
    });

    it('never touches a submitted application', async () => {
        seed(DANA);
        mockStore.set(`companies/${COMPANY}/applications/${DANA}`, { email: 'dana@example.test', applicantKey: DANA });

        await purge({ applicantKey: DANA });

        expect(mockStore.has(`companies/${COMPANY}/applications/${DANA}`)).toBe(true);
        expect(mockDeletedPaths).toEqual([`${DRAFTS}/${DANA}`]);
    });
});
