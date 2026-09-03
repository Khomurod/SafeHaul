/**
 * What the probes exercise, and how a probe fails correctly.
 *
 * Part of the `aiHealthCheck` suite. The provider fake, the credential store
 * double, the healthy-answer generator and the reset are in
 * `aiHealthCheck.support.js`. Each `jest.mock` below has to stay in this file,
 * because Jest hoists it per file and cannot register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiHealthCheck.support').firebaseAdminMock());
jest.mock('../../ai/credentials/store', () => require('./aiHealthCheck.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiHealthCheck.support').providersMock());

const { testProviderConnection, PROBE_STATUS } = require('../../ai/tasks/healthCheck');
const {
    PROBES, RED_PNG, BLUE_PNG, PROBE_IMAGE_SIZE, solidColorPng,
} = require('../../ai/tasks/healthProbes');
const { AiError } = require('../../ai/router/errors');
const {
    mockExecute, healthyProvider, byId, resetHealthCheckState,
} = require('./aiHealthCheck.support');

beforeEach(resetHealthCheckState);

describe('probes exercise what SafeHaul actually asks for', () => {
    it('runs a probe for every capability the provider declares', async () => {
        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(result.success).toBe(true);
        // Gemini declares the full set, so nothing may be skipped.
        for (const probe of PROBES) {
            expect(probes[probe.id].status).toBe(PROBE_STATUS.PASSED);
        }
    });

    it('skips a capability the provider does not offer, and does not call it a failure', async () => {
        // Cloudflare is text-only. Reporting "failed vision" would read as
        // though something broke, when the provider simply does not offer it.
        const result = await testProviderConnection('cloudflare');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.SKIPPED);
        expect(probes.vision_multi.status).toBe(PROBE_STATUS.SKIPPED);
        expect(result.success).toBe(true);
    });

    it('sends real images to a vision probe, and two of them to the multi-image probe', async () => {
        await testProviderConnection('gemini');

        const single = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 1)[1];
        const multi = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 2)[1];

        expect(single.images[0].dataUrl).toBe(RED_PNG);
        expect(multi.images.map((image) => image.dataUrl)).toEqual([RED_PNG, BLUE_PNG]);
    });

    it('tests the vision model, not the text model, for image probes', async () => {
        // The pins that rotted were the vision ones. A probe resolving the text
        // model would have kept reporting healthy throughout.
        await testProviderConnection('groq');

        const visionCall = mockExecute.mock.calls.find(([, ctx]) => ctx.images?.length === 1)[1];
        expect(visionCall.model).toBe('qwen/qwen3.6-27b');
    });
});

describe('failing correctly', () => {
    it('fails the provider when structured JSON is rejected but text works', async () => {
        // The exact production incident: plain text fine, every schema request
        // a 400, connection test green.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema) {
                throw new AiError('provider_request_rejected', 'HTTP 400', { providerId, status: 400 });
            }
            return { text: 'ready', model: context.model };
        });

        const result = await testProviderConnection('groq');
        const probes = byId(result.capabilities);

        expect(probes.text.status).toBe(PROBE_STATUS.PASSED);
        expect(probes.structured_json.status).toBe(PROBE_STATUS.FAILED);
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Structured JSON/);
    });

    it('fails when the vision model has been retired by the vendor', async () => {
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images) {
                throw new AiError('model_unavailable', 'HTTP 404', { providerId, status: 404 });
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('mistral');
        const probes = byId(result.capabilities);

        expect(probes.vision_single).toMatchObject({
            status: PROBE_STATUS.FAILED,
            category: 'model_unavailable',
        });
        expect(result.success).toBe(false);
    });

    it('fails a provider that returns the right shape without reading the image', async () => {
        // A schema-valid object is not evidence the model looked at anything.
        // This is the check that separates "answered" from "answered correctly".
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images) return { text: '{"answer":"green"}', model: context.model };
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.FAILED);
        expect(probes.vision_single.message).toMatch(/did not read the request correctly/);
    });

    it('fails a provider that only ever looks at the first image', async () => {
        // Answering "red" to a question about the second image means the second
        // image was dropped — which a naive "did it reply" check cannot see.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.images?.length > 1) return { text: '{"answer":"red"}', model: context.model };
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');
        const probes = byId(result.capabilities);

        expect(probes.vision_single.status).toBe(PROBE_STATUS.PASSED);
        expect(probes.vision_multi.status).toBe(PROBE_STATUS.FAILED);
    });

    it('fails a verifier that rubber-stamps an unsupported claim', async () => {
        // The blog's fact-check stage is fail-closed: if it cannot run, nothing
        // publishes. A provider that approves everything is worse than one that
        // errors, so the probe uses a claim the source does not support.
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema?.properties?.supported) {
                return { text: '{"supported":true,"unsupportedClaims":[]}', model: context.model };
            }
            return healthyProvider(providerId, context);
        });

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).article_verification.status).toBe(PROBE_STATUS.FAILED);
    });

    it('validates structured output with SafeHaul own validator, not the vendor promise', async () => {
        mockExecute.mockImplementation((providerId, context) => {
            if (context.schema) return { text: '{"wrongKey":"red"}', model: context.model };
            return { text: 'ready', model: context.model };
        });

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).structured_json).toMatchObject({
            status: PROBE_STATUS.FAILED,
            category: 'schema_validation_failed',
        });
    });

    it('reports unparseable output as malformed rather than as a schema violation', async () => {
        mockExecute.mockImplementation((providerId, context) => (
            context.schema
                ? { text: 'I am afraid I cannot do that.', model: context.model }
                : { text: 'ready', model: context.model }
        ));

        const result = await testProviderConnection('gemini');

        expect(byId(result.capabilities).structured_json.category).toBe('malformed_response');
    });
});

/**
 * The probe images must be *standard* PNGs, not merely present.
 *
 * A hand-rolled minimal PNG is what put Mistral's newer models on the console as
 * "vision failed" — they reject it with `400 invalid_request_file` while reading
 * a conformant PNG of the same pixels perfectly. So these assertions guard the
 * encoding, not just the existence of two data URLs: signature, declared 256x256
 * dimensions, and a distinct second colour for the multi-image probe.
 */
describe('probe images are conformant PNGs', () => {
    const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    /** Decode a `data:image/png;base64,…` URL into its bytes. */
    function bytesOf(dataUrl) {
        expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
        return Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64');
    }

    it.each([['RED_PNG', RED_PNG], ['BLUE_PNG', BLUE_PNG]])('%s is a valid 256x256 PNG', (_name, url) => {
        const bytes = bytesOf(url);
        expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        // IHDR width/height live at byte offsets 16 and 20.
        expect(bytes.readUInt32BE(16)).toBe(PROBE_IMAGE_SIZE);
        expect(bytes.readUInt32BE(20)).toBe(PROBE_IMAGE_SIZE);
    });

    it('uses two distinct colours so a dropped second image cannot pass', () => {
        expect(RED_PNG).not.toBe(BLUE_PNG);
    });

    it('generates a conformant PNG for any colour and size', () => {
        const bytes = bytesOf(solidColorPng(8, [1, 2, 3]));
        expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(bytes.readUInt32BE(16)).toBe(8);
        expect(bytes.readUInt32BE(20)).toBe(8);
    });
});
