// =====================================================================
// initBulkSession launches a campaign draft once (`helpers/launchClaim.js`).
//
// The draft is claimed before any recipient is gathered or any session is
// written, so a refused claim sends nothing. A launch that goes out marks the
// draft; every way a launch can stop short gives the claim back.
// =====================================================================

const mockClaim = jest.fn();
const mockFinish = jest.fn();
const mockRelease = jest.fn();
const mockVerifyDirectSelection = jest.fn();
const mockGatherIds = jest.fn();
const mockWriteNewSession = jest.fn();
const mockEnqueueWorker = jest.fn();
const mockCheckRateLimit = jest.fn();
const mockAssertCompanyAdmin = jest.fn();
const mockSessionUpdate = jest.fn();

const DRAFT = { path: 'companies/company-1/campaign_drafts/camp-1' };
const mockSessionRef = { id: 'session-1', update: (...args) => mockSessionUpdate(...args) };

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } } },
    db: {
        collection: () => ({
            doc: () => ({ collection: () => ({ doc: () => mockSessionRef }) }),
        }),
    },
}));

jest.mock('../../bulkActions/helpers/launchClaim', () => ({
    claimDraftLaunch: (...args) => mockClaim(...args),
    finishDraftLaunch: (...args) => mockFinish(...args),
    releaseDraftLaunch: (...args) => mockRelease(...args),
}));
jest.mock('../../bulkActions/helpers/auth', () => ({
    assertCompanyAdmin: (...args) => mockAssertCompanyAdmin(...args),
}));
jest.mock('../../bulkActions/services/queueService', () => ({
    enqueueWorker: (...args) => mockEnqueueWorker(...args),
}));
jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args),
}));
jest.mock('../../bulkActions/controllers/session/gatherTargets', () => ({
    verifyDirectSelection: (...args) => mockVerifyDirectSelection(...args),
    gatherIdsFromQueries: (...args) => mockGatherIds(...args),
}));
jest.mock('../../bulkActions/helpers/sessionTargets', () => ({
    writeNewSession: (...args) => mockWriteNewSession(...args),
    readSessionTargetIds: jest.fn(),
}));

const { initBulkSession } = require('../../bulkActions/controllers/sessionController');

function request(data = {}) {
    return {
        auth: { uid: 'admin-1' },
        data: {
            companyId: 'company-1',
            campaignId: 'camp-1',
            filters: {},
            config: { method: 'sms', message: 'hello' },
            sessionName: 'Spring drive',
            ...data,
        },
    };
}

beforeEach(() => {
    // Tests below queue `*Once` values: reset, then put the defaults back.
    jest.resetAllMocks();
    mockClaim.mockResolvedValue(DRAFT);
    mockFinish.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockAssertCompanyAdmin.mockResolvedValue(true);
    mockCheckRateLimit.mockResolvedValue(true);
    mockGatherIds.mockResolvedValue(['lead-1', 'lead-2']);
    mockVerifyDirectSelection.mockResolvedValue(['lead-1']);
    mockWriteNewSession.mockResolvedValue(undefined);
    mockEnqueueWorker.mockResolvedValue(undefined);
    mockSessionUpdate.mockResolvedValue(undefined);
});

describe('initBulkSession — one launch per draft', () => {
    it('claims the draft for this session, by this admin, before gathering anyone', async () => {
        await initBulkSession(request());

        expect(mockClaim).toHaveBeenCalledWith({
            companyId: 'company-1',
            campaignId: 'camp-1',
            uid: 'admin-1',
            sessionId: 'session-1',
        });
        expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(mockGatherIds.mock.invocationCallOrder[0]);
    });

    it('marks the draft launched once the session is sending, and gives nothing back', async () => {
        const result = await initBulkSession(request());

        expect(result).toMatchObject({ success: true, sessionId: 'session-1', targetCount: 2 });
        expect(mockFinish).toHaveBeenCalledWith(DRAFT, 'session-1');
        expect(mockFinish.mock.invocationCallOrder[0]).toBeGreaterThan(mockEnqueueWorker.mock.invocationCallOrder[0]);
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('sends nothing when the claim is refused: no recipients, no session, no worker', async () => {
        const refused = Object.assign(new Error('This campaign is being launched in another tab'), {
            code: 'failed-precondition',
        });
        mockClaim.mockRejectedValueOnce(refused);

        await expect(initBulkSession(request())).rejects.toBe(refused);

        expect(mockGatherIds).not.toHaveBeenCalled();
        expect(mockWriteNewSession).not.toHaveBeenCalled();
        expect(mockEnqueueWorker).not.toHaveBeenCalled();
        expect(mockFinish).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('gives the claim back when nobody matches, so the audience can be fixed and launched', async () => {
        mockGatherIds.mockResolvedValueOnce([]);

        const result = await initBulkSession(request());

        expect(result).toMatchObject({ success: false });
        expect(mockRelease).toHaveBeenCalledWith(DRAFT, 'session-1');
        expect(mockFinish).not.toHaveBeenCalled();
    });

    it('gives the claim back when the worker cannot start, and still reports the failure', async () => {
        const queueDown = new Error('bulk-actions-queue missing');
        mockEnqueueWorker.mockRejectedValueOnce(queueDown);

        await expect(initBulkSession(request())).rejects.toBe(queueDown);

        expect(mockSessionUpdate).toHaveBeenCalledWith({ status: 'failed', error: 'Failed to start queue.' });
        expect(mockRelease).toHaveBeenCalledWith(DRAFT, 'session-1');
        expect(mockFinish).not.toHaveBeenCalled();
    });

    it('gives the claim back when the audience is over the launch limit', async () => {
        mockGatherIds.mockResolvedValueOnce(Array.from({ length: 2001 }, (_, i) => `lead-${i}`));

        await expect(initBulkSession(request())).rejects.toMatchObject({ code: 'invalid-argument' });

        expect(mockRelease).toHaveBeenCalledWith(DRAFT, 'session-1');
        expect(mockWriteNewSession).not.toHaveBeenCalled();
    });

    it('claims nothing before the rate limit lets the launch through', async () => {
        mockCheckRateLimit.mockResolvedValueOnce(false);

        await expect(initBulkSession(request())).rejects.toMatchObject({ code: 'resource-exhausted' });

        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('passes no draft on for a screen that names none, and launches as before', async () => {
        mockClaim.mockResolvedValueOnce(null);

        const result = await initBulkSession(request({ campaignId: undefined }));

        expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({ campaignId: undefined }));
        expect(result.success).toBe(true);
        expect(mockFinish).toHaveBeenCalledWith(null, 'session-1');
    });
});
