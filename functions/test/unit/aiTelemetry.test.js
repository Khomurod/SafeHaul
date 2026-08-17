/**
 * AI telemetry — transaction shape, and what must never reach it.
 *
 * The privacy half of this file is the important half. Telemetry now records
 * per-provider attempt detail, which is a much larger surface than the single
 * summary row it replaced, and the whole point of the platform's `restricted`
 * privacy class is that a CDL photograph leaves no trace anywhere. So these
 * tests assert the *negative*: given an entry carrying prompts, images,
 * credentials and extracted driver fields, none of it survives sanitization.
 *
 * An allowlist is only worth having if something proves it is the allowlist.
 */

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } },
    db: { collection: () => ({ add: mockAdd }) },
}));

const mockAdd = jest.fn().mockResolvedValue({ id: 'doc1' });

const {
    sanitize,
    describeTaskInput,
    recordAiTelemetry,
    ALLOWED_FIELDS,
    ALLOWED_ATTEMPT_FIELDS,
    MAX_ATTEMPTS,
    VENDOR_CODE_PATTERN,
} = require('../../ai/telemetry/record');

beforeEach(() => jest.clearAllMocks());

describe('transaction shape', () => {
    it('keeps the fields an operator needs to reconstruct a request', () => {
        const clean = sanitize({
            transactionId: '6f2a-1111',
            taskType: 'cdl_extraction',
            capability: 'vision',
            requiredCapabilities: ['vision', 'structured_json'],
            outcome: 'success',
            latencyMs: 2992,
            fallbackCount: 2,
            attemptedProviders: ['gemini', 'mistral', 'groq'],
            providersInvolved: ['gemini', 'mistral', 'groq'],
            finalProviderId: 'groq',
            credentialSource: 'secret-manager',
        });

        expect(clean.transactionId).toBe('6f2a-1111');
        expect(clean.requiredCapabilities).toEqual(['vision', 'structured_json']);
        expect(clean.fallbackCount).toBe(2);
        expect(clean.attemptedProviders).toEqual(['gemini', 'mistral', 'groq']);
    });

    it('records each provider attempt so the timeline reads in order', () => {
        const clean = sanitize({
            taskType: 'cdl_extraction',
            attempts: [
                {
                    providerId: 'gemini',
                    model: 'gemini-3.6-flash',
                    attemptNumber: 1,
                    status: 'attempted',
                    success: false,
                    category: 'quota_exceeded',
                    httpStatus: 429,
                    vendorCode: 'resource_exhausted',
                    latencyMs: 812,
                    retryAfterMs: 7222,
                    nextProviderId: 'groq',
                },
                {
                    providerId: 'groq',
                    model: 'qwen/qwen3.6-27b',
                    attemptNumber: 2,
                    status: 'attempted',
                    success: true,
                    latencyMs: 1940,
                    schemaValid: true,
                    inputTokens: 1200,
                    outputTokens: 210,
                },
            ],
        });

        expect(clean.attempts).toHaveLength(2);
        expect(clean.attempts[0]).toMatchObject({
            providerId: 'gemini',
            category: 'quota_exceeded',
            httpStatus: 429,
            vendorCode: 'resource_exhausted',
            nextProviderId: 'groq',
        });
        expect(clean.attempts[1]).toMatchObject({
            providerId: 'groq',
            success: true,
            schemaValid: true,
            inputTokens: 1200,
        });
    });

    it('records a skipped provider and why, not just the ones that were tried', () => {
        // "Why was Mistral never asked?" is the question the console could not
        // answer, and it is answered by the skip rather than by the attempts.
        const clean = sanitize({
            attempts: [
                { providerId: 'mistral', status: 'skipped', skipReason: 'cooldown', success: false },
            ],
        });

        expect(clean.attempts[0]).toMatchObject({
            providerId: 'mistral',
            status: 'skipped',
            skipReason: 'cooldown',
        });
    });

    it('bounds the attempts array so a loop cannot bloat the document', () => {
        const many = Array.from({ length: MAX_ATTEMPTS + 20 }, (_v, index) => ({
            providerId: `p${index}`,
            status: 'attempted',
        }));

        expect(sanitize({ attempts: many }).attempts).toHaveLength(MAX_ATTEMPTS);
    });
});

describe('what must never be recorded', () => {
    /**
     * The full hostile entry: everything a caller could wrongly hand telemetry
     * on the CDL path. None of it may survive.
     */
    const LEAKY_ENTRY = Object.freeze({
        taskType: 'cdl_extraction',
        outcome: 'success',
        // Things that must be dropped outright.
        prompt: 'You are an OCR data extractor for US Commercial Driver Licenses',
        inputText: 'Read this licence',
        imageDataUrl: 'data:image/jpeg;base64,SECRETLICENCEBYTES',
        images: [{ dataUrl: 'data:image/jpeg;base64,SECRETLICENCEBYTES' }],
        responseText: '{"firstName":"Dana","cdlNumber":"D1234567"}',
        output: { firstName: 'Dana', lastName: 'Reyes', cdlNumber: 'D1234567' },
        apiKey: 'gsk_live_realkeymaterial',
        credentials: { apiKey: 'gsk_live_realkeymaterial' },
        articleDraft: 'FMCSA today announced...',
        uid: 'user-123',
        companyId: 'co-456',
    });

    it('drops every unlisted field, whatever it contains', () => {
        const clean = sanitize({ ...LEAKY_ENTRY });

        for (const key of Object.keys(clean)) {
            expect(ALLOWED_FIELDS).toContain(key);
        }
        const serialized = JSON.stringify(clean);
        expect(serialized).not.toMatch(/SECRETLICENCEBYTES/);
        expect(serialized).not.toMatch(/gsk_live_realkeymaterial/);
        expect(serialized).not.toMatch(/D1234567/);
        expect(serialized).not.toMatch(/Dana/);
        expect(serialized).not.toMatch(/FMCSA today/);
        expect(serialized).not.toMatch(/OCR data extractor/);
    });

    it('drops unlisted fields inside an attempt too', () => {
        // The nested allowlist matters independently: attempts are where vendor
        // diagnostics live, and a vendor's error body is the most likely place
        // for a prompt to come back to us.
        const clean = sanitize({
            attempts: [{
                providerId: 'groq',
                category: 'provider_request_rejected',
                errorMessage: 'Invalid request: "Read this licence for Dana Reyes D1234567"',
                errorBody: '{"error":{"message":"prompt echoed: SECRETLICENCEBYTES"}}',
                requestBody: { input: 'data:image/jpeg;base64,SECRETLICENCEBYTES' },
            }],
        });

        for (const key of Object.keys(clean.attempts[0])) {
            expect(ALLOWED_ATTEMPT_FIELDS).toContain(key);
        }
        const serialized = JSON.stringify(clean.attempts[0]);
        expect(serialized).not.toMatch(/Dana Reyes/);
        expect(serialized).not.toMatch(/SECRETLICENCEBYTES/);
        expect(serialized).not.toMatch(/prompt echoed/);
    });

    it('keeps a vendor code but refuses a vendor message wearing its name', () => {
        // A truncated error message is still an error message, so `vendorCode`
        // is validated positively rather than merely sliced. Several vendors
        // quote the submitted prompt back inside their error strings — on the
        // CDL path, that means quoting the licence.
        const good = sanitize({ attempts: [{ providerId: 'g', vendorCode: 'model_not_found' }] });
        expect(good.attempts[0].vendorCode).toBe('model_not_found');

        const bad = sanitize({
            attempts: [{
                providerId: 'g',
                vendorCode: 'The model rejected: "Dana Reyes, licence D1234567"',
            }],
        });
        expect(bad.attempts[0].vendorCode).toBeUndefined();
    });

    it.each([
        ['model_not_found', true],
        ['rate_limit_exceeded', true],
        ['insufficient_quota', true],
        ['429', true],
        ['has a space', false],
        ['{"error":"x"}', false],
        ['line\nbreak', false],
        ['a'.repeat(65), false],
    ])('vendor code %s is accepted: %s', (candidate, accepted) => {
        expect(VENDOR_CODE_PATTERN.test(candidate)).toBe(accepted);
    });

    it('writes only sanitized data to Firestore', async () => {
        await recordAiTelemetry({ ...LEAKY_ENTRY });

        const written = JSON.stringify(mockAdd.mock.calls[0][0]);
        expect(written).not.toMatch(/SECRETLICENCEBYTES/);
        expect(written).not.toMatch(/gsk_live_realkeymaterial/);
        expect(written).not.toMatch(/D1234567/);
    });

    it('never throws, so telemetry cannot turn a good AI call into a failure', async () => {
        mockAdd.mockRejectedValueOnce(new Error('firestore down'));

        await expect(recordAiTelemetry({ taskType: 'cdl_extraction' })).resolves.toBeUndefined();
    });
});

describe('describeTaskInput', () => {
    /**
     * The operator's real question is "what kind of request was this" — one
     * JPEG and six fields, or a long article prompt. That is answerable from
     * shape alone, so nothing here may be derived from prompt text, image bytes
     * or the model's answer.
     */
    it('describes a CDL request by shape, not by content', () => {
        const summary = describeTaskInput({
            inputText: 'You are an OCR data extractor for US Commercial Driver Licenses.',
            images: [{ dataUrl: 'data:image/jpeg;base64,SECRETLICENCEBYTES' }],
            outputSchema: {
                type: 'object',
                properties: {
                    firstName: {}, lastName: {}, dateOfBirth: {},
                    fullAddress: {}, cdlNumber: {}, expirationDate: {},
                },
            },
        });

        expect(summary).toContain('1 image (image/jpeg)');
        expect(summary).toContain('6 structured fields requested');
        expect(summary).not.toMatch(/SECRETLICENCEBYTES/);
        expect(summary).not.toMatch(/OCR data extractor/);
        expect(summary).not.toMatch(/Commercial Driver/);
    });

    it('counts multiple pages and their media types', () => {
        const summary = describeTaskInput({
            inputText: 'x',
            images: [
                { dataUrl: 'data:image/png;base64,AAAA' },
                { dataUrl: 'data:image/jpeg;base64,BBBB' },
                { dataUrl: 'data:image/png;base64,CCCC' },
            ],
        });

        expect(summary).toContain('3 images (image/jpeg, image/png)');
    });

    it('reports prompt length without a character of the prompt', () => {
        const summary = describeTaskInput({ inputText: 'FMCSA announced a new rule today' });

        expect(summary).toContain('32-character prompt');
        expect(summary).not.toMatch(/FMCSA/);
    });

    it('says something useful when there is nothing structured to describe', () => {
        expect(describeTaskInput({})).toBe('no structured input');
    });
});
