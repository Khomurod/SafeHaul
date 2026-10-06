/**
 * The licence reader: the driver's one photo, or the pages of a licence the
 * carrier's reader could not read as text.
 *
 * Pinned: the driver's request is asked exactly as it always was, and every page
 * the carrier's reader sends reaches the model, front and back together.
 */

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({ runAiTask: (...args) => mockRunAiTask(...args) }));

const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { CDL_PROMPT, extractCdlFields } = require('../../ai/tasks/cdlExtraction');

const FRONT = 'data:image/jpeg;base64,AAAA';
const BACK = 'data:image/jpeg;base64,BBBB';

beforeEach(() => {
    mockRunAiTask.mockReset();
    mockRunAiTask.mockResolvedValue({ output: { firstName: ' Dana ' }, providerId: 'gemini', model: 'test/model', latencyMs: 1, fallbackCount: 0 });
});

const askedFor = () => mockRunAiTask.mock.calls[0][0];

it('asks for a driver\'s one photo exactly as before', async () => {
    await extractCdlFields({ imageDataUrl: FRONT });

    expect(askedFor().images).toEqual([{ dataUrl: FRONT }]);
    expect(askedFor().capabilities).not.toContain(CAPABILITIES.MULTI_IMAGE);
    expect(askedFor().inputText).toBe(CDL_PROMPT);
});

it('sends every page of a licence together, saying they are its two sides', async () => {
    const { fields } = await extractCdlFields({ imageDataUrls: [BACK, FRONT] });

    expect(askedFor().images).toEqual([{ dataUrl: BACK }, { dataUrl: FRONT }]);
    expect(askedFor().capabilities).toContain(CAPABILITIES.MULTI_IMAGE);
    expect(askedFor().inputText.startsWith(CDL_PROMPT)).toBe(true);
    expect(askedFor().inputText).toMatch(/front and back/);
    expect(fields.firstName).toBe('Dana');
});

it('reads one page sent as a list as it reads one photo', async () => {
    await extractCdlFields({ imageDataUrls: [FRONT] });

    expect(askedFor().images).toEqual([{ dataUrl: FRONT }]);
    expect(askedFor().inputText).toBe(CDL_PROMPT);
});
