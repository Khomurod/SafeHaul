/**
 * extractApplicationReport — the guest-reachable report import callable.
 *
 * Mocked at the task boundary, exactly as `cdlParser.test.js` is: provider
 * selection and fallback belong to the router's own suites. What this file pins
 * is the callable's responsibilities — payload validation, tenant admission, the
 * company's own integration switch, the per-IP rate limit, the response contract
 * and the error mapping — and, above all, that a company which has not enabled
 * the source cannot have it used against its applicants' documents.
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

// Plain functions rather than `jest.fn` wrappers: the suite resets every mock
// before each test (it queues `*Once` values — see AGENTS.md), and a reset
// `jest.fn` collection() would return undefined, which the callable's own
// try/catch would read as "the profile had no answer".
const mockPublicProfileGet = jest.fn();
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: (name) => ({
            doc: () => ({ get: (...args) => mockPublicProfileGet(name, ...args) }),
        }),
    },
}));
jest.mock('../../shared/companyTenant', () => ({
    assertCompanyAcceptingIntake: jest.fn(),
}));
jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const mockExtractReportSuggestions = jest.fn();
jest.mock('../../ai/tasks/reportExtraction', () => {
    const actual = jest.requireActual('../../ai/tasks/reportExtraction');
    return { ...actual, extractReportSuggestions: (...args) => mockExtractReportSuggestions(...args) };
});

const { extractApplicationReport, __private } = require('../../applicationReportImport');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');
const { AiError } = require('../../ai/router/errors');

const GUEST_CONTEXT = { rawRequest: { ip: '203.0.113.8' }, auth: undefined };
const PAGE = 'data:image/jpeg;base64,AAAA';
const ENABLED_BOTH = { applicationIntegrations: { psp: { enabled: true }, mvr: { enabled: true } } };

function publicProfile(data) {
    mockPublicProfileGet.mockResolvedValue({ exists: data !== null, data: () => data });
}

const SUGGESTIONS = {
    kind: 'psp',
    suggestions: { carriers: [{ name: 'Acme', dotNumber: '1', firstSeen: '2024-01', lastSeen: '2024-02', recordType: 'inspection' }], violations: [] },
    providerId: 'groq',
    model: 'test-model',
    latencyMs: 5,
    fallbackCount: 0,
};

describe('extractApplicationReport', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        checkRateLimit.mockResolvedValue(true);
        assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Tenant Co', ...ENABLED_BOTH });
        publicProfile(ENABLED_BOTH);
        mockExtractReportSuggestions.mockResolvedValue(SUGGESTIONS);
    });

    describe('payload validation happens before any lookup', () => {
        it.each([
            ['no companyId', { kind: 'psp', pages: [PAGE] }],
            ['unknown kind', { companyId: 'co1', kind: 'resume', pages: [PAGE] }],
            ['no pages', { companyId: 'co1', kind: 'psp', pages: [] }],
            ['too many pages', { companyId: 'co1', kind: 'psp', pages: Array(__private.MAX_PAGES + 1).fill(PAGE) }],
            ['a page that is not an image data URL', { companyId: 'co1', kind: 'psp', pages: ['data:application/pdf;base64,AAAA'] }],
            ['a page that is not a string', { companyId: 'co1', kind: 'psp', pages: [{ dataUrl: PAGE }] }],
            ['an oversized page', { companyId: 'co1', kind: 'psp', pages: ['data:image/png;base64,' + 'A'.repeat(__private.MAX_IMAGE_CHARS)] }],
        ])('rejects %s as invalid-argument', async (_label, payload) => {
            await expect(extractApplicationReport(payload, GUEST_CONTEXT)).rejects.toMatchObject({ code: 'invalid-argument' });
            expect(assertCompanyAcceptingIntake).not.toHaveBeenCalled();
            expect(mockExtractReportSuggestions).not.toHaveBeenCalled();
        });

        it('accepts png, jpeg and webp pages', async () => {
            for (const type of ['png', 'jpeg', 'jpg', 'webp']) {
                await expect(extractApplicationReport(
                    { companyId: 'co1', kind: 'psp', pages: [`data:image/${type};base64,AAAA`] },
                    GUEST_CONTEXT,
                )).resolves.toMatchObject({ success: true });
            }
        });
    });

    it('serves a guest caller and returns the suggestions, naming who answered', async () => {
        const res = await extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE, PAGE] }, GUEST_CONTEXT);
        expect(res).toEqual({
            success: true,
            kind: 'psp',
            suggestions: SUGGESTIONS.suggestions,
            provider: 'groq',
            sourceModel: 'test-model',
        });
        expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
        expect(mockExtractReportSuggestions).toHaveBeenCalledWith({ kind: 'psp', imageDataUrls: [PAGE, PAGE] });
        expect(checkRateLimit).toHaveBeenCalledWith('report_import_203.0.113.8', 6, 60, 'closed');
    });

    it('enforces tenant admission before spending an AI call', async () => {
        assertCompanyAcceptingIntake.mockRejectedValueOnce(Object.assign(new Error('inactive'), { code: 'permission-denied' }));
        await expect(extractApplicationReport({ companyId: 'closed', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT)).rejects.toThrow();
        expect(mockExtractReportSuggestions).not.toHaveBeenCalled();
    });

    describe('the company switch', () => {
        it('refuses when the company has not enabled the source', async () => {
            publicProfile({ applicationIntegrations: { psp: { enabled: true }, mvr: { enabled: false } } });
            assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Tenant Co' });
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'mvr', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'failed-precondition' });
            expect(mockExtractReportSuggestions).not.toHaveBeenCalled();
            expect(checkRateLimit).not.toHaveBeenCalled();
        });

        it('refuses a company with no integrations configured at all', async () => {
            publicProfile({ companyName: 'Plain Co' });
            assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Plain Co' });
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'failed-precondition' });
        });

        it('prefers the published public profile over the company record', async () => {
            // The public profile is what the applicant's page was rendered from;
            // if the two disagree, the applicant was shown the profile's answer.
            publicProfile({ applicationIntegrations: { psp: { enabled: false } } });
            assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Tenant Co', ...ENABLED_BOTH });
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'failed-precondition' });
        });

        it('falls back to the company record when the profile has no answer', async () => {
            publicProfile(null);
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
                .resolves.toMatchObject({ success: true });
        });

        it('treats a profile read error as "no answer from the profile", not as enabled', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockPublicProfileGet.mockRejectedValue(new Error('unavailable'));
            assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Tenant Co' });
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'failed-precondition' });
            spy.mockRestore();
        });

        it('ignores a truthy non-boolean flag', async () => {
            publicProfile({ applicationIntegrations: { psp: { enabled: 'yes' } } });
            assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Tenant Co' });
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'failed-precondition' });
        });
    });

    it('enforces the per-IP rate limit before spending an AI call', async () => {
        checkRateLimit.mockResolvedValueOnce(false);
        await expect(extractApplicationReport({ companyId: 'co1', kind: 'psp', pages: [PAGE] }, GUEST_CONTEXT))
            .rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockExtractReportSuggestions).not.toHaveBeenCalled();
    });

    describe('AI failures map to client-facing codes without leaking content', () => {
        let spy;
        beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
        afterEach(() => spy.mockRestore());

        it.each([
            ['not_configured', 'failed-precondition'],
            ['capability_unavailable', 'failed-precondition'],
            ['credential_error', 'failed-precondition'],
            ['timeout', 'unavailable'],
            ['network', 'unavailable'],
            ['deadline_exceeded', 'unavailable'],
            ['malformed_response', 'internal'],
            ['schema_validation_failed', 'internal'],
            ['something_else', 'internal'],
        ])('maps %s to %s', async (category, code) => {
            mockExtractReportSuggestions.mockRejectedValue(new AiError(category, 'secret detail about the pages'));
            const error = await extractApplicationReport({ companyId: 'co1', kind: 'mvr', pages: [PAGE] }, GUEST_CONTEXT).catch((e) => e);
            expect(error.code).toBe(code);
            expect(error.message).not.toMatch(/secret detail/);
            const logged = spy.mock.calls.map((call) => call.join(' ')).join('\n');
            expect(logged).not.toMatch(/secret detail/);
            expect(logged).not.toMatch(/AAAA/);
        });

        it('maps a plain Error to internal', async () => {
            mockExtractReportSuggestions.mockRejectedValue(new Error('boom'));
            await expect(extractApplicationReport({ companyId: 'co1', kind: 'mvr', pages: [PAGE] }, GUEST_CONTEXT))
                .rejects.toMatchObject({ code: 'internal' });
        });
    });
});
