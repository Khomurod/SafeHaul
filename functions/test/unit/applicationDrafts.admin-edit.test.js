/**
 * A Company Admin correcting an unfinished application the driver owns.
 *
 * Part of the `applicationDrafts` suite; see `applicationDrafts.support.js` for
 * the Firestore double and `shared/companyEdits.js` for the protocol. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file.
 *
 * What these pin: the same strict door as the read; only answers the carrier may
 * give, in the shape the wizard stores; an answer the driver changed since the
 * editor loaded it is refused, never overwritten; only what changes is written
 * and recorded, at a revision later than any before it; an employer the
 * carrier locked stays as it was locked; the driver's copy from before the edit
 * is then refused and handed the edit; and the carrier's own application,
 * before the driver has saved it, is the preparation workspace's.
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
    mockStore, mockRunTransactionCalls, mockAssertCompanyAdmin, mockCheckRateLimit, mockServerTimestamp,
    COMPANY, CONTEXT, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');
const DRIVER_ONLY_FIELDS = require('../../shared/driverOnlyFields.json');

const ADMIN = { uid: 'admin-1' };
/** A revision is the edit's time in milliseconds. */
const NOW = 1791300000000;
const UPLOAD_PATH = `companies/${COMPANY}/applications/guest_uploads/1_card.jpg`;
const draftPath = (key = keyFor()) => `companies/${COMPANY}/application_drafts/${key}`;

const edit = (changes, base = {}, { key = keyFor(), auth = ADMIN } = {}) => drafts.saveApplicationDraftEdits({
    auth, data: { companyId: COMPANY, applicantKey: key, changes, base },
});
const view = (key = keyFor()) => drafts.getApplicationDraft({
    auth: ADMIN, data: { companyId: COMPANY, applicantKey: key },
});

/** The driver's own unfinished application, saved through the real callable. */
async function driverDraft(answers = {}) {
    return saveFirstPage({
        formData: { firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', city: 'Austin', ...answers },
    });
}

/** A draft written straight into the store, for the shapes a driver's save cannot make. */
function seedDraft(fields = {}) {
    mockStore.set(draftPath(), {
        status: 'in_progress',
        contactEmail: 'dana@example.test',
        formData: { firstName: 'Dana', city: 'Austin' },
        updatedAt: mockServerTimestamp(),
        ...fields,
    });
}

function auditEntries() {
    return [...mockStore.entries()]
        .filter(([path]) => path.startsWith(`companies/${COMPANY}/application_draft_audit/`))
        .map(([, entry]) => entry);
}

const stored = () => mockStore.get(draftPath());

let clock;
beforeEach(() => {
    resetDraftState();
    mockStore.set(`public_profiles/${COMPANY}`, {
        companyName: 'Acme Freight',
        applicationConfig: {},
        customQuestions: [{ id: 'q-lane', label: 'Willing to run a dedicated lane?', type: 'yesNo' }],
    });
    clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => clock.mockRestore());

describe('who may edit', () => {
    it('asks the strict admin check for THIS company, and changes nothing when it refuses', async () => {
        await driverDraft();
        const before = JSON.stringify(stored());
        mockAssertCompanyAdmin.mockRejectedValue(
            Object.assign(new Error('Company admin access required.'), { code: 'permission-denied' }),
        );
        const transactions = mockRunTransactionCalls.length;

        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).rejects.toMatchObject({ code: 'permission-denied' });

        expect(mockAssertCompanyAdmin).toHaveBeenCalledWith('admin-1', COMPANY);
        expect(mockRunTransactionCalls).toHaveLength(transactions);
        expect(JSON.stringify(stored())).toBe(before);
    });

    it('spends its own budget per company and admin, failing closed', async () => {
        await driverDraft();
        mockCheckRateLimit.mockResolvedValue(false);

        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(mockCheckRateLimit).toHaveBeenCalledWith(`draft_admin_edit_${COMPANY}_admin-1`, 60, 300, 'closed');
        expect(stored().formData.city).toBe('Austin');
    });
});

describe('what an edit may carry', () => {
    it.each(DRIVER_ONLY_FIELDS)('refuses %s, which only the driver gives', async (field) => {
        await driverDraft();
        const transactions = mockRunTransactionCalls.length;

        await expect(edit({ [field]: 'x' })).rejects.toMatchObject({
            code: 'invalid-argument', details: { fields: [field] },
        });
        expect(mockRunTransactionCalls).toHaveLength(transactions);
    });

    it.each(['status', 'resumeTokenHash', '_companyRevision', 'notAnAnswer'])(
        'refuses %s, which is not an answer at all',
        async (field) => {
            await expect(edit({ [field]: 'x' })).rejects.toMatchObject({ code: 'invalid-argument' });
        },
    );

    it.each([
        ['a list of employers given as text', { employers: 'Acme Trucking' }],
        ['a row that is not a set of fields', { employers: [['Acme', '2019']] }],
        ['a row whose field is itself a set of fields', { previousAddresses: [{ street: { line: 1 } }] }],
        ['a document given as text', { 'cdl-front': UPLOAD_PATH }],
        ['a document with nowhere it is stored', { 'cdl-front': { name: 'card.jpg' } }],
        ['the company questions as a list', { customAnswers: ['Yes'] }],
        ['a single answer as a set of fields', { city: { name: 'Dallas' } }],
    ])('refuses %s', async (_what, changes) => {
        await expect(edit(changes)).rejects.toMatchObject({
            code: 'invalid-argument', details: { fields: Object.keys(changes) },
        });
    });

    it('refuses an edit that changes nothing at all', async () => {
        await expect(edit({})).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(edit(null)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('takes every shape the wizard stores', async () => {
        await driverDraft();

        const result = await edit({
            employers: [{ companyName: 'Acme Trucking', startDate: '2019-04', endDate: '2023-01' }],
            endorsements: ['H', 'N'],
            'medical-card-upload': { name: 'card.jpg', storagePath: UPLOAD_PATH },
            customAnswers: { 'q-lane': 'yes', 'q-file': { name: 'cert.pdf', storagePath: UPLOAD_PATH } },
            cdlNumber: null,
        });

        expect(result.changed).toEqual(['employers', 'endorsements', 'medical-card-upload', 'customAnswers']);
        expect(stored().formData['medical-card-upload']).toEqual({ name: 'card.jpg', storagePath: UPLOAD_PATH });
    });
});

describe('an edit', () => {
    it('writes the answers it changes, as one edit at the time it was made', async () => {
        await driverDraft({ cdlNumber: 'D1' });

        const result = await edit({ city: 'Dallas', cdlNumber: 'D1' }, { city: 'Austin', cdlNumber: 'D1' });

        // Only what actually changed is the carrier's edit.
        expect(result).toMatchObject({ changed: ['city'], revision: NOW });
        expect(stored().formData).toMatchObject({ firstName: 'Dana', city: 'Dallas', cdlNumber: 'D1' });
        expect(stored().companyRevision).toBe(NOW);
        expect(stored().companyEdits).toEqual({ city: NOW });
        // The write and its audit entry, in one transaction.
        const transaction = mockRunTransactionCalls.at(-1);
        expect(transaction.writes).toHaveLength(2);
        expect(transaction.writes[0]).toBe(draftPath());
        const [entry] = auditEntries();
        expect(entry).toMatchObject({
            action: 'company_edited_draft', outcome: 'ok', actorUid: 'admin-1', applicantKey: keyFor(),
            fields: ['city'], revision: NOW,
        });
        // Which answers, never what they say.
        expect(JSON.stringify(entry)).not.toMatch(/Dallas|Austin|Dana/);
    });

    it('takes a revision past the draft\'s when the clock lags', async () => {
        await driverDraft();
        clock.mockReturnValue(NOW + 5000);
        await edit({ city: 'Dallas' }, { city: 'Austin' });
        clock.mockReturnValue(NOW);

        const result = await edit({ zip: '75001' });

        expect(result.revision).toBe(NOW + 5001);
        expect(stored().companyEdits).toEqual({ city: NOW + 5000, zip: NOW + 5001 });
    });

    it('is refused, with nothing written, for an answer the driver changed since it was loaded', async () => {
        const { resumeToken } = await driverDraft();
        // The driver moves on while the admin is still typing.
        await saveFirstPage({ resumeToken, formData: { firstName: 'Dana', city: 'Houston' } });
        const transactions = mockRunTransactionCalls.length;

        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).rejects.toMatchObject({
            code: 'aborted', details: { fields: ['city'] },
        });

        expect(mockRunTransactionCalls).toHaveLength(transactions + 1);
        expect(mockRunTransactionCalls.at(-1).writes).toEqual([]);
        expect(stored().formData.city).toBe('Houston');
        expect(auditEntries()).toHaveLength(0);
    });

    it('compares the answers loaded, not the order their fields arrived in', async () => {
        seedDraft({ formData: { employers: [{ companyName: 'Acme', startDate: '2019-04' }] } });

        const result = await edit(
            { employers: [{ companyName: 'Acme', startDate: '2019-05' }] },
            { employers: [{ startDate: '2019-04', companyName: 'Acme' }] },
        );

        expect(result.changed).toEqual(['employers']);
    });

    it('writes nothing, and records nothing, when no answer changes', async () => {
        await driverDraft();

        const result = await edit({ city: 'Austin' }, { city: 'Austin' });

        expect(result).toMatchObject({ changed: [], revision: null, companyRevision: 0 });
        expect(mockRunTransactionCalls.at(-1).writes).toEqual([]);
        expect(stored()).not.toHaveProperty('companyRevision');
        expect(auditEntries()).toHaveLength(0);
    });

    it('replaces a map whole, so an answer the admin cleared stays cleared', async () => {
        seedDraft({ formData: { customAnswers: { 'q-lane': 'yes', 'q-gone': 'An old answer' } } });

        await edit(
            { customAnswers: { 'q-lane': 'yes' } },
            { customAnswers: { 'q-lane': 'yes', 'q-gone': 'An old answer' } },
        );

        expect(stored().formData.customAnswers).toEqual({ 'q-lane': 'yes' });
        // Firestore's merging `set` would have merged the old answer back in.
        expect(mockRunTransactionCalls.at(-1).updates).toEqual([draftPath()]);
    });

    it('answers with the application as it now stands', async () => {
        await driverDraft();

        const result = await edit({ city: 'Dallas' }, { city: 'Austin' });

        expect(result).toMatchObject({
            editable: true,
            answers: { city: 'Dallas' },
            companyRevision: NOW,
            companyEdits: { city: NOW },
            companyEditedAt: mockServerTimestamp().toDate().toISOString(),
        });
        const cities = result.record.sections.flatMap((section) => section.answers)
            .filter((answer) => answer.fieldId === 'city');
        expect(cities).toEqual([expect.objectContaining({ displayValue: 'Dallas' })]);
    });

    it('is refused on the carrier\'s own application the driver has not saved yet', async () => {
        seedDraft({ origin: 'company', status: 'prepared' });

        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(stored().formData.city).toBe('Austin');
    });

    it('edits a prepared application once the driver has taken it over', async () => {
        seedDraft({ origin: 'company', status: 'driver_in_progress' });

        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).resolves.toMatchObject({ changed: ['city'] });
    });

    it('says a missing draft could not be found, and records nothing', async () => {
        await expect(edit({ city: 'Dallas' }, { city: 'Austin' })).rejects.toMatchObject({ code: 'not-found' });

        expect(auditEntries()).toHaveLength(0);
    });
});

describe('an employer the carrier locked', () => {
    // Prepared from the driver's safety record and handed over. The driver's page
    // holds its own copy of these locks, which nothing after the handover refreshes.
    const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
    const blue = { companyName: 'Blue Line', dotNumber: '654321' };
    const LOCKS = [{ signature: 'dot:123456', ...acme }, { signature: 'dot:654321', ...blue }];
    const lockedDraft = (employers = [acme, blue]) => seedDraft({
        origin: 'company',
        status: 'driver_in_progress',
        inviteClaimedAt: mockServerTimestamp(),
        formData: { employers },
        lockedEmployers: LOCKS,
    });

    it.each([
        ['renamed', [{ ...acme, companyName: 'Acme Logistics' }, blue]],
        ['given another USDOT number', [{ ...acme, dotNumber: '111111' }, blue]],
        ['removed', [blue]],
    ])('cannot be %s, and the refusal writes nothing', async (_how, employers) => {
        lockedDraft();
        const before = JSON.stringify(stored());

        await expect(edit({ employers }, { employers: [acme, blue] })).rejects.toMatchObject({
            code: 'invalid-argument', details: { fields: ['employers'] },
        });

        expect(JSON.stringify(stored())).toBe(before);
        expect(auditEntries()).toHaveLength(0);
    });

    it('keeps the rest of its row the admin\'s to change, and the locks as they were', async () => {
        lockedDraft();
        const employers = [{ ...acme, startDate: '2019-04', reasonForLeaving: 'Moved closer to home' }, blue];

        await expect(edit({ employers }, { employers: [acme, blue] })).resolves.toMatchObject({ changed: ['employers'] });

        expect(stored().formData.employers).toEqual(employers);
        expect(stored().lockedEmployers).toEqual(LOCKS);
    });

    it('stays the driver\'s to answer when their own answers dropped it, without stopping an edit', async () => {
        // The driver's rows already lack a locked employer; the submission holds them to it.
        lockedDraft([acme]);
        const employers = [{ ...acme, startDate: '2019-04' }];

        await expect(edit({ employers }, { employers: [acme] })).resolves.toMatchObject({ changed: ['employers'] });

        // Never reconciled against the driver's rows: deleting a locked row must not delete its lock.
        expect(stored().lockedEmployers).toEqual(LOCKS);
    });
});

describe('the driver, after an edit', () => {
    it('is refused a save from the copy before it, and handed the edit', async () => {
        const { resumeToken, applicantKey } = await driverDraft();
        await edit({ city: 'Dallas' }, { city: 'Austin' });

        const reply = await saveFirstPage({ resumeToken, seenRevision: 0, formData: { firstName: 'Dana', city: 'Austin' } });
        const { draft } = await drafts.resumeApplicationDraft({ companyId: COMPANY, applicantKey, resumeToken }, CONTEXT);

        expect(reply).toMatchObject({ saved: false, companyUpdated: true });
        expect(stored().formData.city).toBe('Dallas');
        expect(draft).toMatchObject({ companyRevision: NOW, companyEdits: { city: NOW } });
        expect(draft.formData.city).toBe('Dallas');
    });

    it('saves as before from a copy that has taken it', async () => {
        const { resumeToken } = await driverDraft();
        await edit({ city: 'Dallas' }, { city: 'Austin' });

        const reply = await saveFirstPage({ resumeToken, seenRevision: NOW, formData: { firstName: 'Dana', city: 'Dallas', zip: '75001' } });

        expect(reply.saved).toBe(true);
        expect(stored().formData).toMatchObject({ city: 'Dallas', zip: '75001' });
    });
});

describe('what the editor is handed', () => {
    it('the answers it may change, and none only the driver gives', async () => {
        seedDraft({
            formData: {
                firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '2145550147',
                dob: '1988-03-11', city: 'Austin', 'consent-mvr': 'yes', customAnswers: { 'q-lane': 'yes' },
            },
        });

        const result = await view();

        expect(result.answers).toEqual({ firstName: 'Dana', city: 'Austin', customAnswers: { 'q-lane': 'yes' } });
        expect(result).toMatchObject({ editable: true, companyRevision: 0, companyEdits: {}, companyEditedAt: null });
        // The questions the wizard showed, from the public projection.
        expect(result.form.customQuestions).toEqual([expect.objectContaining({ id: 'q-lane' })]);
    });

    it('says the carrier\'s own unclaimed application is not the editor\'s', async () => {
        seedDraft({ origin: 'company', status: 'sent' });

        expect((await view()).editable).toBe(false);
    });
});
