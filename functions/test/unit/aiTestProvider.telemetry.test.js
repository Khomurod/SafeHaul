/**
 * The operator's Test button leaves a row in the Logs tab's Connection tests,
 * marked `manual`, with one attempt per capability probe that ran.
 *
 * Only the log: the row is a `health_check`, which the hourly watcher's failure
 * count leaves out, and the test result itself crosses back unchanged even when
 * the row cannot be written.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((options, handler) => (typeof handler === 'function' ? handler : options)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('../../firebaseAdmin', () => ({ db: {}, admin: { firestore: { FieldValue: {} } } }));
jest.mock('../../environmentVault/guards', () => ({
    assertSuperAdmin: jest.fn(), assertWithinRateLimit: jest.fn(), guardPrivileged: jest.fn(),
}));
const mockAudit = jest.fn();
jest.mock('../../environmentVault/audit', () => ({
    ...jest.requireActual('../../environmentVault/audit'),
    recordAuditEvent: (...args) => mockAudit(...args),
}));
const mockTest = jest.fn();
jest.mock('../../ai/tasks/healthCheck', () => ({
    ...jest.requireActual('../../ai/tasks/healthCheck'),
    testProviderConnection: (...args) => mockTest(...args),
}));
const mockAdd = jest.fn();
jest.mock('../../ai/telemetry/record', () => {
    const actual = jest.requireActual('../../ai/telemetry/record');
    return { ...actual, recordAiTelemetry: (entry) => mockRecord(entry) };
});
let mockRecord;

const { testAiProvider } = require('../../ai/callables/health');
const { sanitize } = jest.requireActual('../../ai/telemetry/record');

const request = (data) => ({ auth: { uid: 'super-1', token: { globalRole: 'super_admin' } }, data });

const RESULT = {
    success: false,
    category: 'model_unavailable',
    message: '1 of 2 capabilities failed: Single image.',
    model: 'gemini-2.5-flash',
    latencyMs: 2400,
    capabilities: [
        { id: 'text', label: 'Text', status: 'passed', model: 'gemini-2.5-flash', latencyMs: 900 },
        {
            id: 'vision_single', label: 'Single image', status: 'failed', model: 'gemini-2.5-flash',
            category: 'model_unavailable', httpStatus: 404, vendorCode: 'model_not_found', latencyMs: 1500,
        },
        { id: 'vision_multi', label: 'Several images', status: 'skipped' },
        { id: 'json', label: 'Structured JSON', status: 'not_run' },
    ],
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRecord = async (entry) => { mockAdd(sanitize(entry)); };
    mockTest.mockResolvedValue(RESULT);
});

describe('testAiProvider writes one manual Connection test row', () => {
    it('records the test as a health_check marked manual, one attempt per probe that ran', async () => {
        await testAiProvider(request({ providerId: 'gemini' }));

        expect(mockAdd).toHaveBeenCalledTimes(1);
        const row = mockAdd.mock.calls[0][0];
        expect(row).toEqual(expect.objectContaining({
            taskType: 'health_check',
            trigger: 'manual',
            providerId: 'gemini',
            model: 'gemini-2.5-flash',
            outcome: 'failure',
            category: 'model_unavailable',
            latencyMs: 2400,
            inputSummary: '3 capability probes',
        }));
        expect(row.transactionId).toEqual(expect.any(String));
        // The skipped probe (a capability the provider does not offer) is not an
        // attempt; the one the time budget never reached is, as skipped.
        expect(row.attempts).toEqual([
            expect.objectContaining({ attemptNumber: 1, probe: 'Text', status: 'attempted', success: true }),
            expect.objectContaining({
                attemptNumber: 2, probe: 'Single image', status: 'attempted', success: false,
                category: 'model_unavailable', httpStatus: 404, vendorCode: 'model_not_found',
            }),
            expect.objectContaining({ attemptNumber: 3, status: 'skipped', skipReason: 'not_run', success: false }),
        ]);
    });

    it('records a pass as a success without a category', async () => {
        mockTest.mockResolvedValue({
            ...RESULT, success: true, category: null, message: 'Connected.',
            capabilities: [RESULT.capabilities[0]],
        });

        await testAiProvider(request({ providerId: 'gemini' }));

        const row = mockAdd.mock.calls[0][0];
        expect(row).toEqual(expect.objectContaining({ outcome: 'success', trigger: 'manual', inputSummary: '1 capability probe' }));
        expect(row.category).toBeUndefined();
    });

    it('names why a test the vendor throttled did not pass', async () => {
        mockTest.mockResolvedValue({
            ...RESULT, category: null, message: 'Not verified: Text.',
            capabilities: [{ id: 'text', label: 'Text', status: 'rate_limited', category: 'rate_limited', httpStatus: 429 }],
        });

        await testAiProvider(request({ providerId: 'gemini' }));

        expect(mockAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ outcome: 'failure', category: 'rate_limited' }));
    });

    it('answers within a few seconds of the probes when the write stalls', async () => {
        jest.useFakeTimers();
        try {
            mockRecord = () => new Promise(() => {});
            const pending = testAiProvider(request({ providerId: 'gemini' }));
            await jest.advanceTimersByTimeAsync(5000);
            await expect(pending).resolves.toEqual(expect.objectContaining({ providerId: 'gemini', message: RESULT.message }));
            expect(mockAudit).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('returns the test result unchanged when the row cannot be written', async () => {
        // The real recorder over a `db` with no collections: the write throws.
        mockRecord = jest.requireActual('../../ai/telemetry/record').recordAiTelemetry;
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const response = await testAiProvider(request({ providerId: 'gemini' }));

        expect(response).toEqual(expect.objectContaining({
            providerId: 'gemini', success: false, message: RESULT.message, latencyMs: 2400,
        }));
        expect(mockAudit).toHaveBeenCalledTimes(1);
        console.error.mockRestore();
    });
});
