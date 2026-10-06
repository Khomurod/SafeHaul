/**
 * The fact-check task's verdict, as the Logs tab reads it.
 *
 * The pipeline refuses a verdict that lists unsupported claims whatever its
 * `supported` flag says (`blogPipeline.sourcing.test.js`). The Logs tab labels
 * the same transaction through `verdictOf`, so the two must agree, or a refused
 * article shows a "supported" fact-check.
 */

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({ runAiTask: (...args) => mockRunAiTask(...args) }));

const { verifyArticleClaims } = require('../../ai/tasks/articleGeneration');

beforeEach(() => {
    mockRunAiTask.mockReset();
    mockRunAiTask.mockResolvedValue({ output: { supported: true, unsupportedClaims: [] }, transactionId: 'txn-1' });
});

it('labels a verdict that lists unsupported claims "unsupported", whatever its flag says', async () => {
    await verifyArticleClaims({ articleText: 'Draft.', sources: [], knowledge: null });
    const { verdictOf } = mockRunAiTask.mock.calls[0][0];

    expect(verdictOf({ supported: true, unsupportedClaims: ['The rule takes effect in 2027.'] })).toBe('unsupported');
    expect(verdictOf({ supported: false, unsupportedClaims: [] })).toBe('unsupported');
    expect(verdictOf({ supported: true, unsupportedClaims: [] })).toBe('supported');
});
