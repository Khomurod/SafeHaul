/**
 * An unfinished application that expires takes its uploads with it.
 *
 * Part of the `applicationDrafts` suite; the doubles are in
 * `applicationDrafts.support.js`. What these pin: only Firestore's TTL policy,
 * deleting a draft that had expired, deletes its files, by the checks a Company
 * Admin's deletion makes (`drafts/draftFiles.js`); a submission, Start Over or a
 * superseding save, which delete drafts as well, never do. A run that could not
 * finish tries twice more itself, and records what its last try left for the
 * next deletion; a step that never answers counts as failed, so it always can.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeletedWithAuthContext: (options, handler) => Object.assign(handler, { options }),
}));
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());

const { deleteExpiredDraftFiles, __private: { RETRY_WAITS_MS, timing } } = require('../../drafts/expired');
const {
    mockStore, mockStorageFiles, mockDeletedFiles, mockServerTimestamp, COMPANY,
    failFileDeletesOn, failQueriesOn, hangFileDeletesOn, hangQueriesOn, hangAddsOn, resetDraftState,
} = require('./applicationDrafts.support');

const KEY = 'aaaa1111bbbb2222cccc';
const AUDIT = `companies/${COMPANY}/application_draft_audit`;
const UPLOADS = `companies/${COMPANY}/applications/guest_uploads`;
const FRONT = `${UPLOADS}/1_a_front.jpg`;
const BACK = `${UPLOADS}/2_b_back.jpg`;
const HOUR = 60 * 60 * 1000;

const upload = (storagePath) => ({ name: storagePath.split('/').pop(), storagePath });
const at = (ms) => ({ toMillis: () => ms });

/** The draft as the trigger receives it: already deleted, its data as it was. */
function deletedDraft(fields = {}) {
    return {
        contactEmail: 'dana@example.test',
        contactPhone: '2145550147',
        identityKey: 'f'.repeat(64),
        formData: { firstName: 'Dana', phone: '(214) 555-0147', 'cdl-front': upload(FRONT), 'cdl-back': upload(BACK) },
        expiresAt: at(Date.now() - HOUR),
        ...fields,
    };
}

const fire = (data, authType = 'system', id = undefined) => deleteExpiredDraftFiles({
    id,
    authType,
    params: { companyId: COMPANY, applicantKey: KEY },
    data: { data: () => data },
});

const pending = () => [...mockStore.entries()]
    .filter(([path, row]) => path.startsWith(`${AUDIT}/`) && row.action === 'draft_files_pending')
    .map(([, row]) => row);

const { wait: realWait, stepMs: realStepMs, runMs: realRunMs } = timing;
/** The waits between tries, taken at once; `during` runs while a wait would have. */
let waits;
function waitsRun(during = () => {}) {
    timing.wait = jest.fn(async (ms) => { waits.push(ms); during(); });
}

beforeEach(() => {
    resetDraftState();
    mockStorageFiles.add(FRONT);
    mockStorageFiles.add(BACK);
    waits = [];
    waitsRun();
    // A step that never answers gives up at once.
    timing.stepMs = 20;
    timing.runMs = realRunMs;
});

afterAll(() => {
    timing.wait = realWait;
    timing.stepMs = realStepMs;
    timing.runMs = realRunMs;
});

it('listens for the deletion of an unfinished application, without the platform\'s retries', () => {
    expect(deleteExpiredDraftFiles.options).toEqual({
        document: 'companies/{companyId}/application_drafts/{applicantKey}',
        region: 'us-central1',
        timeoutSeconds: 300,
    });
});

it('waits for nothing when the first try finishes', async () => {
    await fire(deletedDraft());

    expect(waits).toEqual([]);
});

it('deletes the uploads of a draft the TTL policy deleted once it had expired', async () => {
    await fire(deletedDraft());

    expect([...mockDeletedFiles].sort()).toEqual([BACK, FRONT].sort());
});

it.each([
    ['the functions\' service account: a submission, Start Over or a superseding save', 'service_account', {}],
    ['anyone else', 'unknown', {}],
    ['the system, before the draft expired', 'system', { expiresAt: at(Date.now() + HOUR) }],
    ['the system, on a draft with no expiry', 'system', { expiresAt: undefined }],
])('leaves the files of a draft deleted by %s', async (_label, authType, fields) => {
    await fire(deletedDraft(fields), authType);

    expect(mockDeletedFiles).toEqual([]);
    expect(mockStorageFiles.size).toBe(2);
});

it('keeps a file an application the driver submitted still uses', async () => {
    mockStore.set(`companies/${COMPANY}/applications/${KEY}`, { email: 'dana@example.test', 'cdl-front': upload(FRONT) });

    await fire(deletedDraft());

    expect(mockDeletedFiles).toEqual([BACK]);
});

it('keeps a file another unfinished application still uses', async () => {
    mockStore.set(`companies/${COMPANY}/application_drafts/aaaa1111bbbb2222dddd`, {
        contactEmail: 'dana.t@example.test',
        identityKey: 'f'.repeat(64),
        formData: { 'cdl-front': upload(FRONT) },
        updatedAt: mockServerTimestamp(),
    });

    await fire(deletedDraft());

    expect(mockDeletedFiles).toEqual([BACK]);
});

it('finishes what an earlier deletion at the company could not', async () => {
    const LEFT = `${UPLOADS}/3_c_left.jpg`;
    mockStorageFiles.add(LEFT);
    mockStore.set(`companies/${COMPANY}/application_draft_audit/pending-1`, {
        action: 'draft_files_pending', applicantKeys: ['bbbb1111bbbb2222cccc'], paths: [LEFT], attempts: 1, checkedAt: at(Date.now() - HOUR),
    });

    await fire(deletedDraft({ formData: {} }));

    expect(mockStorageFiles.has(LEFT)).toBe(false);
    expect(mockStore.has(`companies/${COMPANY}/application_draft_audit/pending-1`)).toBe(false);
});

describe('a run that could not finish', () => {
    let errors;
    let infos;
    beforeEach(() => {
        errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        infos = jest.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterEach(() => {
        errors.mockRestore();
        infos.mockRestore();
    });

    it('tries again after a wait when a file could not be deleted, and writes nothing down once it finishes', async () => {
        failFileDeletesOn('front');
        // The outage ends while the run waits.
        waitsRun(() => failFileDeletesOn(null));

        await fire(deletedDraft());

        expect(waits).toEqual([RETRY_WAITS_MS[0]]);
        expect(mockStorageFiles.size).toBe(0);
        expect(pending()).toEqual([]);
    });

    it('tries again when it could not check what else uses the files, deleting none until it can', async () => {
        failQueriesOn('application_drafts');
        waitsRun(() => {
            expect(mockDeletedFiles).toEqual([]);
            failQueriesOn(null);
        });

        await fire(deletedDraft());

        expect([...mockDeletedFiles].sort()).toEqual([BACK, FRONT].sort());
    });

    it('records what its last try left for the next deletion, once, without the answers', async () => {
        failFileDeletesOn('front');

        await fire(deletedDraft());

        expect(waits).toEqual([...RETRY_WAITS_MS]);
        expect(mockDeletedFiles).toEqual([BACK]);
        expect(pending()).toEqual([expect.objectContaining({ applicantKeys: [KEY], paths: [FRONT], attempts: 1 })]);
        expect(JSON.stringify(pending())).not.toMatch(/Dana|dana@/);
    });

    it('leaves the files, and writes nothing down, when every check failed', async () => {
        failQueriesOn('application_drafts');

        await fire(deletedDraft());

        expect(waits).toEqual([...RETRY_WAITS_MS]);
        expect(mockDeletedFiles).toEqual([]);
        expect(pending()).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('so they stay'));
    });

    it('gives up on a check that never answers, and tries again', async () => {
        hangQueriesOn('application_drafts');
        waitsRun(() => hangQueriesOn(null));

        await fire(deletedDraft());

        expect(waits).toEqual([RETRY_WAITS_MS[0]]);
        expect([...mockDeletedFiles].sort()).toEqual([BACK, FRONT].sort());
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('no answer within 20 ms'));
    });

    it('records a file whose delete never answers, on its last try', async () => {
        hangFileDeletesOn('front');

        await fire(deletedDraft());

        expect(mockDeletedFiles).toEqual([BACK]);
        expect(pending()).toEqual([expect.objectContaining({ paths: [FRONT], attempts: 1 })]);
    });

    it('still ends when the record of what is left never lands', async () => {
        hangFileDeletesOn('front');
        hangAddsOn('application_draft_audit');

        await fire(deletedDraft());

        expect(pending()).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('could not record 1 file(s) left to delete'));
    });

    it('records what one deletion left once, however often its event arrives', async () => {
        failFileDeletesOn('front');

        await fire(deletedDraft(), 'system', 'projects/p/events/1 2');
        await fire(deletedDraft(), 'system', 'projects/p/events/1 2');

        expect(pending()).toEqual([expect.objectContaining({ applicantKeys: [KEY], paths: [FRONT], attempts: 1 })]);
        expect(mockStore.has(`${AUDIT}/files_projects_p_events_1_2`)).toBe(true);
    });

    it('starts no retry of earlier leftovers once its run is over, and leaves their record', async () => {
        const LEFT = `${UPLOADS}/3_c_left.jpg`;
        mockStorageFiles.add(LEFT);
        mockStore.set(`${AUDIT}/pending-1`, {
            action: 'draft_files_pending', applicantKeys: ['bbbb1111bbbb2222cccc'], paths: [LEFT], attempts: 1, checkedAt: at(Date.now() - HOUR),
        });
        timing.runMs = 0;

        await fire(deletedDraft({ formData: {} }));

        expect(mockStorageFiles.has(LEFT)).toBe(true);
        expect(mockStore.get(`${AUDIT}/pending-1`)).toMatchObject({ paths: [LEFT], attempts: 1 });
    });

    it('leaves what earlier deletions could not finish for a run that goes through', async () => {
        const LEFT = `${UPLOADS}/3_c_left.jpg`;
        mockStorageFiles.add(LEFT);
        mockStore.set(`${AUDIT}/pending-1`, {
            action: 'draft_files_pending', applicantKeys: ['bbbb1111bbbb2222cccc'], paths: [LEFT], attempts: 1, checkedAt: at(Date.now() - HOUR),
        });
        failFileDeletesOn('front');

        await fire(deletedDraft());

        expect(mockStorageFiles.has(LEFT)).toBe(true);
        expect(pending()).toEqual(expect.arrayContaining([expect.objectContaining({ paths: [LEFT], attempts: 1 })]));
    });
});
