/**
 * What is persisted per capability, and the safety and secrecy properties.
 *
 * Part of the `aiHealthCheck` suite. The provider fake, the credential store
 * double, the healthy-answer generator and the reset are in
 * `aiHealthCheck.support.js`. Each `jest.mock` below has to stay in this file,
 * because Jest hoists it per file and cannot register one from a helper.
 */

jest.mock('../../firebaseAdmin', () => require('./aiHealthCheck.support').firebaseAdminMock());
jest.mock('../../ai/credentials/store', () => require('./aiHealthCheck.support').credentialsStoreMock());
jest.mock('../../ai/providers', () => require('./aiHealthCheck.support').providersMock());

const { testProviderConnection } = require('../../ai/tasks/healthCheck');
const { AiError } = require('../../ai/router/errors');
const {
    mockStore, mockExecute, healthyProvider, resetHealthCheckState,
} = require('./aiHealthCheck.support');

beforeEach(resetHealthCheckState);

/**
 * The per-capability breakdown has to survive a reload, because a reload is when
 * an operator comes back to look. It was computed, returned once and discarded,
 * so the row said "text passed, single-image failed" until the page refreshed and
 * a bare "Failed" afterwards.
 */
describe('per-capability results are persisted, not just returned', () => {
    it('stores the breakdown with the vendor detail against the provider', async () => {
        mockExecute.mockImplementation(async (providerId, context) => {
            if (context.images) {
                throw new AiError('model_unavailable', 'HTTP 404', {
                    providerId, status: 404, vendorCode: 'model_not_found',
                });
            }
            return healthyProvider(providerId, context);
        });

        await testProviderConnection('gemini');

        expect(mockStore.recordTestResult).toHaveBeenCalledWith('gemini', expect.objectContaining({
            success: false,
            capabilities: expect.arrayContaining([
                expect.objectContaining({
                    id: 'vision_single',
                    status: 'failed',
                    httpStatus: 404,
                    vendorCode: 'model_not_found',
                }),
            ]),
        }));
    });
});

describe('safety and secrecy', () => {
    it('never sends anything but constant prompts and generated images', async () => {
        await testProviderConnection('gemini');

        const sent = JSON.stringify(mockExecute.mock.calls.map(([, context]) => ({
            inputText: context.inputText,
            systemInstructions: context.systemInstructions,
        })));
        // The article probes name a fictional body precisely so nothing in a
        // probe can be mistaken for real source material.
        expect(sent).toMatch(/Example Freight Authority/);
        expect(sent).not.toMatch(/FMCSA/);
        expect(sent).not.toMatch(/licence|license|CDL|driver/i);
    });

    it('never surfaces a vendor error body, which can quote the request back', async () => {
        mockExecute.mockImplementation((providerId) => {
            throw new AiError('provider_request_rejected', 'HTTP 400: prompt echoed SECRETVALUE', {
                providerId, status: 400,
            });
        });

        const result = await testProviderConnection('gemini');

        expect(JSON.stringify(result)).not.toMatch(/SECRETVALUE/);
    });

    it('refuses a retired provider before spending anything', async () => {
        const result = await testProviderConnection('github-models');

        expect(result.success).toBe(false);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('asks for credentials before probing, not after', async () => {
        mockStore.resolveCredentials.mockResolvedValue({ complete: false, values: {}, missing: ['apiKey'], source: null });

        const result = await testProviderConnection('gemini');

        expect(result).toMatchObject({ success: false, category: 'not_configured' });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    /**
     * "Add credentials before testing" is actively wrong when the credential is
     * present and the runtime is not permitted to read it — and that read was
     * unguarded, so the exception escaped to `safeFailure` in ../callables.js and
     * became `internal: "The request could not be completed."` The one screen
     * whose job is to explain why a provider is not working said nothing at all.
     */
    it('reports an unreadable credential as such, not as a missing one', async () => {
        mockStore.resolveCredentials.mockResolvedValue({
            complete: false, values: {}, missing: [], unreadable: ['apiKey'], source: null,
        });

        const result = await testProviderConnection('gemini');

        expect(result).toMatchObject({ success: false, category: 'credential_error' });
        expect(result.message).toMatch(/Secret Manager access/i);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('survives a credential read that throws instead of returning', async () => {
        const denied = new Error('7 PERMISSION_DENIED on projects/x/secrets/SAFEHAUL_AI_GEMINI_APIKEY');
        denied.code = 7;
        mockStore.resolveCredentials.mockRejectedValue(denied);

        const result = await testProviderConnection('gemini');

        expect(result).toMatchObject({ success: false, category: 'credential_error' });
        // The resource name stays in the server log where it belongs.
        expect(JSON.stringify(result)).not.toMatch(/SAFEHAUL_AI_GEMINI_APIKEY/);
        expect(JSON.stringify(result)).not.toMatch(/PERMISSION_DENIED/);
    });

    it('survives a provider config read that throws', async () => {
        mockStore.readConfig.mockRejectedValue(new Error('firestore unavailable'));

        const result = await testProviderConnection('gemini');

        expect(result.success).toBe(false);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('is exposed through the callable, not only from the task', async () => {
        // The gap a stubbed frontend test cannot see: `testAiProvider` rebuilds
        // its response field by field, and `capabilities` was simply absent — so
        // the per-capability UI would have rendered nothing in production while
        // every test passed. Asserting the *callable's* shape is what closes it.
        const source = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../ai/callables.js'),
            'utf8',
        );
        // Bounded to this handler: the file continues into other callables,
        // and scanning past the closing brace asserts nothing about this one.
        const start = source.indexOf('exports.testAiProvider');
        const testBlock = source.slice(start, source.indexOf('exports.', start + 10));

        expect(testBlock).toMatch(/capabilities:/);
        // And rebuilt from an allowlist, not spread wholesale — what crosses
        // this boundary is chosen, never inherited from an internal shape.
        expect(testBlock).not.toMatch(/\.\.\.result/);
    });

    it('stops probing before the callable can be killed, and says so', async () => {
        // Probes run serially; a stalled provider can burn the full per-probe
        // timeout on each. The same shape of bug as a router deadline larger
        // than the function it runs inside — and it bites hardest exactly when
        // an operator is diagnosing a provider that has gone quiet.
        const { HEALTH_TOTAL_BUDGET_MS } = require('../../ai/tasks/healthCheck');
        let elapsed = 0;
        const realNow = Date.now;
        jest.spyOn(Date, 'now').mockImplementation(() => {
            elapsed += 40000;
            return realNow() + elapsed;
        });

        const result = await testProviderConnection('gemini');
        Date.now.mockRestore();

        expect(HEALTH_TOTAL_BUDGET_MS).toBeLessThan(180 * 1000);
        const notRun = result.capabilities.filter((entry) => entry.status === 'not_run');
        expect(notRun.length).toBeGreaterThan(0);
        // A test that did not finish is not a pass.
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/ran out of time/i);
    });

    it('keeps the response fields the existing console already reads', async () => {
        // `capabilities` is additive. Renaming or dropping any of these would
        // break a deployed browser that has not reloaded.
        const result = await testProviderConnection('gemini');

        expect(result).toEqual(expect.objectContaining({
            success: expect.any(Boolean),
            message: expect.any(String),
            model: expect.any(String),
            latencyMs: expect.any(Number),
            capabilities: expect.any(Array),
        }));
    });
});
