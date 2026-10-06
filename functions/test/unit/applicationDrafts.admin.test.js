/**
 * A Company Admin's read and delete of any unfinished application.
 *
 * Part of the `applicationDrafts` suite. The Firestore double, the fixtures and
 * the properties this surface has to hold are in
 * `applicationDrafts.support.js`. Each `jest.mock` below has to stay in this
 * file, because Jest hoists it per file and cannot register one from a helper.
 *
 * What these pin: only the strict admin check opens either door, and nothing is
 * read or written before it passes; the read shows a driver's own answers the
 * way a submitted application reads, never an SSN or an agreement, and changes
 * nothing; a delete is one transaction with its audit entry; a missing draft
 * answers one way.
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
    mockStore, mockDeletedPaths, mockRunTransactionCalls, mockNonTransactionalWrites,
    mockAssertCompanyAdmin, mockAssertCompanyAccess, mockCheckRateLimit, mockServerTimestamp,
    COMPANY, failWritesOn, runBeforeNextTransaction, resetDraftState,
} = require('./applicationDrafts.support');

const ADMIN = { uid: 'admin-1' };
const KEY = 'aaaa1111bbbb2222cccc';
const DRAFT_PATH = `companies/${COMPANY}/application_drafts/${KEY}`;
const TARGET = { companyId: COMPANY, applicantKey: KEY };
const UPLOAD_PATH = `companies/${COMPANY}/applications/guest_uploads/1_front.jpg`;

/** A driver's answers as `drafts/save.js` stores them. */
const DRIVER_ANSWERS = Object.freeze({
    firstName: 'Dana',
    lastName: 'Alvarez',
    email: 'dana@example.test',
    cdlNumber: 'D9988776',
    cdlState: 'Texas',
    referralSource: 'A friend',
    'cdl-front': { name: 'licence-front.jpg', storagePath: UPLOAD_PATH },
    customAnswers: { 'q-lane': 'Yes', 'q-gone': 'An answer to a deleted question' },
});

/** A driver's own unfinished application, with the fields the server keeps to itself. */
function seedDraft({ formData = DRIVER_ANSWERS, ...fields } = {}) {
    mockStore.set(DRAFT_PATH, {
        status: 'in_progress',
        contactEmail: 'dana@example.test',
        contactPhone: '2145550147',
        identityKey: 'f'.repeat(64),
        resumeTokenHash: 'e'.repeat(64),
        formData,
        lastSemanticStep: 'license',
        lastStep: 2,
        createdAt: mockServerTimestamp(),
        updatedAt: mockServerTimestamp(),
        ...fields,
    });
}

/** The company document and its public projection, which is what the wizard renders. */
function seedCompany({ publicProfile = {} } = {}) {
    mockStore.set(`companies/${COMPANY}`, {
        companyName: 'Acme Freight (internal)',
        dotNumber: '1234567',
        applicationConfig: {},
        customQuestions: [{ id: 'q-internal', label: 'A question only the company document holds' }],
    });
    mockStore.set(`public_profiles/${COMPANY}`, {
        companyName: 'Acme Freight',
        applicationConfig: {},
        customQuestions: [{ id: 'q-lane', label: 'Willing to run a dedicated lane?', type: 'yesNo' }],
        ...publicProfile,
    });
}

const view = (data = TARGET, auth = ADMIN) => drafts.getApplicationDraft({ auth, data });
const remove = (data = TARGET, auth = ADMIN) => drafts.deleteApplicationDraft({ auth, data });

function answersOf(record) {
    return new Map(record.sections.flatMap((section) => section.answers).map((answer) => [answer.fieldId, answer]));
}

function auditEntries() {
    return [...mockStore.entries()]
        .filter(([path]) => path.startsWith(`companies/${COMPANY}/application_draft_audit/`))
        .map(([, entry]) => entry);
}

let consoleInfo;
beforeEach(() => {
    resetDraftState();
    seedCompany();
    // The delete logs one line per success; nothing here asserts on the console.
    consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => consoleInfo.mockRestore());

describe('who may open either door', () => {
    const DOORS = [['read', view], ['delete', remove]];

    it.each(DOORS)('refuses a signed-out caller before anything else (%s)', async (_door, call) => {
        seedDraft();

        await expect(call(TARGET, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockAssertCompanyAdmin).not.toHaveBeenCalled();
    });

    it.each(DOORS)('refuses ids that are paths, or not applicant keys (%s)', async (_door, call) => {
        await expect(call({ companyId: 'company-1/x', applicantKey: KEY })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ companyId: COMPANY, applicantKey: '../applications/x' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ companyId: COMPANY })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockAssertCompanyAdmin).not.toHaveBeenCalled();
    });

    it.each(DOORS)('asks the strict admin check for THIS company, and stops when it refuses (%s)', async (_door, call) => {
        seedDraft();
        mockAssertCompanyAdmin.mockRejectedValue(
            Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' }),
        );

        await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });

        expect(mockAssertCompanyAdmin).toHaveBeenCalledWith('admin-1', COMPANY);
        // Not the team check, which a recruiter passes.
        expect(mockAssertCompanyAccess).not.toHaveBeenCalled();
        // Nothing read, deleted or recorded for a caller who was refused.
        expect(mockCheckRateLimit).not.toHaveBeenCalled();
        expect(mockRunTransactionCalls).toHaveLength(0);
        expect(mockStore.has(DRAFT_PATH)).toBe(true);
        expect(auditEntries()).toHaveLength(0);
    });

    it.each([
        ['read', view, 'draft_admin_view', 120],
        ['delete', remove, 'draft_admin_delete', 30],
    ])('spends its own budget per company and admin, failing closed (%s)', async (_door, call, budget, limit) => {
        seedDraft();
        mockCheckRateLimit.mockResolvedValue(false);

        await expect(call()).rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(mockCheckRateLimit).toHaveBeenCalledWith(`${budget}_${COMPANY}_admin-1`, limit, 300, 'closed');
        expect(mockStore.has(DRAFT_PATH)).toBe(true);
        expect(auditEntries()).toHaveLength(0);
    });
});

describe('reading any unfinished application', () => {
    it('shows a driver-started application the way a submitted one reads', async () => {
        seedDraft();

        const result = await view();
        const answers = answersOf(result.record);

        // The row's summary, in the shape the list already shows.
        expect(result).toMatchObject({
            applicantKey: KEY, origin: 'driver', status: 'in_progress',
            firstName: 'Dana', lastName: 'Alvarez', lastSemanticStep: 'license',
        });
        // The driver's own answers, by the wording the wizard used.
        expect(answers.get('firstName')).toMatchObject({ label: 'First Name', displayValue: 'Dana' });
        expect(answers.get('cdlNumber')).toMatchObject({ label: 'License Number', displayValue: 'D9988776' });
        // An upload reads as its file name and keeps the path the screen opens it by.
        expect(answers.get('cdl-front')).toMatchObject({
            type: 'file', displayValue: 'licence-front.jpg', value: { storagePath: UPLOAD_PATH },
        });
        expect(result.record.provenance.source).toBe('draft');
    });

    it('asks the questions and settings the wizard showed, from the public projection', async () => {
        seedCompany({ publicProfile: { applicationConfig: { referralSource: { hidden: true } } } });
        seedDraft();

        const { record } = await view();

        // Hidden on the apply page, so never asked — not an unanswered question.
        expect(answersOf(record).has('referralSource')).toBe(false);
        const custom = new Map(record.customAnswers.map((answer) => [answer.questionId, answer]));
        expect(custom.get('q-lane')).toMatchObject({ label: 'Willing to run a dedicated lane?', displayValue: 'Yes' });
        // An answer whose question is gone is kept and flagged, never labelled by its id.
        expect(custom.get('q-gone')).toMatchObject({ label: null, unknownQuestion: true });
        // The company document's own list is not what the driver was shown.
        expect(custom.has('q-internal')).toBe(false);
    });

    it('never carries an SSN, an agreement, a signature or a submission time', async () => {
        // A draft cannot hold an SSN — it is stripped three times on the way in —
        // so this one is planted, to prove the read does not lean on that.
        seedDraft({ formData: { firstName: 'Dana', ssn: '123-45-6789' } });

        const result = await view();

        expect(answersOf(result.record).has('ssn')).toBe(false);
        expect(JSON.stringify(result)).not.toContain('123-45-6789');
        expect(result.record.agreements).toEqual([]);
        expect(result.record.signature).toBeNull();
        expect(result.record.submittedAt).toBeNull();
        // Nor the identity HMAC or the token hash the stored document keeps.
        expect(JSON.stringify(result)).not.toContain('f'.repeat(64));
        expect(JSON.stringify(result)).not.toContain('e'.repeat(64));
    });

    it('reads a prepared application the driver has taken over, which a recruiter may not', async () => {
        seedDraft({
            origin: 'company',
            status: 'driver_in_progress',
            preparedBy: { uid: 'recruiter-1', name: 'Rae Recruiter' },
            lockedEmployers: [{ companyName: 'Acme Trucking', dotNumber: '123456' }],
        });

        const result = await view();

        expect(result).toMatchObject({ origin: 'company', status: 'driver_in_progress', lockedEmployerCount: 1 });
        expect(answersOf(result.record).get('cdlNumber').displayValue).toBe('D9988776');
    });

    it('changes nothing about the draft, so looking never extends its 30 days', async () => {
        seedDraft();
        const before = JSON.stringify(mockStore.get(DRAFT_PATH));

        await view();

        expect(JSON.stringify(mockStore.get(DRAFT_PATH))).toBe(before);
        expect(mockRunTransactionCalls).toHaveLength(0);
        expect(mockNonTransactionalWrites).not.toContain(DRAFT_PATH);
    });

    it('answers a missing draft with one sentence, and records nothing', async () => {
        await expect(view()).rejects.toMatchObject({
            code: 'not-found',
            message: expect.stringContaining('could not be found'),
        });
        expect(auditEntries()).toHaveLength(0);
    });

    it('records who looked at which draft, and none of what it says', async () => {
        seedDraft();

        await view();

        const entries = auditEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            action: 'company_viewed_draft', outcome: 'ok', actorUid: 'admin-1',
            applicantKey: KEY, origin: 'driver', status: 'in_progress',
        });
        expect(entries[0].expiresAt).toBeInstanceOf(Date);
        expect(JSON.stringify(entries[0])).not.toMatch(/Dana|D9988776|dana@example/);
    });

    it('still answers when the audit cannot be written, and says so in the log', async () => {
        seedDraft();
        failWritesOn('application_draft_audit');
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const result = await view();
            expect(answersOf(result.record).get('firstName').displayValue).toBe('Dana');
            expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Could not record the view'));
        } finally {
            consoleError.mockRestore();
        }
    });

    it('cannot reach another company’s drafts', async () => {
        seedDraft();

        await expect(view({ companyId: 'company-2', applicantKey: KEY })).rejects.toMatchObject({ code: 'not-found' });
        expect(mockAssertCompanyAdmin).toHaveBeenCalledWith('admin-1', 'company-2');
    });
});

describe('deleting an unfinished application', () => {
    it('deletes the draft and records who did it, in one transaction', async () => {
        seedDraft();

        await expect(remove()).resolves.toEqual({ deleted: true, applicantKey: KEY });

        expect(mockStore.has(DRAFT_PATH)).toBe(false);
        expect(mockDeletedPaths).toEqual([DRAFT_PATH]);
        // The existence check, the delete and the audit entry: one transaction.
        expect(mockRunTransactionCalls).toHaveLength(1);
        const [transaction] = mockRunTransactionCalls;
        expect(transaction.reads).toEqual([DRAFT_PATH]);
        expect(transaction.writes).toHaveLength(1);
        expect(transaction.writes[0]).toMatch(new RegExp(`^companies/${COMPANY}/application_draft_audit/`));
        const entries = auditEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            action: 'company_deleted_draft', outcome: 'ok', actorUid: 'admin-1', applicantKey: KEY, origin: 'driver',
        });
        expect(JSON.stringify(entries[0])).not.toMatch(/Dana|D9988776/);
    });

    it('deletes a carrier-prepared application too, whatever its status', async () => {
        seedDraft({ origin: 'company', status: 'sent', inviteTokenHash: 'd'.repeat(64) });

        await remove();

        expect(mockStore.has(DRAFT_PATH)).toBe(false);
        expect(auditEntries()[0]).toMatchObject({ origin: 'company', status: 'sent' });
    });

    it('touches nothing but that one document — not its neighbours, not its uploads', async () => {
        seedDraft();
        const neighbour = `companies/${COMPANY}/application_drafts/bbbb2222cccc3333dddd`;
        mockStore.set(neighbour, { status: 'in_progress', formData: {} });

        await remove();

        expect(mockStore.has(neighbour)).toBe(true);
        // One delete, and it is the draft. The uploads stay: the driver's own copy
        // on their device still points at them and can still be submitted.
        expect(mockDeletedPaths).toEqual([DRAFT_PATH]);
    });

    it('says a draft that is already gone could not be found, and records nothing', async () => {
        await expect(remove()).rejects.toMatchObject({ code: 'not-found' });

        expect(mockDeletedPaths).toEqual([]);
        expect(auditEntries()).toHaveLength(0);
    });

    it('decides inside the transaction, so a draft submitted meanwhile is not reported deleted', async () => {
        seedDraft();
        // A submission removes the draft. Landing between any earlier read and the
        // delete, it has to be seen by the delete's own transaction.
        runBeforeNextTransaction(() => { mockStore.delete(DRAFT_PATH); });

        await expect(remove()).rejects.toMatchObject({ code: 'not-found' });
        expect(auditEntries()).toHaveLength(0);
    });
});
