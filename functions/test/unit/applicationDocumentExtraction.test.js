/**
 * Reading a driver's paperwork as text, in one request.
 *
 * The router is a mock throughout: which vendor answers is the router's own
 * suite's business. What is pinned here is the contract the carrier-side screen
 * depends on — any subset of documents, one shape for both routes, and the
 * per-document `unreadable` flag that decides when to fall back to vision.
 */

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({ runAiTask: (...args) => mockRunAiTask(...args) }));

const {
    DOCUMENT_KINDS,
    DOCUMENT_PROMPT,
    MAX_TOTAL_CHARS,
    buildDocumentText,
    shareDocumentText,
    extractApplicationDocuments,
    normalizeDocumentOutput,
    normalizeUnreadable,
} = require('../../ai/tasks/applicationDocumentExtraction');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { PRIVACY, TASK_TYPES } = require('../../ai/tasks/contract');

const FULL_OUTPUT = {
    driver: { firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '03/11/1988', fullAddress: '1 Main St, Dallas, TX 75001' },
    license: {
        licenseNumber: 'TX1234567', state: 'tx', licenseClass: 'Class A',
        expirationDate: '12/31/2030', endorsements: ['h', 'N', 'hazmat'], medicalCardExpiration: '06/30/2027',
    },
    carriers: [{ carrierName: 'Acme Trucking', usdotNumber: 'USDOT 123456', earliestDate: '03/12/2024', latestDate: '2025-01-30', recordType: 'Inspection' }],
    violations: [
        { date: '07/04/2023', description: 'Speeding 15 over', location: 'Dallas, TX', source: 'psp' },
        { date: '2024-05-01', description: 'Failure to yield', location: 'Austin, TX', source: 'MVR' },
    ],
    unreadable: [],
};

beforeEach(() => {
    mockRunAiTask.mockReset();
    mockRunAiTask.mockResolvedValue({
        output: FULL_OUTPUT, providerId: 'gemini', model: 'test-model', latencyMs: 12, fallbackCount: 0,
    });
});

describe('the document it builds', () => {
    it('labels each document it was given, and only those', () => {
        const built = buildDocumentText({ psp: 'PSP body', mvr: 'MVR body' });

        expect(built).toContain('=== FMCSA PSP REPORT ===');
        expect(built).toContain('=== MOTOR VEHICLE RECORD ===');
        expect(built).not.toContain("DRIVER'S LICENSE");
    });

    it('accepts a single document as readily as four', () => {
        expect(buildDocumentText({ cdl: 'Licence text' })).toContain("=== DRIVER'S LICENSE ===");
        expect(buildDocumentText({})).toBe('');
    });

    // Each section's own body, measured between its heading and the next.
    const bodiesOf = (text) => text.split('\n\n').map((section) => section.split('\n').slice(1).join('\n'));

    it('holds the total however the documents are sent, a ceiling the caller cannot raise', () => {
        // The browser truncates too, but a browser's ceiling is one a browser can lift.
        const long = 'x'.repeat(MAX_TOTAL_CHARS);
        const { text, truncated } = shareDocumentText({ cdl: long, medical: long, psp: long, mvr: long });

        expect(bodiesOf(text).map((body) => body.length)).toEqual([4000, 4000, 4000, 4000]);
        expect(bodiesOf(text).join('').length).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
        expect(truncated).toEqual(['cdl', 'medical', 'psp', 'mvr']);
    });

    it('lets a long report use what the other documents leave, instead of a fixed share', () => {
        // A five-page PSP report used to be cut at 5,000 characters even when it was
        // the only document, its later records lost with most of the budget unused.
        const long = 'x'.repeat(MAX_TOTAL_CHARS * 2);

        const alone = shareDocumentText({ psp: long });
        expect(bodiesOf(alone.text)[0]).toHaveLength(MAX_TOTAL_CHARS);
        expect(alone.truncated).toEqual(['psp']);

        const beside = shareDocumentText({ cdl: 'DL TX 1234567', psp: long });
        const [licence, report] = bodiesOf(beside.text);
        expect(licence).toBe('DL TX 1234567');
        expect(report).toHaveLength(MAX_TOTAL_CHARS - 'DL TX 1234567'.length);
        expect(beside.truncated).toEqual(['psp']);
    });

    it('cuts nothing that fits, and keeps the documents in their usual order', () => {
        const { text, truncated } = shareDocumentText({ mvr: 'MVR body', cdl: 'Licence text' });
        expect(truncated).toEqual([]);
        expect(text.indexOf("DRIVER'S LICENSE")).toBeLessThan(text.indexOf('MOTOR VEHICLE RECORD'));
        expect(buildDocumentText({ mvr: 'MVR body', cdl: 'Licence text' })).toBe(text);
    });
});

describe('the task it defines', () => {
    it('asks for the text lane with long context, and never for vision', async () => {
        await extractApplicationDocuments({ documents: { psp: 'body' } });
        const [task] = mockRunAiTask.mock.calls[0];

        expect(task.taskType).toBe(TASK_TYPES.APPLICATION_DOCUMENT_EXTRACTION);
        expect(task.capabilities).toEqual(expect.arrayContaining([
            CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT,
        ]));
        expect(task.capabilities).not.toContain(CAPABILITIES.VISION);
        expect(task.privacy).toBe(PRIVACY.RESTRICTED);
        expect(task.images).toBeNull();
    });

    it('leaves the router less time than the callable has to live', async () => {
        await extractApplicationDocuments({ documents: { psp: 'body' } });
        expect(mockRunAiTask.mock.calls[0][0].totalDeadlineMs).toBeLessThan(120 * 1000);
    });

    it('refuses an empty request rather than spending a vendor call on nothing', async () => {
        await expect(extractApplicationDocuments({ documents: {} })).rejects.toThrow(/No document text/);
        expect(mockRunAiTask).not.toHaveBeenCalled();
    });

    it('names no vendor in the prompt', async () => {
        await extractApplicationDocuments({ documents: { psp: 'body' } });
        expect(mockRunAiTask.mock.calls[0][0].inputText).not.toMatch(/groq|openai|gemini|mistral|anthropic|llama/i);
    });
});

describe('what it returns', () => {
    it('says which documents were too long to read in full', async () => {
        const long = 'x'.repeat(MAX_TOTAL_CHARS * 2);
        const { truncated } = await extractApplicationDocuments({ documents: { cdl: 'a', psp: long } });
        expect(truncated).toEqual(['psp']);
    });

    it('maps everything onto the fields the application actually holds', async () => {
        const { extracted } = await extractApplicationDocuments({ documents: { cdl: 'a', psp: 'b', mvr: 'c' } });

        expect(extracted.driver).toEqual({
            firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '1988-03-11', fullAddress: '1 Main St, Dallas, TX 75001',
        });
        expect(extracted.license).toEqual({
            cdlNumber: 'TX1234567', cdlState: 'TX', cdlClass: 'Class A',
            cdlExpiration: '2030-12-31', endorsements: ['H', 'N'], medCardExpiration: '2027-06-30',
        });
    });

    it('produces PSP carriers as sightings, exactly as the vision route does', async () => {
        const { extracted } = await extractApplicationDocuments({ documents: { psp: 'b' } });

        expect(extracted.carriers).toEqual([{
            name: 'Acme Trucking', dotNumber: '123456', firstSeen: '2024-03', lastSeen: '2025-01', recordType: 'inspection',
        }]);
    });

    it('fills violations from the motor vehicle record only, never from a PSP report', async () => {
        // The application asks for convictions (49 CFR 391.21(b)(8)). A PSP
        // report's violations are roadside inspection findings, and filled in as
        // moving violations they became something the driver declared.
        const { extracted } = await extractApplicationDocuments({ documents: { psp: 'b', mvr: 'c' } });

        expect(extracted.violations).toEqual([
            { date: '2024-05-01', charge: 'Failure to yield', location: 'Austin, TX', source: 'mvr' },
        ]);
        expect(DOCUMENT_PROMPT).toMatch(/conviction in the motor vehicle record/);
    });

    it('fills no violations when no motor vehicle record was sent, whatever the model listed', async () => {
        const { extracted } = await extractApplicationDocuments({ documents: { cdl: 'a', psp: 'b' } });
        expect(extracted.violations).toEqual([]);
    });

    it('keeps the record\'s convictions in order when a blank row comes first', () => {
        const normalized = normalizeDocumentOutput({
            violations: [
                { date: '', description: '', location: '', source: 'mvr' },
                { date: '07/04/2023', description: 'Speeding 15 over', location: 'Dallas, TX', source: 'psp' },
                { date: '2024-05-01', description: 'Failure to yield', location: 'Austin, TX', source: 'mvr' },
            ],
        });
        expect(normalized.violations).toEqual([
            { date: '2024-05-01', charge: 'Failure to yield', location: 'Austin, TX', source: 'mvr' },
        ]);
    });

    it('reports which documents it could not read, by their own key', async () => {
        mockRunAiTask.mockResolvedValue({
            output: { ...FULL_OUTPUT, unreadable: ['MEDICAL EXAMINER CERTIFICATE'] },
            providerId: 'gemini', model: 'm', latencyMs: 1, fallbackCount: 0,
        });

        const { extracted } = await extractApplicationDocuments({ documents: { medical: 'garbled' } });
        expect(extracted.unreadable).toEqual(['medical']);
    });

    it('survives an answer that is not the shape it asked for', async () => {
        mockRunAiTask.mockResolvedValue({ output: null, providerId: 'g', model: 'm', latencyMs: 1, fallbackCount: 0 });

        const { extracted } = await extractApplicationDocuments({ documents: { psp: 'b' } });
        expect(extracted.carriers).toEqual([]);
        expect(extracted.violations).toEqual([]);
        expect(extracted.license.cdlNumber).toBe('');
    });

    it.each([
        ['a state that is not a code', { state: 'Texas' }, 'cdlState', ''],
        ['a date it cannot read', { expirationDate: 'sometime' }, 'cdlExpiration', ''],
    ])('never invents %s', (_label, licenseOverride, field, expected) => {
        const normalized = normalizeDocumentOutput({ license: { ...FULL_OUTPUT.license, ...licenseOverride } });
        expect(normalized.license[field]).toBe(expected);
    });

    it('knows every document kind it can be handed', () => {
        expect(DOCUMENT_KINDS).toEqual(['cdl', 'medical', 'psp', 'mvr']);
        expect(normalizeUnreadable(['cdl'])).toEqual(['cdl']);
        expect(normalizeUnreadable(null)).toEqual([]);
    });
});
