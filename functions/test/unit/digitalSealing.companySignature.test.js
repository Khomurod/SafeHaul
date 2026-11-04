/**
 * A company signature in the sealed PDF: the image the field names
 * (`companySignaturePath`), never a value the signer sent; PNG or JPEG by its
 * bytes; scaled into its box like a signer's signature. Without a readable image
 * of this company the document does not seal, whatever `required` says. The
 * image is the company's file, shared by a template and every document made
 * from it, so sealing never deletes it, while the signer's own PNGs still go.
 * Every value is artificial.
 */
const { PDFDocument, PDFPage } = require('pdf-lib');
const { createFirestoreMock } = require('../helpers/firestoreMock');
const { TINY_JPEG, createStorageFake, imagesOnPages, onePagePdf, tinyPng } = require('./signedCopy.support');

let sealHandler;

jest.mock('firebase-functions/v1', () => ({
    runWith: () => ({
        firestore: {
            document: () => ({
                onUpdate: (handler) => {
                    sealHandler = handler;
                    return handler;
                },
            }),
        },
    }),
}));

const mock = createFirestoreMock();
const mockStorage = createStorageFake();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db, storage: mockStorage.storage }));

require('../../digitalSealing');

const TEMPLATE_PATH = 'secure_documents/co1/templates/offer.pdf';
const COMPANY_IMAGE = 'secure_documents/co1/originals/company-signatures/stamp.png';
const SIGNER_IMAGE = 'secure_documents/co1/signatures/req-cs_sig1.png';
const SEALED_PATH = 'secure_documents/co1/completed/req-cs_signed.pdf';

const companyField = (overrides = {}) => ({
    id: 'cs1',
    type: 'company_signature',
    label: 'Company Signature',
    pageNumber: 1,
    xPosition: 60,
    yPosition: 70,
    width: 30,
    height: 10,
    required: false,
    readOnly: true,
    prefillPolicy: 'locked',
    bindingKey: '',
    prefillGroupKey: '',
    defaultValue: '',
    fontSize: 'Auto',
    companySignaturePath: COMPANY_IMAGE,
    ...overrides,
});
const signerField = { id: 'sig1', type: 'signature', pageNumber: 1, xPosition: 10, yPosition: 70, width: 30, height: 10, required: true };

let patches;
let drawn;
let embedded;

/** Seals a request with `fields` and `fieldValues`; returns the patches written to it. */
async function seal({ fields, fieldValues = { sig1: SIGNER_IMAGE } }) {
    await sealHandler({
        before: { data: () => ({ status: 'processing' }) },
        after: {
            data: () => ({
                status: 'pending_seal',
                title: 'Offer Letter',
                recipientName: 'Jane Driver',
                storagePath: TEMPLATE_PATH,
                fields,
                fieldValues,
            }),
            ref: { update: async (patch) => { patches.push(patch); }, get: async () => ({ exists: true, data: () => ({ status: 'pending_seal' }) }) },
        },
    }, { params: { companyId: 'co1', requestId: 'req-cs' } });
    return patches;
}

const statusWritten = () => patches.map((patch) => patch.status).filter(Boolean);

beforeEach(async () => {
    patches = [];
    drawn = [];
    embedded = [];
    mock.reset();
    mockStorage.reset();
    mockStorage.files.set(TEMPLATE_PATH, await onePagePdf());
    mockStorage.files.set(SIGNER_IMAGE, tinyPng(1, 1, [255, 0, 0]));
    mockStorage.files.set(COMPANY_IMAGE, tinyPng(3, 2, [0, 0, 255]));

    const drawImage = PDFPage.prototype.drawImage;
    jest.spyOn(PDFPage.prototype, 'drawImage').mockImplementation(function record(image, options) {
        drawn.push({ pixels: { width: image.width, height: image.height }, ...options });
        return drawImage.call(this, image, options);
    });
    for (const method of ['embedPng', 'embedJpg']) {
        const original = PDFDocument.prototype[method];
        jest.spyOn(PDFDocument.prototype, method).mockImplementation(function record(bytes) {
            embedded.push(method);
            return original.call(this, bytes);
        });
    }
});

afterEach(() => jest.restoreAllMocks());

describe('sealing a company signature', () => {
    it('draws the image the field names, scaled into its box, and never a value the signer sent', async () => {
        mockStorage.files.set('secure_documents/co1/signatures/forged.png', tinyPng(5, 5));
        await seal({
            fields: [signerField, companyField()],
            fieldValues: { sig1: SIGNER_IMAGE, cs1: 'secure_documents/co1/signatures/forged.png' },
        });

        expect(statusWritten()).toEqual(['signed']);
        expect(mockStorage.calls.downloads).toContain(COMPANY_IMAGE);
        expect(mockStorage.calls.downloads).not.toContain('secure_documents/co1/signatures/forged.png');

        // The box is 30% × 10% of a 612 × 792 page at (60%, 70%); a 3 × 2 image fits its height.
        const stamp = drawn.find((image) => image.pixels.width === 3);
        expect(stamp.x).toBeCloseTo(367.2);
        expect(stamp.height).toBeCloseTo(79.2);
        expect(stamp.width).toBeCloseTo(118.8);
        expect(stamp.y).toBeCloseTo(792 - 554.4 - 79.2);

        const pages = await imagesOnPages(mockStorage.files.get(SEALED_PATH));
        expect(pages[0]).toEqual(expect.arrayContaining([{ width: 1, height: 1 }, { width: 3, height: 2 }]));
        expect(pages[0]).toHaveLength(2);
    });

    it.each([
        ['a JPEG named .jpg', 'secure_documents/co1/originals/company-signatures/stamp.jpg'],
        ['a JPEG named .jpeg', 'secure_documents/co1/originals/company-signatures/stamp.JPEG'],
        ['a JPEG named .png (its bytes decide)', 'secure_documents/co1/originals/company-signatures/scan.png'],
    ])('embeds %s as a JPEG', async (_label, imagePath) => {
        mockStorage.files.set(imagePath, TINY_JPEG);
        await seal({ fields: [signerField, companyField({ companySignaturePath: imagePath })] });

        expect(statusWritten()).toEqual(['signed']);
        expect(embedded).toEqual(['embedPng', 'embedJpg']);
        const pages = await imagesOnPages(mockStorage.files.get(SEALED_PATH));
        expect(pages[0]).toEqual(expect.arrayContaining([{ width: 1, height: 1 }]));
        expect(pages[0]).toHaveLength(2);
    });

    it('embeds a PNG as a PNG', async () => {
        await seal({ fields: [companyField()], fieldValues: {} });
        expect(statusWritten()).toEqual(['signed']);
        expect(embedded).toEqual(['embedPng']);
    });

    const unusable = [
        ['no path at all', { companySignaturePath: undefined }],
        ['an empty path', { companySignaturePath: '' }],
        ['another company\'s image', { companySignaturePath: 'secure_documents/co2/originals/company-signatures/stamp.png' }],
        ['a signer\'s signature', { companySignaturePath: 'secure_documents/co1/signatures/req-cs_sig1.png' }],
        ['a file outside the company-signatures folder', { companySignaturePath: 'secure_documents/co1/originals/stamp.png' }],
        ['a path that climbs out of the folder', { companySignaturePath: 'secure_documents/co1/originals/company-signatures/../stamp.png' }],
        ['a file that is not .png, .jpg or .jpeg', { companySignaturePath: 'secure_documents/co1/originals/company-signatures/stamp.gif' }],
        ['a gs:// address', { companySignaturePath: `gs://test-bucket/${COMPANY_IMAGE}` }],
        ['a box on a page the PDF does not have', { pageNumber: 4 }],
        ['a box with no size', { width: 0 }],
    ];

    it.each(unusable)('does not seal with %s, though the field is not required', async (_label, overrides) => {
        await seal({ fields: [signerField, companyField(overrides)] });

        expect(statusWritten()).toEqual(['error_sealing']);
        expect(patches[0]).toMatchObject({
            missingFields: ['cs1'],
            errorLog: 'Company signature image missing or unreadable: cs1',
        });
        expect(mockStorage.calls.uploads).toEqual([]);
        expect(mockStorage.calls.deletes).toEqual([]);
    });

    it.each([
        ['missing from Storage', () => mockStorage.files.delete(COMPANY_IMAGE)],
        ['unreadable', () => mockStorage.failures.set(COMPANY_IMAGE, new Error('storage unavailable'))],
        ['not an image', () => mockStorage.files.set(COMPANY_IMAGE, Buffer.from('GIF89a not a png or jpeg'))],
        ['a damaged PNG', () => mockStorage.files.set(COMPANY_IMAGE, tinyPng(3, 2).subarray(0, 30))],
    ])('does not seal when the image is %s', async (_label, arrange) => {
        arrange();
        await seal({ fields: [signerField, companyField()] });

        expect(statusWritten()).toEqual(['error_sealing']);
        expect(patches[0].missingFields).toEqual(['cs1']);
        expect(mockStorage.calls.uploads).toEqual([]);
    });

    it('names both problems when a required field is also missing', async () => {
        await seal({ fields: [signerField, companyField({ companySignaturePath: '' })], fieldValues: {} });
        expect(patches[0]).toMatchObject({
            status: 'error_sealing',
            missingFields: ['sig1', 'cs1'],
            errorLog: 'Required fields not completed: sig1. Company signature image missing or unreadable: cs1',
        });
    });

    it('keeps the company signature image and still deletes the signer\'s', async () => {
        await seal({ fields: [signerField, companyField()] });

        expect(statusWritten()).toEqual(['signed']);
        expect(mockStorage.calls.deletes).toEqual([SIGNER_IMAGE]);
        expect(mockStorage.files.has(COMPANY_IMAGE)).toBe(true);
        expect(mockStorage.files.has(SIGNER_IMAGE)).toBe(false);
    });
});
