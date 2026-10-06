/**
 * PSP report and MVR extraction — the task definition and the normalisers.
 *
 * Nothing here reaches a vendor: `runAiTask` is a mock that records the task it
 * was handed and answers with whatever raw JSON a test wants normalised. What the
 * suite pins is the contract the applicant-facing import depends on:
 *
 * - the task is `restricted`, vision + structured JSON, multi-image only when
 *   more than one page is sent, and bounded by a deadline shorter than the
 *   callable's own timeout;
 * - a PSP report yields carrier SIGHTINGS (first/last month seen), never
 *   employment dates — the wizard must not be handed something it could mistake
 *   for a start date;
 * - unreadable values come back blank, never invented, and everything is
 *   bounded in length and count.
 */

const mockRunAiTask = jest.fn();
jest.mock('../../ai/router/router', () => ({
    runAiTask: (...args) => mockRunAiTask(...args),
}));

const {
    KINDS,
    MAX_ITEMS,
    REPORT_TOTAL_DEADLINE_MS,
    extractReportSuggestions,
    looseDateToIso,
    normalizeMvrOutput,
    normalizePspOutput,
} = require('../../ai/tasks/reportExtraction');
const { CAPABILITIES } = require('../../ai/registry/capabilities');
const { PRIVACY, TASK_TYPES } = require('../../ai/tasks/contract');

const PAGE = 'data:image/jpeg;base64,AAAA';

describe('looseDateToIso', () => {
    it.each([
        ['2024-03-05', '2024-03-05'],
        ['2024-3-5', '2024-03-05'],
        ['03/05/2024', '2024-03-05'],
        ['3/5/24', '2024-03-05'],
        ['03-05-2024', '2024-03-05'],
        ['03/2024', '2024-03'],
        ['2024-03', '2024-03'],
        ['March 5, 2024', '2024-03-05'],
    ])('reads %s as %s', (raw, expected) => {
        expect(looseDateToIso(raw)).toBe(expected);
    });

    it('reads a two-digit year in the nearer century, so a birth year is not in the future', () => {
        // "03/11/88" used to become 2088, and a driver read from their own
        // licence was told they were too young to apply.
        const soon = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');
        const later = String((new Date().getFullYear() + 20) % 100).padStart(2, '0');
        expect(looseDateToIso('03/11/88')).toBe('1988-03-11');
        expect(looseDateToIso(`06/30/${soon}`)).toBe(`${new Date().getFullYear() + 3}-06-30`);
        expect(looseDateToIso(`06/30/${later}`)).toBe(`${new Date().getFullYear() + 20 - 100}-06-30`);
    });

    it('offers a month or day that cannot exist blank rather than inventing a date', () => {
        expect(looseDateToIso('13/45/2024')).toBe('');
        expect(looseDateToIso('00/10/2024')).toBe('');
        // A day the month does not have, in either shape a model may answer in.
        expect(looseDateToIso('02/31/2024')).toBe('');
        expect(looseDateToIso('04/31/2024')).toBe('');
        expect(looseDateToIso('02/29/2023')).toBe('');
        expect(looseDateToIso('2024-02-30')).toBe('');
        expect(looseDateToIso('13/2024')).toBe('');
        expect(looseDateToIso('2024-13')).toBe('');
        // Leap years still have their 29th.
        expect(looseDateToIso('02/29/2024')).toBe('2024-02-29');
        expect(looseDateToIso('2024-02-29')).toBe('2024-02-29');
    });

    it.each([['', ''], ['unknown', ''], ['N/A', ''], [null, ''], [42, ''], ['12/31', '']])(
        'offers %p blank rather than guessing',
        (raw, expected) => {
            expect(looseDateToIso(raw)).toBe(expected);
        },
    );
});

describe('normalizePspOutput', () => {
    it('turns carrier records into sightings, not employment dates', () => {
        const out = normalizePspOutput({
            carriers: [{
                carrierName: '  Acme Trucking ',
                usdotNumber: 'USDOT 123456',
                earliestDate: '03/12/2024',
                latestDate: '2025-01-30',
                recordType: 'Inspection',
            }],
            violations: [],
        });
        expect(out.carriers).toEqual([{
            name: 'Acme Trucking',
            dotNumber: '123456',
            firstSeen: '2024-03',
            lastSeen: '2025-01',
            recordType: 'inspection',
        }]);
        // A month, deliberately: the report proves the driver was inspected in
        // that month, not that they started or stopped working then.
        expect(out.carriers[0].firstSeen).toHaveLength(7);
    });

    it.each([
        // Seven digits is the ordinary length now. The value used to be cut to twelve
        // characters BEFORE the digits were taken, so these became 123456 and 3 —
        // and the wrong number became the identity a carrier locked (2026-10-01).
        ['USDOT 1234567', '1234567'],
        ['US DOT No. 3456789', '3456789'],
        ['USDOT# 1234567', '1234567'],
        ['1234567', '1234567'],
        ['MC 765432 USDOT 1234567', '1234567'],
        ['n/a', ''],
    ])('reads the USDOT number out of %p as %p', (printed, expected) => {
        const out = normalizePspOutput({ carriers: [{ carrierName: 'X', usdotNumber: printed }] });
        expect(out.carriers[0].dotNumber).toBe(expected);
    });

    it.each([
        ['crash', 'crash'],
        ['Crash and inspection', 'both'],
        ['roadside', 'unknown'],
        [undefined, 'unknown'],
    ])('classifies record type %p as %s', (recordType, expected) => {
        const out = normalizePspOutput({ carriers: [{ carrierName: 'X', recordType }] });
        expect(out.carriers[0].recordType).toBe(expected);
    });

    it('drops carriers with neither a name nor a number and caps the list', () => {
        const carriers = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ carrierName: `Carrier ${i}` }));
        carriers.unshift({ carrierName: '', usdotNumber: 'n/a' });
        const out = normalizePspOutput({ carriers });
        expect(out.carriers).toHaveLength(MAX_ITEMS);
        expect(out.carriers[0].name).toBe('Carrier 0');
    });

    it('offers no violations: a PSP report lists inspection findings, not convictions', () => {
        // The application asks for convictions (49 CFR 391.21(b)(8)). Offering a
        // roadside inspection's findings, a lamp out included, as moving
        // violations invited a driver to declare what the question does not ask.
        const out = normalizePspOutput({
            violations: [{ date: '07/04/2023', description: 'Speeding 15 over', location: 'Dallas, TX' }],
        });
        expect(out.violations).toEqual([]);
        expect(KINDS.psp.schema.properties).not.toHaveProperty('violations');
        expect(KINDS.psp.prompt).not.toMatch(/violation/i);
        // "Return an empty array" invites a bare [], which the object schema refuses.
        expect(KINDS.psp.prompt).toContain('return {"carriers": []}');
    });

    it('still reads violations from a motor vehicle record, which lists convictions', () => {
        const out = normalizeMvrOutput({
            violations: [
                { date: '07/04/2023', description: 'Speeding 15 over', location: 'Dallas, TX' },
                { date: 'unknown', description: 'Failure to yield', location: '' },
                { date: '2023-01-01', description: '', location: 'Somewhere' },
            ],
        });
        expect(out.violations).toEqual([
            { date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX' },
            { date: '', charge: 'Failure to yield', location: '' },
        ]);
    });

    it('survives an output that is not the shape it asked for', () => {
        expect(normalizePspOutput(null)).toEqual({ carriers: [], violations: [] });
        expect(normalizePspOutput({ carriers: 'nope', violations: { a: 1 } })).toEqual({ carriers: [], violations: [] });
    });
});

describe('normalizeMvrOutput', () => {
    it('normalises licence details to the wizard field shapes', () => {
        const out = normalizeMvrOutput({
            licenseNumber: ' TX1234567 ',
            state: 'tx',
            licenseClass: 'Class A',
            expirationDate: '12/31/2030',
            endorsements: ['h', 'N', 'N', 'hazmat', ''],
            violations: [{ date: '2024-05-01', description: 'Failure to yield', location: 'Austin, TX' }],
        });
        expect(out.license).toEqual({
            cdlNumber: 'TX1234567',
            cdlState: 'TX',
            cdlClass: 'Class A',
            cdlExpiration: '2030-12-31',
            endorsements: ['H', 'N'],
        });
        expect(out.violations).toEqual([{ date: '2024-05-01', charge: 'Failure to yield', location: 'Austin, TX' }]);
    });

    it('blanks a state that is not a two-letter code', () => {
        expect(normalizeMvrOutput({ state: 'Texas' }).license.cdlState).toBe('');
        expect(normalizeMvrOutput({ state: 'T' }).license.cdlState).toBe('');
    });

    it('never invents a value for a missing field', () => {
        expect(normalizeMvrOutput({}).license).toEqual({
            cdlNumber: '', cdlState: '', cdlClass: '', cdlExpiration: '', endorsements: [],
        });
    });
});

describe('extractReportSuggestions', () => {
    beforeEach(() => {
        mockRunAiTask.mockReset();
        mockRunAiTask.mockResolvedValue({
            output: { carriers: [], violations: [] },
            providerId: 'groq',
            model: 'test-model',
            latencyMs: 10,
            fallbackCount: 0,
        });
    });

    it('refuses an unknown kind before touching the router', async () => {
        await expect(extractReportSuggestions({ kind: 'resume', imageDataUrls: [PAGE] })).rejects.toThrow(/Unknown report kind/);
        expect(mockRunAiTask).not.toHaveBeenCalled();
    });

    it('defines a restricted vision task per kind, with the pages in order', async () => {
        await extractReportSuggestions({ kind: 'psp', imageDataUrls: [PAGE, PAGE + 'B'] });
        const [task] = mockRunAiTask.mock.calls[0];
        expect(task.taskType).toBe(TASK_TYPES.PSP_REPORT_EXTRACTION);
        expect(task.privacy).toBe(PRIVACY.RESTRICTED);
        expect(task.capabilities).toEqual(expect.arrayContaining([
            CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.MULTI_IMAGE,
        ]));
        expect(task.images.map((image) => image.dataUrl)).toEqual([PAGE, PAGE + 'B']);
        expect(task.outputSchema).toBe(KINDS.psp.schema);
        expect(task.totalDeadlineMs).toBe(REPORT_TOTAL_DEADLINE_MS);
    });

    it('does not demand multi-image support for a single page', async () => {
        await extractReportSuggestions({ kind: 'mvr', imageDataUrls: [PAGE] });
        const [task] = mockRunAiTask.mock.calls[0];
        expect(task.taskType).toBe(TASK_TYPES.MVR_EXTRACTION);
        expect(task.capabilities).not.toContain(CAPABILITIES.MULTI_IMAGE);
    });

    it('names no vendor in either prompt', () => {
        for (const spec of Object.values(KINDS)) {
            expect(spec.prompt).not.toMatch(/groq|openai|mistral|gemini|anthropic|llama/i);
        }
    });

    it('leaves the router less time than the callable has to live', () => {
        // `extractApplicationReport` runs with `timeoutSeconds: 60`; a router
        // deadline at or past it would let the function die before the router
        // could give up and report why.
        expect(REPORT_TOTAL_DEADLINE_MS).toBeLessThan(60 * 1000);
    });

    it('returns normalised suggestions and reports who answered', async () => {
        mockRunAiTask.mockResolvedValue({
            output: { licenseNumber: 'A1', state: 'CA', licenseClass: 'Class B', expirationDate: '2029-01-02', endorsements: [], violations: [] },
            providerId: 'mistral',
            model: 'pixtral',
            latencyMs: 400,
            fallbackCount: 1,
        });
        const result = await extractReportSuggestions({ kind: 'mvr', imageDataUrls: [PAGE] });
        expect(result).toEqual({
            kind: 'mvr',
            suggestions: {
                license: { cdlNumber: 'A1', cdlState: 'CA', cdlClass: 'Class B', cdlExpiration: '2029-01-02', endorsements: [] },
                violations: [],
            },
            providerId: 'mistral',
            model: 'pixtral',
            latencyMs: 400,
            fallbackCount: 1,
        });
    });

    it('passes the injected dependencies through to the router', async () => {
        const deps = { now: () => 1 };
        await extractReportSuggestions({ kind: 'psp', imageDataUrls: [PAGE] }, deps);
        expect(mockRunAiTask.mock.calls[0][1]).toBe(deps);
    });
});
