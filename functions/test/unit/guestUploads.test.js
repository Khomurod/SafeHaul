/**
 * Which paths are a driver's uploads, the mark a submission sets on them, and
 * which of them a draft's deletion may take (`shared/guestUploads.js`).
 */

const {
    MARKS_SINCE, MARK_MS, deletableUpload, guestUploadPathsIn, isGuestUploadPath, markSubmittedUploads, reuploadableEntries,
    uploadNamedAt,
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
const PSP = `companies/${COMPANY}/autofill/guest_uploads/1698_ij78kl9_psp.pdf`;
const upload = (storagePath) => ({ name: 'file', storagePath });

/**
 * A bucket holding these objects, recording the marks set, or one whose calls
 * fail, or wait for `held` (on `heldPaths`, or every path) before they answer.
 */
function storageWith(paths, { failing = false, held = null, heldPaths = null } = {}) {
    const marked = [];
    return {
        marked,
        bucket: () => ({
            file: (path) => ({
                setMetadata: async ({ metadata }) => {
                    if (held && (!heldPaths || heldPaths.includes(path))) await held;
                    if (failing) throw Object.assign(new Error('storage unavailable'), { code: 503 });
                    if (!paths.includes(path)) throw Object.assign(new Error('No such object'), { code: 404 });
                    marked.push([path, metadata]);
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

describe('the submission\'s mark', () => {
    const formData = {
        'cdl-front': upload(FRONT), 'psp-report-upload': upload(PSP), customAnswers: { 'q-lease': upload(LEASE) },
    };
    const customQuestions = [{ id: 'q-lease', type: 'file' }];
    const mark = (storage) => markSubmittedUploads({ storage, companyId: COMPANY, formData, customQuestions, HttpsError });

    it('marks every upload the application files, the carrier\'s included', async () => {
        const storage = storageWith([FRONT, LEASE, PSP]);

        await expect(mark(storage)).resolves.toBeUndefined();
        expect(storage.marked.map(([path]) => path).sort()).toEqual([FRONT, LEASE, PSP].sort());
        storage.marked.forEach(([, metadata]) => expect(metadata).toEqual({ safehaulSubmitted: 'true' }));
    });

    it('sends the driver back to the page of each missing upload they can replace', async () => {
        const refusal = await mark(storageWith([])).catch((error) => error);

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

    it('names one missing upload as one, and never a file the driver could not upload again', async () => {
        await expect(mark(storageWith([LEASE]))).rejects.toThrow('One of your uploaded files is no longer saved. Upload it again, then submit.');
        await expect(mark(storageWith([FRONT, LEASE]))).resolves.toBeUndefined();
    });

    it('never refuses over a call that failed', async () => {
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(mark(storageWith([], { failing: true }))).resolves.toBeUndefined();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not mark 3 upload(s)'));
        errors.mockRestore();
    });

    /** A Storage answer the test gives when it is done, so no call outlives it. */
    function heldAnswer() {
        let answer;
        const held = new Promise((resolve) => { answer = resolve; });
        return { held, answer };
    }

    it('lets the submission through when Storage does not answer in time, within the submission\'s 30 s', async () => {
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { held, answer } = heldAnswer();

        await expect(markSubmittedUploads({
            storage: storageWith([FRONT], { held }), companyId: COMPANY, formData, customQuestions, HttpsError, waitMs: 20,
        })).resolves.toBeUndefined();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not mark 3 upload(s) of a submission to company-1 (code step-timeout)'));
        expect(MARK_MS).toBeLessThanOrEqual(10000);
        answer();
        errors.mockRestore();
    });

    it('still sends the driver back for a missing upload while another one does not answer', async () => {
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { held, answer } = heldAnswer();
        // The licence photo is gone; the lease does not answer in time.
        const storage = storageWith([LEASE, PSP], { held, heldPaths: [LEASE] });

        const refusal = await markSubmittedUploads({ storage, companyId: COMPANY, formData, customQuestions, HttpsError, waitMs: 20 })
            .catch((error) => error);

        expect(refusal).toMatchObject({ details: { issues: [{ code: 'upload-missing', semanticStep: 'license', fieldId: 'cdl-front' }] } });
        expect(refusal.details.issues).toHaveLength(1);
        answer();
        errors.mockRestore();
    });

    it('asks Storage nothing when the answers hold no upload', async () => {
        const storage = storageWith([]);

        await markSubmittedUploads({ storage, companyId: COMPANY, formData: { firstName: 'Dana' }, HttpsError });
        expect(storage.marked).toEqual([]);
    });
});

describe('when an upload was named', () => {
    it('reads the milliseconds its name starts with, and nothing else', () => {
        expect(uploadNamedAt(`companies/${COMPANY}/applications/guest_uploads/1791849600000_ab12cd3_John_Smith_CDL.jpg`)).toBe(1791849600000);
        expect(uploadNamedAt(FRONT)).toBe(1696);
        expect(uploadNamedAt(`companies/${COMPANY}/applications/guest_uploads/front.jpg`)).toBeNaN();
        expect(uploadNamedAt(`companies/${COMPANY}/applications/guest_uploads/12ab_front.jpg`)).toBeNaN();
        // Digits only: a name that reads as a number another way is no time.
        expect(uploadNamedAt(`companies/${COMPANY}/applications/guest_uploads/1e13_front.jpg`)).toBeNaN();
        expect(uploadNamedAt(null)).toBeNaN();
    });
});

describe('what a draft\'s deletion may take', () => {
    const since = new Date(MARKS_SINCE + 1000).toISOString();

    it.each([
        ['an unmarked upload made since the marks began', { timeCreated: since, metadata: {} }, true],
        ['one with no metadata of its own', { timeCreated: since }, true],
        ['one a submission marked', { timeCreated: since, metadata: { safehaulSubmitted: 'true' } }, false],
        ['one made before the marks began', { timeCreated: '2026-10-01T00:00:00.000Z', metadata: {} }, false],
        ['one whose age Storage did not say', { metadata: {} }, false],
    ])('%s: %s', (_label, metadata, expected) => {
        expect(deletableUpload(metadata)).toBe(expected);
    });
});
