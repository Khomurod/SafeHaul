/**
 * The daily model check's test of one version.
 *
 * Pinned: the fake licence is the one reviewed (its SHA-256), a photo-lane
 * version passes only by reading all six fields right, the request is the one a
 * driver's licence read sends, and every vendor failure lands in the result
 * the decision acts on.
 */

const mockExecute = jest.fn();
jest.mock('../../ai/providers', () => ({ getAdapter: () => ({ execute: (...args) => mockExecute(...args) }) }));

const crypto = require('crypto');
const fs = require('fs');

const { AiError } = require('../../ai/router/errors');
const { requireProvider } = require('../../ai/registry/providers');
const { CDL_PROMPT, CDL_JSON_SCHEMA } = require('../../ai/tasks/cdlExtraction');
const { RESULT, SPECIMEN_PATH, verifyModel, readSpecimenRight } = require('../../ai/tasks/modelVerification');

const RIGHT = Object.freeze({
    firstName: 'DANA MARIE',
    lastName: 'WHITFIELD',
    dateOfBirth: '04/12/1988',
    fullAddress: '1200 SAMPLE RD, AUSTIN, TX 73301',
    cdlNumber: '87654321',
    expirationDate: '04/12/2030',
});

const mistral = requireProvider('mistral');
const check = (lane = 'vision') => verifyModel({
    provider: mistral, lane, model: 'ministral-14b-2512', credentials: { values: { apiKey: 'k' } }, config: {},
});

beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ text: JSON.stringify(RIGHT) });
});

describe('the fake licence', () => {
    it('is the reviewed specimen and nothing else', () => {
        // A real licence in its place would fail here: change this only with a reviewed, made-up image.
        const hash = crypto.createHash('sha256').update(fs.readFileSync(SPECIMEN_PATH)).digest('hex');
        expect(hash).toBe('f1e21dc8e5a627cc93fbc6e618fb6b8882c27cce392317b55b98cd53e7d66865');
    });
});

describe('reading it right', () => {
    it('accepts the fields as printed, or as a model may reformat them', () => {
        expect(readSpecimenRight(RIGHT)).toBe(true);
        expect(readSpecimenRight({
            ...RIGHT, firstName: 'Dana', dateOfBirth: '1988-04-12', expirationDate: '2030-04-12', cdlNumber: '8765 4321',
            fullAddress: '1200 Sample Rd Austin TX 73301',
        })).toBe(true);
    });

    it.each([
        ['first name', { firstName: 'DIANA' }],
        ['last name', { lastName: 'WHITFIELDS' }],
        ['date of birth', { dateOfBirth: '04/21/1988' }],
        ['expiry', { expirationDate: '04/12/2031' }],
        ['licence number', { cdlNumber: '87654320' }],
        ['address', { fullAddress: '12000 SAMPLE RD, DALLAS, TX' }],
        ['a field left empty', { cdlNumber: '' }],
    ])('refuses a wrong %s', (_label, wrong) => {
        expect(readSpecimenRight({ ...RIGHT, ...wrong })).toBe(false);
    });
});

describe('verifyModel', () => {
    it('asks for the licence exactly as a driver\'s read does, with the fake licence', async () => {
        await expect(check()).resolves.toMatchObject({ model: 'ministral-14b-2512', result: RESULT.PASSED, category: null });

        const [request] = mockExecute.mock.calls[0];
        expect(request).toMatchObject({ model: 'ministral-14b-2512', inputText: CDL_PROMPT, schema: CDL_JSON_SCHEMA, temperature: 0 });
        expect(request.images).toHaveLength(1);
        expect(request.images[0].dataUrl).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    });

    it('asks the text lane for a structured answer, with no image', async () => {
        mockExecute.mockResolvedValue({ text: '{"answer":"Blue"}' });

        await expect(check('text')).resolves.toMatchObject({ result: RESULT.PASSED });
        expect(mockExecute.mock.calls[0][0]).toMatchObject({ images: null, capability: 'structured_json' });
    });

    it('calls an answer with a wrong field, or no usable shape, a misread', async () => {
        mockExecute.mockResolvedValue({ text: JSON.stringify({ ...RIGHT, lastName: 'WHITE' }) });
        await expect(check()).resolves.toMatchObject({ result: RESULT.MISREAD, category: 'wrong_answer' });

        mockExecute.mockResolvedValue({ text: 'I cannot read this image.' });
        await expect(check()).resolves.toMatchObject({ result: RESULT.MISREAD, category: 'malformed_response' });
    });

    it.each([
        ['model_unavailable', RESULT.GONE],
        ['provider_request_rejected', RESULT.REFUSED],
        ['rate_limited', RESULT.BUSY],
        ['provider_unavailable', RESULT.BUSY],
        ['timeout', RESULT.BUSY],
        ['network', RESULT.BUSY],
        ['unauthorized', RESULT.KEY],
        ['quota_exceeded', RESULT.QUOTA],
        ['internal', RESULT.ERROR],
    ])('reads a %s failure as %s', async (category, result) => {
        mockExecute.mockRejectedValue(new AiError(category, 'HTTP', { providerId: 'mistral' }));
        await expect(check()).resolves.toMatchObject({ result, category });
    });

    it('reads an adapter that throws something unexpected as an error, not a crash', async () => {
        mockExecute.mockRejectedValue(new TypeError('boom'));
        await expect(check()).resolves.toMatchObject({ result: RESULT.ERROR, category: 'internal' });
    });
});
