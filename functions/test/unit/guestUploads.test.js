/**
 * Which paths are a driver's uploads, and the submission's check that they are
 * still in Storage (`shared/guestUploads.js`).
 */

const {
    assertUploadsExist, guestUploadPathsIn, isGuestUploadPath, reuploadableEntries,
} = require('../../shared/guestUploads');

class HttpsError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

const COMPANY = 'company-1';
const FRONT = `companies/${COMPANY}/applications/guest_uploads/1696_ab12cd3_front.jpg`;
const LEASE = `companies/${COMPANY}/autofill/guest_uploads/1697_ef45gh6_lease.pdf`;
const upload = (storagePath) => ({ name: 'file', storagePath });

/** A bucket holding these objects, or one whose lookups fail. */
function storageWith(paths, { failing = false } = {}) {
    const asked = [];
    return {
        asked,
        bucket: () => ({
            file: (path) => ({
                exists: async () => {
                    asked.push(path);
                    if (failing) throw new Error('storage unavailable');
                    return [paths.includes(path)];
                },
            }),
        }),
    };
}

describe('a driver upload path', () => {
    it.each([
        [FRONT, true],
        [LEASE, true],
        [`companies/other-co/applications/guest_uploads/1696_ab12cd3_front.jpg`, false],
        [`companies/${COMPANY}/applications/abc/dq_files/front.jpg`, false],
        [`companies/${COMPANY}/applications/guest_uploads/../dq_files/front.jpg`, false],
        [`companies/${COMPANY}/applications/guest_uploads/a/b.jpg`, false],
        [`companies/${COMPANY}/applications/guest_uploads/..`, false],
        [`companies/${COMPANY}/applications/guest_uploads/`, false],
        [`companies/${COMPANY}/leads/guest_uploads/1_a.jpg`, false],
        [42, false],
    ])('%s is %s', (path, expected) => {
        expect(isGuestUploadPath(path, COMPANY)).toBe(expected);
    });

    it('is found anywhere in a record, once', () => {
        const record = { 'cdl-front': upload(FRONT), rows: [[{ storagePath: FRONT }], { copy: LEASE }], other: 'text' };
        expect(guestUploadPathsIn(record, COMPANY).sort()).toEqual([LEASE, FRONT].sort());
    });
});

describe('the uploads a driver could upload again', () => {
    const answers = {
        'cdl-front': upload(FRONT),
        'medical-card-upload': upload(FRONT.replace('front', 'medical')),
        'twic-card-upload': upload(FRONT.replace('front', 'twic')),
        'psp-report-upload': upload(FRONT.replace('front', 'psp')),
        customAnswers: { 'q-lease': upload(LEASE), 'q-gone': upload(LEASE.replace('lease', 'gone')) },
    };
    const questions = [{ id: 'q-lease', type: 'fileUpload' }, { id: 'q-lane', type: 'yesNo' }];

    it('are the licence page\'s the company shows and its current file questions\'', () => {
        const entries = reuploadableEntries(answers, COMPANY, { applicationConfig: {}, customQuestions: questions });

        expect(entries.map(({ fieldId, semanticStep }) => [fieldId, semanticStep])).toEqual([
            ['cdl-front', 'license'],
            ['medical-card-upload', 'license'],
            ['q-lease', 'custom_questions'],
        ]);
    });

    it('leave out a page section the company hides, and a TWIC card the driver said they lack', () => {
        const entries = reuploadableEntries(
            { ...answers, 'has-twic': 'yes' },
            COMPANY,
            { applicationConfig: { cdlUpload: { hidden: true } }, customQuestions: [] },
        );

        expect(entries.map(({ fieldId }) => fieldId)).toEqual(['medical-card-upload', 'twic-card-upload']);
    });
});

describe('the submission\'s check', () => {
    const formData = { 'cdl-front': upload(FRONT), customAnswers: { 'q-lease': upload(LEASE) } };
    const customQuestions = [{ id: 'q-lease', type: 'file' }];

    it('lets the submission through when every upload is there', async () => {
        const storage = storageWith([FRONT, LEASE]);

        await expect(assertUploadsExist({ storage, companyId: COMPANY, formData, customQuestions, HttpsError })).resolves.toBeUndefined();
        expect(storage.asked.sort()).toEqual([LEASE, FRONT].sort());
    });

    it('sends the driver back to the page of each missing upload', async () => {
        const storage = storageWith([]);

        const refusal = await assertUploadsExist({ storage, companyId: COMPANY, formData, customQuestions, HttpsError })
            .catch((error) => error);

        expect(refusal).toMatchObject({
            code: 'invalid-argument',
            message: 'Some of your uploaded files are no longer saved. Upload them again, then submit.',
            details: {
                issues: [
                    { code: 'upload-missing', semanticStep: 'license', fieldId: 'cdl-front' },
                    { code: 'upload-missing', semanticStep: 'custom_questions', fieldId: 'q-lease' },
                ],
            },
        });
    });

    it('names one missing upload as one', async () => {
        await expect(assertUploadsExist({
            storage: storageWith([LEASE]), companyId: COMPANY, formData, customQuestions, HttpsError,
        })).rejects.toThrow('One of your uploaded files is no longer saved. Upload it again, then submit.');
    });

    it('never refuses over a lookup that failed', async () => {
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(assertUploadsExist({
            storage: storageWith([], { failing: true }), companyId: COMPANY, formData, customQuestions, HttpsError,
        })).resolves.toBeUndefined();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not check the uploads'));
        errors.mockRestore();
    });

    it('asks Storage nothing when the answers hold no upload', async () => {
        const storage = storageWith([]);

        await assertUploadsExist({ storage, companyId: COMPANY, formData: { firstName: 'Dana' }, HttpsError });
        expect(storage.asked).toEqual([]);
    });
});
