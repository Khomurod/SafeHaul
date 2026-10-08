/**
 * The files a deleted unfinished application leaves, and which of them go.
 *
 * Part of the `applicationDrafts` suite; the Firestore and Storage doubles are in
 * `applicationDrafts.support.js`. What these pin: a draft's uploads are deleted
 * with it, except a file something else still points at (the driver's other
 * draft, an application they submitted, its DQ file or its snapshot), and
 * nothing outside the company's upload folder is ever deleted. A file that could
 * not be deleted is written down and finished by the next deletion, checked as
 * strictly as the first time; one whose check failed is never deleted.
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
    mockStore, mockStorageFiles, mockDeletedFiles, mockServerTimestamp, COMPANY, failFileDeletesOn, failQueriesOn, resetDraftState,
} = require('./applicationDrafts.support');

const DRAFTS = `companies/${COMPANY}/application_drafts`;
const APPLICATIONS = `companies/${COMPANY}/applications`;
const AUDIT = `companies/${COMPANY}/application_draft_audit`;
const UPLOADS = `companies/${COMPANY}/applications/guest_uploads`;
const DANA = 'aaaa1111bbbb2222cccc';
const DANA_AGAIN = 'aaaa1111bbbb2222dddd';

const FRONT = `${UPLOADS}/1_a_front.jpg`;
const BACK = `${UPLOADS}/2_b_back.jpg`;
const MEDICAL = `${UPLOADS}/3_c_medical.pdf`;
const ANSWER_FILE = `companies/${COMPANY}/autofill/guest_uploads/4_d_lease.pdf`;

const upload = (storagePath) => ({ name: storagePath.split('/').pop(), storagePath });
/** A time after any check this suite's deletions make. */
const later = () => ({ toMillis: () => Date.now() + 1000 });

function seed(key, { formData = {}, ...fields } = {}) {
    mockStore.set(`${DRAFTS}/${key}`, {
        status: 'in_progress',
        contactEmail: 'dana@example.test',
        contactPhone: '2145550147',
        identityKey: 'f'.repeat(64),
        resumeTokenHash: 'e'.repeat(64),
        formData: { firstName: 'Dana', phone: '(214) 555-0147', ...formData },
        createdAt: mockServerTimestamp(),
        updatedAt: mockServerTimestamp(),
        ...fields,
    });
}

function store(...paths) {
    for (const path of paths) mockStorageFiles.add(path);
}

const purge = (data) => drafts.purgeApplicationDraft({ auth: { uid: 'admin-1' }, data: { companyId: COMPANY, ...data } });
const pending = () => [...mockStore.entries()]
    .filter(([path, row]) => path.startsWith(`${AUDIT}/`) && row.action === 'draft_files_pending')
    .map(([, row]) => row);

beforeEach(() => {
    resetDraftState();
});

it('deletes the uploads the application holds, its own fields and its custom answers alike', async () => {
    seed(DANA, {
        formData: {
            'cdl-front': upload(FRONT),
            'cdl-back': upload(BACK),
            customAnswers: { 'q-lease': upload(ANSWER_FILE), 'q-lane': 'Yes' },
        },
    });
    store(FRONT, BACK, ANSWER_FILE, MEDICAL);

    const { files } = await purge({ applicantKey: DANA });

    expect(files).toEqual({ deleted: 3, kept: 0, failed: 0 });
    expect(mockDeletedFiles.sort()).toEqual([ANSWER_FILE, BACK, FRONT].sort());
    expect(mockStorageFiles.has(MEDICAL)).toBe(true);
});

it('deletes a confirmed draft\'s uploads with it', async () => {
    seed(DANA, { formData: { 'cdl-front': upload(FRONT) } });
    seed(DANA_AGAIN, { contactEmail: 'other@example.test', formData: { 'medical-card-upload': upload(MEDICAL) } });
    store(FRONT, MEDICAL);

    await purge({ applicantKey: DANA, alsoDelete: [DANA_AGAIN] });

    expect(mockStorageFiles.size).toBe(0);
});

it.each([
    ['another company\'s upload', 'companies/other-co/applications/guest_uploads/1_a_front.jpg'],
    ['a DQ file', `companies/${COMPANY}/applications/${DANA}/dq_files/license.pdf`],
    ['a document in the company\'s own folders', `companies/${COMPANY}/pev/request.pdf`],
    ['a path that climbs out of the folder', `${UPLOADS}/../dq_files/license.pdf`],
    ['a nested path', `${UPLOADS}/x/1_a_front.jpg`],
])('never deletes %s an answer names', async (_label, path) => {
    seed(DANA, { formData: { 'cdl-front': upload(path) } });
    store(path);

    const { files } = await purge({ applicantKey: DANA });

    expect(files).toEqual({ deleted: 0, kept: 0, failed: 0 });
    expect(mockStorageFiles.has(path)).toBe(true);
});

describe('a file something else still points at stays', () => {
    beforeEach(() => {
        seed(DANA, { formData: { 'cdl-front': upload(FRONT), 'cdl-back': upload(BACK) } });
        store(FRONT, BACK);
    });

    it('the driver\'s other unfinished application, when it is kept', async () => {
        seed(DANA_AGAIN, { contactEmail: 'other@example.test', formData: { 'cdl-front': upload(FRONT) } });

        const { files } = await purge({ applicantKey: DANA });

        expect(files).toEqual({ deleted: 1, kept: 1, failed: 0 });
        expect(mockDeletedFiles).toEqual([BACK]);
    });

    it.each([
        ['at the same key', DANA, {}],
        ['filed under the key after a collision', `${DANA}_2`, { applicantKey: DANA }],
        ['with the same email', 'bbbb1111bbbb2222cccc', { email: 'dana@example.test' }],
        ['with the same phone as typed', 'cccc1111bbbb2222cccc', { phone: '(214) 555-0147' }],
    ])('an application the driver submitted, %s', async (_label, id, fields) => {
        mockStore.set(`${APPLICATIONS}/${id}`, { 'cdl-front': upload(FRONT), ...fields });

        await purge({ applicantKey: DANA });

        expect(mockStorageFiles.has(FRONT)).toBe(true);
        expect(mockDeletedFiles).toEqual([BACK]);
    });

    it('the DQ file and the snapshot a submission filed', async () => {
        mockStore.set(`${APPLICATIONS}/${DANA}`, { email: 'dana@example.test' });
        mockStore.set(`${APPLICATIONS}/${DANA}/dq_files/license_front`, { storagePath: FRONT });
        mockStore.set(`${APPLICATIONS}/${DANA}/submission/v1`, { rows: [{ answer: { storagePath: BACK } }] });

        const { files } = await purge({ applicantKey: DANA });

        expect(files).toEqual({ deleted: 0, kept: 2, failed: 0 });
        expect(mockDeletedFiles).toEqual([]);
    });
});

describe('a file that could not be deleted', () => {
    it('is written down, without the answers, and the next deletion finishes it', async () => {
        seed(DANA, { formData: { 'cdl-front': upload(FRONT), 'cdl-back': upload(BACK) } });
        seed(DANA_AGAIN, { contactEmail: 'x@example.test', contactPhone: '9725550100', identityKey: 'a'.repeat(64) });
        store(FRONT, BACK);
        failFileDeletesOn('front');

        const first = await purge({ applicantKey: DANA });

        expect(first.files).toEqual({ deleted: 1, kept: 0, failed: 1 });
        expect(pending()).toEqual([expect.objectContaining({
            applicantKeys: [DANA], paths: [FRONT], attempts: 1, checkedAt: expect.anything(), expiresAt: expect.any(Date),
        })]);
        expect(JSON.stringify(pending())).not.toMatch(/Dana|dana@/);

        failFileDeletesOn(null);
        await purge({ applicantKey: DANA_AGAIN });

        expect(mockStorageFiles.has(FRONT)).toBe(false);
        expect(pending()).toEqual([]);
    });

    it('is checked again before the retry, and stays if something points at it now', async () => {
        seed(DANA, { formData: { 'cdl-front': upload(FRONT) } });
        seed(DANA_AGAIN, { contactEmail: 'x@example.test', contactPhone: '9725550100', identityKey: 'a'.repeat(64) });
        store(FRONT);
        failFileDeletesOn('front');
        await purge({ applicantKey: DANA });
        // The driver's old copy was submitted in between, with the file in it.
        mockStore.set(`${APPLICATIONS}/${DANA}`, { 'cdl-front': upload(FRONT) });

        failFileDeletesOn(null);
        await purge({ applicantKey: DANA_AGAIN });

        expect(mockStorageFiles.has(FRONT)).toBe(true);
        expect(pending()).toEqual([]);
    });

    it('is kept when an application submitted since points at it, under a key the retry cannot name', async () => {
        seed(DANA, { formData: { 'cdl-front': upload(FRONT) } });
        seed(DANA_AGAIN, { contactEmail: 'x@example.test', contactPhone: '9725550100', identityKey: 'a'.repeat(64) });
        store(FRONT);
        failFileDeletesOn('front');
        await purge({ applicantKey: DANA });
        // The driver's old copy, with another email and phone, was submitted in between.
        mockStore.set(`${APPLICATIONS}/eeee1111bbbb2222cccc`, {
            email: 'new@example.test', phone: '(469) 555-0199', 'cdl-front': upload(FRONT), updatedAt: later(),
        });

        failFileDeletesOn(null);
        await purge({ applicantKey: DANA_AGAIN });

        expect(mockStorageFiles.has(FRONT)).toBe(true);
        expect(pending()).toEqual([]);
    });

    it('stays when too many applications changed since to be sure, and the record goes', async () => {
        seed(DANA, { formData: { 'cdl-front': upload(FRONT) } });
        seed(DANA_AGAIN, { contactEmail: 'x@example.test', contactPhone: '9725550100', identityKey: 'a'.repeat(64) });
        store(FRONT);
        failFileDeletesOn('front');
        await purge({ applicantKey: DANA });
        for (let index = 0; index < 200; index += 1) {
            mockStore.set(`${APPLICATIONS}/busy-${index}`, { email: `driver${index}@example.test`, updatedAt: later() });
        }
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

        failFileDeletesOn(null);
        await purge({ applicantKey: DANA_AGAIN });

        expect(mockStorageFiles.has(FRONT)).toBe(true);
        expect(pending()).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('left 1 file(s) in place'));
        errors.mockRestore();
    });

    it('is given up on after five attempts, and the record goes', async () => {
        seed(DANA_AGAIN, { contactEmail: 'x@example.test', contactPhone: '9725550100', identityKey: 'a'.repeat(64) });
        mockStore.set(`${AUDIT}/pending-1`, {
            action: 'draft_files_pending', applicantKeys: [DANA], paths: [FRONT], attempts: 5, checkedAt: mockServerTimestamp(),
        });
        store(FRONT);
        failFileDeletesOn('front');
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

        await purge({ applicantKey: DANA_AGAIN });

        expect(pending()).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('gave up deleting 1 file(s) after 5 attempts'));
        errors.mockRestore();
    });
});

it('deletes nothing, and writes nothing down, when it cannot check what else uses a file', async () => {
    seed(DANA, { formData: { 'cdl-front': upload(FRONT) } });
    store(FRONT);
    failQueriesOn('application_drafts');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { deleted, files } = await purge({ applicantKey: DANA });

    expect(deleted).toEqual([DANA]);
    expect(files).toEqual({ deleted: 0, kept: 0, failed: 1 });
    expect(mockStorageFiles.has(FRONT)).toBe(true);
    expect(pending()).toEqual([]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('so they stay'));
    errors.mockRestore();
});
