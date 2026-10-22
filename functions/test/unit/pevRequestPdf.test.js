/**
 * The PEV request document: what a previous employer receives about the
 * applicant, and the applicant's release beneath their signature.
 *
 * Rendered with the real pdf-lib. Every `drawText` and `drawImage` is recorded
 * with its page, so a test can say what the document prints and where.
 */

const fs = require('fs');
const path = require('path');
const { PDFPage } = require('pdf-lib');
const { buildRequestPdf } = require('../../employmentVerification/requestPdf');
const {
    RELEASE_PARAGRAPHS, RELEASE_RIGHTS, RELEASE_WORDING_SINCE, releaseOf,
} = require('../../shared/previousEmployerRelease');

// A 1x1 PNG, the drawn signature.
const DRAWN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const drawn = [];
const images = [];
const originalDrawText = PDFPage.prototype.drawText;
const originalDrawImage = PDFPage.prototype.drawImage;

beforeEach(() => {
    drawn.length = 0;
    images.length = 0;
    jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function record(text, options) {
        drawn.push({ page: this, text });
        return originalDrawText.call(this, text, options);
    });
    jest.spyOn(PDFPage.prototype, 'drawImage').mockImplementation(function record(image, options) {
        images.push({ page: this });
        return originalDrawImage.call(this, image, options);
    });
});

afterEach(() => jest.restoreAllMocks());

const printed = () => drawn.map((d) => d.text).join(' ').replace(/\s+/g, ' ');
const squash = (value) => value.replace(/\s+/g, ' ');

function build(application, overrides = {}) {
    return buildRequestPdf({
        company: { companyName: 'Sandbox Freight LLC', legal: { dotNumber: '1234567' } },
        application,
        employer: { name: 'Old Carrier Inc', email: 'hr@old.test', position: 'OTR Driver', startDate: '03/2021', endDate: '05/2024' },
        applicantName: 'Jane Testdriver',
        deadlineDate: '2026-11-21',
        sentAt: Date.parse('2026-10-22T10:00:00Z'),
        ...overrides,
    });
}

describe('PEV request PDF', () => {
    it('prints the release the applicant signed, word for word, with the drawn signature on the same page', async () => {
        const { bytes, release } = await build({
            ssn: '123-45-6789', signature: DRAWN, signatureDate: '2026-09-01T15:00:00Z',
        });

        expect(release).toBe('signed');
        expect(bytes.length).toBeGreaterThan(1000);
        const text = printed();
        for (const paragraph of [...RELEASE_PARAGRAPHS, ...RELEASE_RIGHTS]) {
            expect(text).toContain(squash(paragraph));
        }
        expect(images).toHaveLength(1);
        const lastReleaseLine = [...drawn].reverse().find((d) => d.text.includes('accuracy of the information'));
        expect(images[0].page).toBe(lastReleaseLine.page);
        expect(text).toContain('Signed electronically (drawn) on 09/01/2026 (UTC)');
    });

    it('shows the SSN as its last four digits only, and never a portal link', async () => {
        await build({ ssn: '123-45-6789', signature: DRAWN, signatureDate: '2026-09-01T15:00:00Z' });
        const text = printed();
        expect(text).toContain('***-**-6789');
        expect(text).not.toContain('123-45');
        expect(text).not.toMatch(/\/verify\//);
        expect(text).toContain('Old Carrier Inc');
        expect(text).toContain('OTR Driver');
        expect(text).toContain('03/2021 to 05/2024');
    });

    it('prints a typed signature as the adopted name', async () => {
        const { release } = await build({ signature: 'TEXT_SIGNATURE:Jane Testdriver', signatureDate: '2026-09-01T15:00:00Z' });
        expect(release).toBe('signed');
        expect(images).toHaveLength(0);
        expect(printed()).toContain('/s/ Jane Testdriver');
        expect(printed()).toContain('Signed electronically (typed name)');
    });

    it.each([
        ['predates-wording', { signature: DRAWN, signatureDate: '2025-12-01T00:00:00Z' }],
        ['unsigned', { signatureDate: '2026-09-01T15:00:00Z' }],
        ['undated', { signature: DRAWN }],
    ])('reproduces no signature and no release wording when the application is %s', async (status, application) => {
        const { release } = await build(application);
        expect(release).toBe(status);
        expect(images).toHaveLength(0);
        expect(printed()).not.toContain(squash(RELEASE_PARAGRAPHS[0]).slice(0, 60));
        expect(printed()).toContain('no signed release');
    });

    it('prints under the signature the name the signed application records, not the caller\'s', async () => {
        await build(
            { firstName: 'Jane', lastName: 'Testdriver', signature: DRAWN, signatureDate: '2026-09-01T15:00:00Z' },
            { applicantName: 'Somebody Else' },
        );
        expect(printed()).toContain('Jane Testdriver');
        expect(printed()).not.toContain('Somebody Else');
    });

    it('points a hand-delivered request at the link given with it, not at an email', async () => {
        await build({}, { emailed: false });
        expect(printed()).toContain('provided with this document');
        expect(printed()).not.toContain('in the email this document came with');
    });
});

describe('releaseOf', () => {
    it('reads the signing time from the newest field that records it', () => {
        const at = Date.parse('2026-05-01T00:00:00Z');
        expect(releaseOf({ signature: DRAWN, signatureDate: '2026-05-01T00:00:00Z' }).signedAt).toBe(at);
        expect(releaseOf({ signature: DRAWN, 'signature-date': '05/01/2026' }).signedAt).toBe(Date.parse('05/01/2026'));
        expect(releaseOf({ signature: DRAWN, submittedAt: { toMillis: () => at } }).signedAt).toBe(at);
    });

    it('does not take the application\'s creation as its signing time', () => {
        expect(releaseOf({ signature: DRAWN, createdAt: '2026-09-01T15:00:00Z' }).status).toBe('undated');
    });

    it('treats the cutoff instant as signed under the wording, and the instant before as not', () => {
        const before = new Date(RELEASE_WORDING_SINCE - 1).toISOString();
        const at = new Date(RELEASE_WORDING_SINCE).toISOString();
        expect(releaseOf({ signature: DRAWN, signatureDate: before }).status).toBe('predates-wording');
        expect(releaseOf({ signature: DRAWN, signatureDate: at }).status).toBe('signed');
    });

    it('does not take a non-image, non-typed value as a signature', () => {
        expect(releaseOf({ signature: 'https://example.test/sig.png', signatureDate: '2026-09-01T00:00:00Z' }).status).toBe('unsigned');
        expect(releaseOf({ signature: 'TEXT_SIGNATURE:  ', signatureDate: '2026-09-01T00:00:00Z' }).status).toBe('unsigned');
    });
});

describe('release wording parity', () => {
    // The consent step is where the applicant reads and signs this wording; the
    // request may only print what that step shows.
    const consentStep = fs.readFileSync(
        path.join(__dirname, '../../../src/features/driver-app/components/application/steps/Step9_Consent.jsx'),
        'utf8',
    );

    it.each([...RELEASE_PARAGRAPHS, ...RELEASE_RIGHTS])('the consent step shows: %s', (wording) => {
        expect(squash(consentStep)).toContain(squash(wording));
    });
});
