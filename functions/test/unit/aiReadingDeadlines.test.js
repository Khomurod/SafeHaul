/**
 * Every task that reads a driver's document leaves time to fail over.
 *
 * The first provider in the routing order has its own timeout as long as these
 * tasks' whole budget, so a task without a per-attempt ceiling handed that one
 * provider all of it. A stall then timed out the read while the other providers
 * sat unused, and because the total deadline is task-fatal the stall was never
 * recorded against the provider, so the next driver queued behind it again.
 *
 * The router's own suite proves that a per-attempt ceiling fails over; this one
 * pins that each document-reading task actually sets one.
 */

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({ runAiTask: (...args) => mockRunAiTask(...args) }));

const { extractCdlFields } = require('../../ai/tasks/cdlExtraction');
const { extractMedicalCardFields } = require('../../ai/tasks/medicalCardExtraction');
const { extractReportSuggestions } = require('../../ai/tasks/reportExtraction');
const { extractApplicationDocuments } = require('../../ai/tasks/applicationDocumentExtraction');
const { PROVIDERS } = require('../../ai/registry/providers');
const { PRIVACY } = require('../../ai/tasks/contract');

const PAGE = 'data:image/jpeg;base64,AAAA';

// Enough for one more provider to read a document after an attempt that used
// its whole ceiling.
const FAILOVER_RESERVE_MS = 15000;

const READS = [
    ['a CDL photo', () => extractCdlFields({ imageDataUrl: PAGE })],
    ['a medical card', () => extractMedicalCardFields({ imageDataUrls: [PAGE] })],
    ['a PSP report', () => extractReportSuggestions({ kind: 'psp', imageDataUrls: [PAGE, PAGE] })],
    ['an MVR', () => extractReportSuggestions({ kind: 'mvr', imageDataUrls: [PAGE] })],
    ["a carrier's paperwork", () => extractApplicationDocuments({ documents: { cdl: 'DRIVER LICENSE TX 1234567' } })],
];

async function taskFor(read) {
    mockRunAiTask.mockResolvedValue({ output: {}, providerId: 'gemini', model: 'test/model' });
    await read();
    return mockRunAiTask.mock.calls[0][0];
}

beforeEach(() => {
    mockRunAiTask.mockReset();
});

describe.each(READS)('reading %s', (_label, read) => {
    it('is a restricted task with a total deadline', async () => {
        const task = await taskFor(read);
        expect(task.privacy).toBe(PRIVACY.RESTRICTED);
        expect(Number.isInteger(task.totalDeadlineMs)).toBe(true);
    });

    it('caps each attempt so another provider still has time', async () => {
        const task = await taskFor(read);
        expect(Number.isInteger(task.perAttemptDeadlineMs)).toBe(true);
        expect(task.totalDeadlineMs - task.perAttemptDeadlineMs).toBeGreaterThanOrEqual(FAILOVER_RESERVE_MS);
    });

    it('caps each attempt below the longest provider timeout it could reach', async () => {
        // A ceiling at or above every provider's own timeout would cap nothing.
        const task = await taskFor(read);
        const longest = Math.max(...Object.values(PROVIDERS).map((provider) => provider.timeoutMs));
        expect(task.perAttemptDeadlineMs).toBeLessThan(longest);
    });
});
