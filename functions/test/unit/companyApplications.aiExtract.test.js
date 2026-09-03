/**
 * The carrier reading whatever paperwork it holds.
 *
 * Mocked at the task boundary, like every other AI callable's suite: which vendor
 * answers belongs to the router's own tests. What is pinned here is the
 * orchestration — any subset of documents, two routes, and what happens when one
 * of them fails while another succeeds.
 */

jest.mock('firebase-functions/v1', () => {
    class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    }
    const https = { HttpsError, onCall: (fn) => fn };
    return { https, runWith: () => ({ https }) };
});

jest.mock('../../firebaseAdmin', () => ({ db: {} }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccess: jest.fn() }));

const mockText = jest.fn();
const mockReport = jest.fn();
const mockCdl = jest.fn();
const mockMedical = jest.fn();
jest.mock('../../ai/tasks/applicationDocumentExtraction', () => {
    const actual = jest.requireActual('../../ai/tasks/applicationDocumentExtraction');
    return { ...actual, extractApplicationDocuments: (...args) => mockText(...args) };
});
jest.mock('../../ai/tasks/reportExtraction', () => {
    const actual = jest.requireActual('../../ai/tasks/reportExtraction');
    return { ...actual, extractReportSuggestions: (...args) => mockReport(...args) };
});
jest.mock('../../ai/tasks/cdlExtraction', () => ({ extractCdlFields: (...args) => mockCdl(...args) }));
jest.mock('../../ai/tasks/medicalCardExtraction', () => ({ extractMedicalCardFields: (...args) => mockMedical(...args) }));

const { extractCompanyApplicationDocuments, __private } = require('../../companyApplications/aiExtract');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAccess } = require('../../shared/companyAccess');
const { AiError } = require('../../ai/router/errors');

const CONTEXT = { auth: { uid: 'recruiter-1' } };
const PAGE = 'data:image/jpeg;base64,AAAA';

const TEXT_RESULT = {
    extracted: {
        driver: { firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '1988-03-11', fullAddress: '1 Main St' },
        license: { cdlNumber: 'TX1234567', cdlState: 'TX', cdlClass: 'Class A', cdlExpiration: '2030-12-31', endorsements: ['H'], medCardExpiration: '' },
        carriers: [{ name: 'Acme Trucking', dotNumber: '123456', firstSeen: '2024-03', lastSeen: '2025-01', recordType: 'inspection' }],
        violations: [{ date: '2023-07-04', charge: 'Speeding', location: 'Dallas, TX', source: 'psp' }],
        unreadable: [],
    },
    providerId: 'gemini', model: 'm', latencyMs: 5, fallbackCount: 0,
};

function call(documents, context = CONTEXT) {
    return extractCompanyApplicationDocuments({ companyId: 'co-1', documents }, context);
}

beforeEach(() => {
    jest.resetAllMocks();
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAccess.mockResolvedValue(undefined);
    mockText.mockResolvedValue(TEXT_RESULT);
    mockMedical.mockResolvedValue({ license: { medCardExpiration: '2027-06-30' } });
    mockCdl.mockResolvedValue({ fields: { firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '03/11/1988', fullAddress: '1 Main St', cdlNumber: 'TX1234567', expirationDate: '12/31/2030' } });
    mockReport.mockResolvedValue({ suggestions: { carriers: [], violations: [], license: {} } });
});

describe('what it accepts', () => {
    it('reads a single document as readily as four', async () => {
        const result = await call({ psp: { text: 'PSP body' } });

        expect(result.success).toBe(true);
        expect(mockText).toHaveBeenCalledWith({ documents: { psp: 'PSP body' } });
        expect(result.methods).toEqual({ psp: 'text' });
    });

    it('sends every text document in ONE request', async () => {
        await call({ cdl: { text: 'a' }, medical: { text: 'b' }, psp: { text: 'c' }, mvr: { text: 'd' } });

        expect(mockText).toHaveBeenCalledTimes(1);
        expect(mockText).toHaveBeenCalledWith({ documents: { cdl: 'a', medical: 'b', psp: 'c', mvr: 'd' } });
    });

    it('refuses a request with nothing attached', async () => {
        await expect(call({})).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call(undefined)).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockText).not.toHaveBeenCalled();
    });

    it.each([
        ['a page that is not an image data URL', { psp: { pages: ['data:application/pdf;base64,AAAA'] } }],
        ['too many pages', { psp: { pages: Array(__private.MAX_PAGES_PER_DOCUMENT + 1).fill(PAGE) } }],
        ['an oversized page', { psp: { pages: ['data:image/png;base64,' + 'A'.repeat(__private.MAX_IMAGE_CHARS)] } }],
    ])('refuses %s', async (_label, documents) => {
        await expect(call(documents)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('caps document text server-side, whatever the browser sent', async () => {
        await call({ psp: { text: 'x'.repeat(__private.MAX_TEXT_CHARS * 2) } });
        expect(mockText.mock.calls[0][0].documents.psp).toHaveLength(__private.MAX_TEXT_CHARS);
    });
});

describe('who may call it', () => {
    it('requires a signed-in company user', async () => {
        await expect(call({ psp: { text: 'a' } }, { auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockText).not.toHaveBeenCalled();
    });

    it('checks company access before spending an AI call', async () => {
        assertCompanyAccess.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        await expect(call({ psp: { text: 'a' } })).rejects.toThrow();
        expect(mockText).not.toHaveBeenCalled();
    });

    it('rate-limits per company user, fail-closed', async () => {
        checkRateLimit.mockResolvedValueOnce(false);
        await expect(call({ psp: { text: 'a' } })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(checkRateLimit).toHaveBeenCalledWith(
            'application_doc_extract_co-1_recruiter-1', expect.any(Number), expect.any(Number), 'closed',
        );
    });
});

describe('the vision fallback', () => {
    it('sends a document given as pages to the vision route instead', async () => {
        mockReport.mockResolvedValue({
            suggestions: { carriers: [{ name: 'Beta Freight', dotNumber: '777' }], violations: [{ date: '2024-01-01', charge: 'Log', location: '' }], license: {} },
        });

        const result = await call({ psp: { pages: [PAGE, PAGE] } });

        expect(mockReport).toHaveBeenCalledWith({ kind: 'psp', imageDataUrls: [PAGE, PAGE] });
        expect(mockText).not.toHaveBeenCalled();
        expect(result.methods).toEqual({ psp: 'vision' });
        expect(result.extracted.carriers[0].name).toBe('Beta Freight');
        expect(result.extracted.violations[0].source).toBe('psp');
    });

    it('mixes both routes in one request and reports which was used for what', async () => {
        const result = await call({ psp: { text: 'PSP body' }, medical: { pages: [PAGE] } });

        expect(result.methods).toEqual({ psp: 'text', medical: 'vision' });
        // The medical card only reads one field, and it lands beside the licence
        // fields the text pass found rather than replacing them.
        expect(result.extracted.license.medCardExpiration).toBe('2027-06-30');
        expect(result.extracted.license.cdlNumber).toBe('TX1234567');
    });

    it('names the documents the model itself could not read', async () => {
        mockText.mockResolvedValue({
            ...TEXT_RESULT,
            extracted: { ...TEXT_RESULT.extracted, unreadable: ['medical'] },
        });

        const result = await call({ psp: { text: 'a' }, medical: { text: 'garbled' } });

        // The client re-sends this one as pages; that second pass is the point of
        // reporting it rather than silently returning nothing for it.
        expect(result.methods).toEqual({ psp: 'text', medical: 'unreadable' });
    });

    it('does not let one unreadable document cost the carrier the others', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockMedical.mockRejectedValue(new AiError('malformed_response', 'nope'));
        mockReport.mockResolvedValue({ suggestions: { carriers: [{ name: 'Beta Freight', dotNumber: '777' }], violations: [], license: {} } });

        const result = await call({ psp: { pages: [PAGE] }, medical: { pages: [PAGE] } });

        expect(result.success).toBe(true);
        expect(result.methods).toEqual({ psp: 'vision', medical: 'failed' });
        expect(result.extracted.carriers[0].name).toBe('Beta Freight');
        spy.mockRestore();
    });

    it('fails only when nothing at all could be read', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockText.mockRejectedValue(new AiError('not_configured', 'no provider'));

        await expect(call({ psp: { text: 'a' } })).rejects.toMatchObject({ code: 'failed-precondition' });
        spy.mockRestore();
    });

    it('never leaks document content into an error or a log', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockText.mockRejectedValue(new AiError('internal', 'SSN 123-45-6789 was unreadable'));

        const error = await call({ psp: { text: 'a driver secret' } }).catch((e) => e);

        expect(error.message).not.toMatch(/123-45-6789/);
        const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(logged).not.toMatch(/123-45-6789|driver secret/);
        spy.mockRestore();
    });
});

describe('merging what the two routes found', () => {
    it('never lets a blank overwrite something already read', () => {
        const merged = __private.mergeExtraction(
            { license: { cdlNumber: 'TX1234567' }, carriers: [], violations: [] },
            { license: { cdlNumber: '', medCardExpiration: '2027-06-30' } },
        );
        expect(merged.license).toEqual({ cdlNumber: 'TX1234567', medCardExpiration: '2027-06-30' });
    });

    it('keeps rows from both', () => {
        const merged = __private.mergeExtraction(
            { carriers: [{ name: 'A' }], violations: [{ charge: 'x' }] },
            { carriers: [{ name: 'B' }], violations: [{ charge: 'y' }] },
        );
        expect(merged.carriers).toHaveLength(2);
        expect(merged.violations).toHaveLength(2);
    });
});
