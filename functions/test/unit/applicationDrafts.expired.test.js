/**
 * An unfinished application that expires takes its uploads with it.
 *
 * Part of the `applicationDrafts` suite; the doubles are in
 * `applicationDrafts.support.js`. What these pin: only Firestore's TTL policy,
 * deleting a draft that had expired, deletes its files, by the checks a Company
 * Admin's deletion makes (`drafts/draftFiles.js`); a submission, Start Over or a
 * superseding save, which delete drafts as well, never do.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentDeletedWithAuthContext: (options, handler) => Object.assign(handler, { options }),
}));
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());

const { deleteExpiredDraftFiles } = require('../../drafts/expired');
const {
    mockStore, mockStorageFiles, mockDeletedFiles, mockServerTimestamp, COMPANY, resetDraftState,
} = require('./applicationDrafts.support');

const KEY = 'aaaa1111bbbb2222cccc';
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

const fire = (data, authType = 'system') => deleteExpiredDraftFiles({
    authType,
    params: { companyId: COMPANY, applicantKey: KEY },
    data: { data: () => data },
});

beforeEach(() => {
    resetDraftState();
    mockStorageFiles.add(FRONT);
    mockStorageFiles.add(BACK);
});

it('listens for the deletion of an unfinished application', () => {
    expect(deleteExpiredDraftFiles.options).toEqual({
        document: 'companies/{companyId}/application_drafts/{applicantKey}',
        region: 'us-central1',
    });
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
