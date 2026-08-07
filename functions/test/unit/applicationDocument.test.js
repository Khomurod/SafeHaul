// The professional application PDF, rendered from the preserved record.
//
// Every assertion here corresponds to something the old browser-side generator
// actually did wrong. The test reads the rendered PDF's own text back out — not
// an intermediate model — because "the generator was called correctly" is not
// the same claim as "the document says the right thing".

const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const { buildApplicationDefinition } = require('../../shared/applicationDefinition');
const { buildSubmissionSnapshot } = require('../../shared/submissionSnapshot');
const {
    maskSsn,
    renderApplicationPdf,
    singularize,
} = require('../../shared/pdf/applicationDocument');
const { sanitizeForStandardFont, wrapText } = require('../../shared/pdf/documentBuilder');

const QUESTION_ID = '9f2c1a44-77bd-4e21-9f0e-1c2b3d4e5f60';
const DELETED_QUESTION_ID = 'b71e0d55-2a3f-4c88-bb90-0e1f2a3b4c5d';
const SUBMITTED_AT = '2026-07-14T15:22:41.000Z';

const company = (over = {}) => ({
    companyName: 'Northwind Freight Systems',
    dba: 'Northwind Carriers',
    dotNumber: '3312998',
    mcNumber: '998211',
    address: { street: '4400 Industrial Parkway', city: 'Fort Worth', state: 'TX', zip: '76106' },
    contact: { email: 'recruiting@northwind.test', phone: '(817) 555-0142' },
    customQuestions: [
        { id: QUESTION_ID, label: 'Are you willing to run a dedicated lane out of Laredo?', type: 'multipleChoice', options: ['Yes', 'No'] },
    ],
    ...over,
});

const formData = (over = {}) => ({
    firstName: 'Marcus', lastName: 'Delgado',
    ssn: '412-88-7391', dob: '1986-04-17',
    email: 'marcus@example.test', phone: '(214) 555-0188',
    street: '812 Cottonwood Lane', city: 'Arlington', state: 'TX', zip: '76010',
    accidents: [{ date: '2023-02-11', city: 'Oklahoma City', state: 'OK', commercial: 'yes', preventable: 'no', details: 'Rear-ended while stopped.' }],
    employers: [{
        companyName: 'Lone Star Logistics', position: 'OTR Driver',
        startDate: '2023-09', endDate: '2026-06', mayContact: 'yes',
        // An internal key that has no column: it must not reach the page.
        _localDraftId: 'draft-7712-internal',
    }],
    customAnswers: { [QUESTION_ID]: 'Yes' },
    ...over,
});

/**
 * All text in the rendered PDF, page order preserved.
 *
 * Read back out of the finished document rather than from an intermediate model:
 * "the renderer was called with the right arguments" and "the page says the
 * right thing" are different claims, and only the second one matters here.
 */
async function extractText(bytes) {
    const doc = await PDFDocument.load(bytes);
    const chunks = [];

    for (const page of doc.getPages()) {
        const contents = doc.context.lookup(page.node.Contents());
        const refs = contents?.asArray ? contents.asArray() : [page.node.Contents()];
        for (const ref of refs.filter(Boolean)) {
            const stream = doc.context.lookup(ref);
            if (!stream?.getContents) continue;
            let buffer = Buffer.from(stream.getContents());
            try {
                buffer = zlib.inflateSync(buffer);
            } catch {
                // Already uncompressed, which is pdf-lib's default.
            }
            chunks.push(buffer.toString('latin1'));
        }
    }

    // Collect ONLY the show-text operands, so an assertion can never accidentally
    // match a font resource name or a colour operand. pdf-lib writes them as hex
    // strings (`<48454C...> Tj`); literal strings are handled for completeness.
    const stream = chunks.join('\n');
    const drawn = [];
    for (const [, hex] of stream.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj/g)) {
        drawn.push(Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1'));
    }
    for (const [, literal] of stream.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
        drawn.push(literal.replace(/\\([()\\])/g, '$1'));
    }
    return drawn.join('\n');
}

async function render(overrides = {}, { companyOver = {}, formOver = {}, acceptanceOver = null } = {}) {
    const definition = buildApplicationDefinition({ company: company(companyOver) });
    const acceptances = acceptanceOver || Object.fromEntries(
        definition.agreements.map((a) => [a.id, {
            accepted: true, acceptedAt: SUBMITTED_AT, ip: '203.0.113.42', userAgent: 'TestAgent/1.0',
        }]),
    );
    const snapshot = buildSubmissionSnapshot({
        definition,
        formData: formData(formOver),
        acceptances,
        signature: { image: 'data:image/png;base64,AAAA', type: 'drawn', capturedAt: SUBMITTED_AT },
        submittedAt: SUBMITTED_AT,
    });
    const result = await renderApplicationPdf({ snapshot, generatedAt: SUBMITTED_AT, ...overrides });
    return { ...result, snapshot, text: await extractText(result.bytes) };
}

describe('application PDF — what it must never print', () => {
    it('prints no identifier of any kind', async () => {
        const { text } = await render();
        expect(text).not.toMatch(QUESTION_ID);
        // No UUID-shaped token anywhere.
        expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(text).not.toMatch(/draft-7712-internal/);
    });

    it('prints no [object Object] for any repeating group', async () => {
        const { text } = await render();
        expect(text).not.toMatch(/\[object Object\]/);
    });

    it('invents no accident figures — fatalities and injuries were never collected', async () => {
        const { text } = await render();
        expect(text).toMatch(/Rear-ended while stopped/);
        expect(text).not.toMatch(/Fatalit/i);
        expect(text).not.toMatch(/Injur/i);
    });

    it('prints no storage path or signed URL for an uploaded file', async () => {
        const { text } = await render({}, {
            formOver: {
                'cdl-front': 'companies/c1/applications/a1/guest_uploads/9ab12-cdl-front.jpg?token=SECRET-TOKEN',
            },
        });
        expect(text).toMatch(/9ab12-cdl-front\.jpg/);
        expect(text).not.toMatch(/guest_uploads/);
        expect(text).not.toMatch(/SECRET-TOKEN/);
    });

    it('does not print a question the company hid', async () => {
        const { text } = await render({}, {
            companyOver: { applicationConfig: { referralSource: { hidden: true } } },
        });
        expect(text).not.toMatch(/Referral Source/);
    });

    it('does not claim a conditional question was asked when its condition was unmet', async () => {
        const { text } = await render();
        // `has-felony` is 'no' (unset), so the explanation was never shown.
        expect(text).not.toMatch(/Felony Explanation/);
    });
});

describe('application PDF — the SSN policy', () => {
    it('masks the SSN by default', async () => {
        const { text } = await render();
        expect(text).toMatch(/\*\*\*-\*\*-7391/);
        expect(text).not.toMatch(/412-88-7391/);
        expect(text).toMatch(/Masked to last four digits/);
    });

    it('shows the full SSN only when the authorized original asks for it', async () => {
        const { text } = await render({ includeFullSsn: true });
        expect(text).toMatch(/412-88-7391/);
        expect(text).toMatch(/Shown in full \(authorized original\)/);
    });

    it('masks a bare 9-digit SSN with no separators', () => {
        expect(maskSsn('412887391')).toBe('***-**-7391');
        expect(maskSsn('')).toBeNull();
        expect(maskSsn(null)).toBeNull();
    });
});

describe('application PDF — agreements and signatures', () => {
    it('prints all four agreements with their frozen wording', async () => {
        const { text } = await render();
        expect(text).toMatch(/AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY/);
        expect(text).toMatch(/BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION/);
        // That heading wraps mid-phrase, so this matches the body's own text.
        expect(text).toMatch(/Pre-Employment Screening Program \(PSP\)/);
        expect(text).toMatch(/Clearinghouse/);
        expect(text).toMatch(/AGREEMENT 4 OF 4/);
    });

    it('keeps the paragraph structure of the legal text', async () => {
        const { text } = await render();
        // Section numbering survives; it did not when newlines were folded away.
        expect(text).toMatch(/1\. DEFINITIONS\./);
        expect(text).toMatch(/4\. WITHDRAWAL\./);
    });

    it('attaches NO signature to an agreement the applicant did not accept', async () => {
        const definition = buildApplicationDefinition({ company: company() });
        const acceptances = Object.fromEntries(definition.agreements.map((a) => [a.id, {
            accepted: a.id !== 'pspDisclosure', acceptedAt: SUBMITTED_AT, ip: '203.0.113.42',
        }]));
        const { text } = await render({}, { acceptanceOver: acceptances });

        expect(text).toMatch(/The applicant did NOT accept this agreement\. No signature is attached to it\./);
        // Three accepted agreements, so exactly three signature blocks.
        expect(text.match(/ACCEPTED AND SIGNED/g)).toHaveLength(3);
    });

    it('says so plainly when no acceptance was recorded at all', async () => {
        const { text } = await render({}, { acceptanceOver: {} });
        expect(text).toMatch(/No acceptance was recorded for this agreement/);
        expect(text).not.toMatch(/ACCEPTED AND SIGNED/);
    });

    it('records each agreement\'s own acceptance evidence', async () => {
        const { text } = await render();
        expect(text).toMatch(/Origin IP: 203\.0\.113\.42/);
        expect(text).toMatch(/Accepted: July 14, 2026 at 15:22 UTC/);
    });
});

describe('application PDF — custom questions', () => {
    it('prints the human wording, never the question id', async () => {
        const { text } = await render();
        expect(text).toMatch(/Are you willing to run a dedicated lane out of Laredo\?/);
        expect(text).toMatch(/SUPPLEMENTAL QUESTIONS/);
    });

    it('says the wording was not recorded rather than printing the id', async () => {
        const { text } = await render({}, {
            companyOver: { customQuestions: [{ id: QUESTION_ID, type: 'shortAnswer' }] },
        });
        expect(text).toMatch(/Question wording was not recorded/);
        expect(text).not.toMatch(QUESTION_ID);
    });

    it('keeps an answer whose question was deleted, and marks it', async () => {
        const { text } = await render({}, {
            formOver: {
                customAnswers: { [QUESTION_ID]: 'Yes', [DELETED_QUESTION_ID]: 'An orphaned answer' },
            },
        });
        expect(text).toMatch(/An orphaned answer/);
        expect(text).toMatch(/no longer matches a question/);
        expect(text).not.toMatch(DELETED_QUESTION_ID);
    });
});

describe('application PDF — the document itself', () => {
    it('carries the company identity and the regulation it is filed under', async () => {
        const { text } = await render();
        expect(text).toMatch(/Northwind Freight Systems/);
        expect(text).toMatch(/d\/b\/a Northwind Carriers/);
        expect(text).toMatch(/USDOT 3312998/);
        expect(text).toMatch(/49 CFR Part 391, Subpart C/);
    });

    it('numbers every page and names the applicant in the footer', async () => {
        const { text, pageCount } = await render();
        expect(pageCount).toBeGreaterThan(4);
        expect(text).toMatch(new RegExp(`Page ${pageCount} of ${pageCount}`));
        expect(text).toMatch(/Marcus Delgado/);
    });

    it('describes itself as the original, and a resubmission as a resubmission', async () => {
        const original = await render({ sequence: 1 });
        expect(original.text).toMatch(/Original submission/);

        const resubmission = await render({ sequence: 2 });
        expect(resubmission.text).toMatch(/Resubmission #2/);
        expect(resubmission.text).toMatch(/The original submission is preserved/);
    });

    it('states three-year coverage honestly, with agreeing grammar', async () => {
        const { text } = await render();
        expect(text).toMatch(/EMPLOYMENT HISTORY COVERAGE/);
        expect(text).toMatch(/months of history required by 49 CFR 391\.21\(b\)\(10\)/);
        expect(text).not.toMatch(/1 months are/);
    });

    it('marks a reconstructed record as reconstructed', async () => {
        const definition = buildApplicationDefinition({ company: company() });
        const snapshot = buildSubmissionSnapshot({
            definition,
            formData: formData(),
            submittedAt: SUBMITTED_AT,
            provenance: { source: 'reconstructed', notes: ['Agreement acceptance was not captured at the time.'] },
        });
        const { bytes } = await renderApplicationPdf({ snapshot, generatedAt: SUBMITTED_AT });
        const text = await extractText(bytes);

        expect(text).toMatch(/RECONSTRUCTED RECORD/);
        expect(text).toMatch(/Agreement acceptance was not captured at the time\./);
        expect(text).toMatch(/Record type/i);
    });

    it('refuses to render without a preserved snapshot rather than inventing one', async () => {
        await expect(renderApplicationPdf({})).rejects.toThrow(/requires a preserved submission snapshot/);
        await expect(renderApplicationPdf({ snapshot: { frozen: true } })).rejects.toThrow();
    });

    it('produces byte-identical output for identical input', async () => {
        // The preserved original is stored once, but a rebuild for a historical
        // record must reproduce the same document rather than a similar one.
        const definition = buildApplicationDefinition({ company: company() });
        const snapshot = buildSubmissionSnapshot({
            definition, formData: formData(), submittedAt: SUBMITTED_AT,
        });
        const opts = { snapshot, generatedAt: SUBMITTED_AT, includeFullSsn: true };
        const a = await renderApplicationPdf(opts);
        const b = await renderApplicationPdf(opts);
        expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    });
});

describe('layout primitives', () => {
    it('keeps newlines, which the legal text depends on', () => {
        expect(sanitizeForStandardFont('a\nb')).toBe('a\nb');
    });

    it('folds typography the standard fonts cannot encode', () => {
        expect(sanitizeForStandardFont('‘x’ “y” …')).toBe("'x' \"y\" ...");
        // Latin-1 accents survive; a non-Latin script degrades rather than throwing.
        expect(sanitizeForStandardFont('Café')).toBe('Café');
        expect(sanitizeForStandardFont('Привет')).toBe('??????');
    });

    it('strips control characters that would corrupt the content stream', () => {
        expect(sanitizeForStandardFont('a bc')).toBe('abc');
    });

    it('breaks a single oversized token instead of running off the margin', () => {
        const font = { widthOfTextAtSize: (text, size) => text.length * size * 0.5 };
        const lines = wrapText('x'.repeat(100), { font, size: 10, maxWidth: 50 });
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
    });

    it('singularizes group labels for record numbering', () => {
        expect(singularize('Previous Addresses')).toBe('Previous Address');
        expect(singularize('Additional Licences')).toBe('Additional Licence');
        expect(singularize('Previous Employers')).toBe('Previous Employer');
        expect(singularize('Employment Gaps')).toBe('Employment Gap');
        expect(singularize('Military Service')).toBe('Military Service');
    });
});

describe('a record written before columns existed', () => {
    /** The snapshot shape from between the first snapshot release and columns. */
    const withoutColumns = (snapshot) => {
        const legacy = JSON.parse(JSON.stringify(snapshot));
        for (const section of legacy.sections) {
            for (const answer of section.answers) {
                if (answer.repeating && Array.isArray(answer.value) && answer.value.length) {
                    answer.rows = null;
                }
            }
        }
        return legacy;
    };

    it('still shows the applicant\'s records rather than dropping them', async () => {
        // Rendering `rows` alone would say "None recorded" for an applicant who
        // listed employers — silently dropping submitted data.
        const { snapshot } = await render();
        const legacy = withoutColumns(snapshot);
        const { bytes } = await renderApplicationPdf({ snapshot: legacy, generatedAt: SUBMITTED_AT });
        const text = await extractText(bytes);

        expect(text).toMatch(/Lone Star Logistics/);
        expect(text).toMatch(/OTR Driver/);
    });

    it('says the layout uses current field names rather than implying they were frozen', async () => {
        const { snapshot } = await render();
        const { bytes } = await renderApplicationPdf({ snapshot: withoutColumns(snapshot), generatedAt: SUBMITTED_AT });
        const text = await extractText(bytes);

        expect(text).toMatch(/predates stored field names/);
        expect(text).toMatch(/answers are unchanged/);
    });

    it('still prints no internal key from such a record', async () => {
        const { snapshot } = await render();
        const { bytes } = await renderApplicationPdf({ snapshot: withoutColumns(snapshot), generatedAt: SUBMITTED_AT });
        const text = await extractText(bytes);

        expect(text).not.toMatch(/draft-7712-internal/);
        expect(text).not.toMatch(/\[object Object\]/);
    });
});
