/**
 * The PEV result PDF: the DQ-file record of a previous employer's answer.
 *
 * Rendered with the real pdf-lib. Every call to `drawText` is recorded with its
 * page and position, so a test can say what the document prints and where:
 * "the generator ran" and "the page carries the answer" are different claims.
 */

jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockSavedFiles = new Map();
// A 1x1 PNG, the drawn signature the storage mock hands back when a test asks.
const mockSignature = { png: null };
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: () => ({ doc: () => ({ update: async () => {} }) }),
    },
    storage: {
        bucket: () => ({
            file: (path) => ({
                save: async (bytes) => { mockSavedFiles.set(path, bytes); },
                download: async () => {
                    if (!mockSignature.png) throw new Error('no drawn signature stored');
                    return [mockSignature.png];
                },
            }),
        }),
    },
}));

const { PDFDocument, PDFPage } = require('pdf-lib');
const { generateVerificationPDF } = require('../../employmentVerification/pdf');

const PAGE_HEIGHT = 792;
// Nothing may be drawn closer to the paper's edge than this.
const EDGE = 36;

const drawn = [];
const images = [];
const originalDrawText = PDFPage.prototype.drawText;
const originalDrawImage = PDFPage.prototype.drawImage;
let drawTextSpy;
let drawImageSpy;

beforeEach(() => {
    drawn.length = 0;
    images.length = 0;
    mockSavedFiles.clear();
    mockSignature.png = null;
    drawTextSpy = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function record(text, options) {
        drawn.push({ page: this, text, x: options.x, y: options.y });
        return originalDrawText.call(this, text, options);
    });
    drawImageSpy = jest.spyOn(PDFPage.prototype, 'drawImage').mockImplementation(function record(image, options) {
        images.push({ page: this, y: options.y });
        return originalDrawImage.call(this, image, options);
    });
});

afterEach(() => {
    drawTextSpy.mockRestore();
    drawImageSpy.mockRestore();
});

const VERIFICATION = {
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    applicantName: 'Jane Driver',
    employerName: 'Old Carrier LLC',
    companyName: 'SafeHaul Carrier',
    employmentStartDate: '2020-01',
    employmentEndDate: '2022-06',
};

const RESPONSE = {
    wasEmployed: true,
    confirmedStartDate: '2020-01-06',
    confirmedEndDate: '2022-06-30',
    positionHeld: 'OTR Driver',
    reasonForLeaving: 'Resigned',
    eligibleForRehire: true,
    subjectToFmcsrs: true,
    subjectToDotTesting: true,
    hadDrugAlcoholViolations: false,
    hadAccidents: false,
    respondentName: 'HR Lead',
    respondentTitle: 'HR Manager',
    respondentPhone: '555-222-3333',
    signatureMethod: 'typed',
    signatureText: 'HR Lead',
};

const render = (response = {}) => generateVerificationPDF(VERIFICATION, { ...RESPONSE, ...response }, 'pev-token-123456');

/** The value printed beside `label`: the text drawn on the same line, to its right. */
function valueBeside(label) {
    const at = drawn.find((d) => d.text === label);
    if (!at) throw new Error(`"${label}" was not printed`);
    return drawn.find((d) => d.page === at.page && d.y === at.y && d.x > at.x)?.text;
}

describe('PEV result PDF', () => {
    it('prints a respondent whose name the standard font cannot encode', async () => {
        const path = await render({
            respondentName: 'Li Wei 李伟',
            signatureText: 'Li Wei 李伟',
            additionalComments: 'Reliable driver 👍',
        });

        expect(mockSavedFiles.has(path)).toBe(true);
        expect(valueBeside('Respondent Name:')).toBe('Li Wei ??');
        expect(drawn.map((d) => d.text)).toContain('Li Wei ??');
    });

    it('flows long answers onto further pages, inside the margins, line by line', async () => {
        const paragraph = 'The driver was involved in a minor yard incident and completed retraining. ';
        const long = `${paragraph.repeat(13)}\nSecond paragraph. ${'X'.repeat(140)}`.slice(0, 2000);
        const path = await render({
            reasonForLeaving: long,
            hadDrugAlcoholViolations: true,
            violationDetails: long,
            hadAccidents: true,
            accidentDetails: long,
            additionalComments: long,
        });

        const doc = await PDFDocument.load(mockSavedFiles.get(path));
        expect(doc.getPageCount()).toBeGreaterThan(1);
        for (const { text, y } of drawn) {
            expect(y).toBeGreaterThanOrEqual(EDGE);
            expect(y).toBeLessThanOrEqual(PAGE_HEIGHT - EDGE);
            expect(text).not.toMatch(/\n/);
        }
        // The unbroken run is split rather than drawn past the margin.
        expect(drawn.some((d) => d.text.includes('X'.repeat(140)))).toBe(false);
        // Nothing after the long answers is lost: the respondent and the footer print.
        expect(valueBeside('Respondent Name:')).toBe('HR Lead');
        expect(drawn.some((d) => d.text.startsWith('This document was electronically generated'))).toBe(true);
    });

    it('says "Not answered" for a question left unanswered, never "No"', async () => {
        await render({
            wasEmployed: null,
            eligibleForRehire: null,
            subjectToFmcsrs: null,
            subjectToDotTesting: undefined,
            hadDrugAlcoholViolations: null,
            hadAccidents: null,
        });

        expect(valueBeside('Was Employed:')).toBe('Not answered');
        expect(valueBeside('Eligible for Rehire:')).toBe('Not answered');
        expect(valueBeside('Subject to FMCSRs:')).toBe('Not answered');
        expect(valueBeside('Subject to DOT Testing:')).toBe('Not answered');
        expect(valueBeside('Drug/Alcohol Violations:')).toBe('Not answered');
        expect(valueBeside('DOT-Recordable Accidents:')).toBe('Not answered');
    });

    it('keeps answered questions as they were', async () => {
        await render({ hadDrugAlcoholViolations: true, hadAccidents: false, eligibleForRehire: false });

        expect(valueBeside('Was Employed:')).toBe('Yes');
        expect(valueBeside('Drug/Alcohol Violations:')).toBe('YES');
        expect(valueBeside('DOT-Recordable Accidents:')).toBe('No');
        expect(valueBeside('Eligible for Rehire:')).toBe('No');
    });

    it('keeps a drawn signature on the page of its label, inside the margins', async () => {
        mockSignature.png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
        );
        const long = 'A long answer that pushes the signature down the page. '.repeat(30);
        await render({
            signatureMethod: 'drawn',
            signatureText: undefined,
            signaturePath: 'companies/co-1/pev_signatures/pev-token-123456.png',
            violationDetails: long,
            hadDrugAlcoholViolations: true,
            accidentDetails: long,
            hadAccidents: true,
        });

        const label = drawn.find((d) => d.text === 'Electronic Signature (drawn):');
        expect(images).toHaveLength(1);
        expect(images[0].page).toBe(label.page);
        expect(images[0].y).toBeGreaterThanOrEqual(EDGE);
    });

    it('prints the follow-up answers when the employer gave them', async () => {
        await render({
            eligibleForRehire: false,
            rehireExplanation: 'Repeated late deliveries.',
            hadDrugAlcoholViolations: true,
            violationDetails: 'Positive test, 2023.',
            completedReturnToDuty: 'in_progress',
            followUpTestingPlan: '6 tests in 12 months; 2 done.',
            hadNonRecordableAccidents: true,
            nonRecordableAccidentDetails: 'Backed into a pole, 2024.',
        });

        const texts = drawn.map((d) => d.text);
        expect(texts).toEqual(expect.arrayContaining([
            'Rehire Explanation:', 'Repeated late deliveries.',
            'Follow-up Testing Plan:', '6 tests in 12 months; 2 done.',
            'Non-Recordable Accident Details:', 'Backed into a pole, 2024.',
        ]));
        expect(valueBeside('Return-to-Duty Completed:')).toBe('In progress');
        expect(valueBeside('Non-Recordable Accidents:')).toBe('YES');
    });

    it('prints nothing for the optional questions a response never answered', async () => {
        await render({});

        const texts = drawn.map((d) => d.text);
        for (const label of ['Rehire Explanation:', 'Follow-up Testing Plan:', 'Non-Recordable Accidents:', 'Non-Recordable Accident Details:']) {
            expect(texts).not.toContain(label);
        }
    });

    it('prints a "No" to other accidents as the employer gave it', async () => {
        await render({ hadNonRecordableAccidents: false });

        expect(valueBeside('Non-Recordable Accidents:')).toBe('No');
    });

    it('prints the additional comments the employer wrote', async () => {
        await render({ additionalComments: 'Would rehire for local routes only.' });

        expect(drawn.map((d) => d.text)).toContain('Would rehire for local routes only.');
    });
});
