/**
 * Synthetic capability probes for the provider connection test.
 *
 * ## Why a single text probe was not enough
 *
 * The connection test used to send one constant prompt with no schema and no
 * image, identically for every provider, and report the provider healthy if any
 * text came back. That cannot see the failures that actually happen:
 *
 * - a vision model retired by the vendor eight months ago;
 * - a model that rejects `json_schema` with a 400 while answering plain text
 *   perfectly — which is exactly the incident recorded in
 *   `../registry/providers.js`, where Groq's health check stayed green while
 *   every schema-using task in production failed;
 * - a multi-image request a provider accepts one image at a time but not two.
 *
 * So the probes below exercise the capability *combinations SafeHaul actually
 * uses*, and a provider reports per-capability results rather than one verdict.
 *
 * ## What these prove, and what they do not
 *
 * Stated plainly because the distinction matters: the vision probes assert that
 * an image is accepted, understood well enough to answer a trivial question
 * about it, and returned inside a valid structured object. They do **not**
 * measure OCR accuracy, and they are not a proxy for how well a provider reads
 * a driving licence. Extraction quality is not something a synthetic health
 * check can honestly assert, and pretending otherwise would recreate the
 * original problem in a new place — a green check that means less than it looks.
 *
 * What they do catch is every mechanical failure: model gone, wire format
 * wrong, structured mode unsupported, image rejected, multi-image unsupported.
 * Those are what break.
 *
 * ## No real data, ever
 *
 * Every prompt is a constant and every image is generated from flat colour.
 * Nothing here touches a driver, an applicant, a company or a document. The
 * images below are solid-colour PNGs written out byte by byte, so the
 * repository carries no image file that could later be swapped for a real one.
 *
 * ## Why the images are 256x256 and not 8x8
 *
 * They were 8x8, on the reasoning that a probe should cost a rounding error.
 * That was measured against the live vendors on 2026-08-18 and it made the
 * probes lie — in the *pessimistic* direction, which is the harder kind to
 * notice, because a false failure looks like diligence:
 *
 *   Mistral  multi-image, 8x8   -> {"answer":"unknown"}   FAILED
 *   Mistral  multi-image, 256px -> {"answer":"blue"}      passed
 *   Gemini   multi-image, 8x8   -> HTTP 504 Deadline expired before operation
 *   Gemini   multi-image, 256px -> {"answer":"blue"}      passed
 *
 * Vision models tokenise an image into patches. An 8x8 image is under a single
 * patch, so it carries almost no signal and vendors handle the degenerate case
 * inconsistently — Mistral spent 15 prompt tokens on one and declined to answer.
 * Reporting "this provider cannot read images" on that basis was wrong, and it
 * is what put two working vision providers on the console as broken while CDL
 * auto-fill had nothing to fall back to.
 *
 * 256x256 is still flat colour, still generated, still ~560 bytes, and still
 * costs a rounding error — it is simply large enough for the question to be a
 * fair one. **If these are ever shrunk again, the probes stop testing the
 * vendors and start testing their tolerance of degenerate input.**
 */

const { CAPABILITIES } = require('../registry/capabilities');

/**
 * A 256x256 solid red PNG and a 256x256 solid blue PNG, 564 bytes each.
 *
 * Two colours rather than one because the multi-image probe has to be able to
 * distinguish *which* image is which — a provider that silently drops all but
 * the first image would otherwise pass.
 *
 * See the note above on why these are not 8x8 any more.
 */
const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAB+0lEQVR42u3TQQkAAAjAwPUvrX8reHAJBmsK3pIAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgAJMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAyAASTAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADADHAllMDvLkz2XNAAAAAElFTkSuQmCC';
const BLUE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAB+0lEQVR42u3TQQkAAAjAwPUvrW8zeHAJBqsGHpMAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgAJMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAyAASTAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADADHAjtqDvJl75jFAAAAAElFTkSuQmCC';

/** Deliberately tiny: a probe should cost a rounding error, not a real request. */
const PROBE_TIMEOUT_MS = 20000;

/**
 * A one-key schema, reused wherever a probe needs structured output.
 *
 * Small on purpose. The probe is testing whether the provider can be *asked*
 * for a schema and answer in shape, not whether it can fill a large one — and a
 * large schema would spend output budget that some free tiers do not have.
 */
function answerSchema(description) {
    return {
        type: 'object',
        properties: { answer: { type: 'string', description } },
        required: ['answer'],
        additionalProperties: false,
    };
}

/**
 * The probes, in the order they are reported.
 *
 * `capabilities` is the gate: a probe runs only if the provider declares
 * everything it needs, and is reported as `skipped` otherwise. That keeps the
 * results honest — a text-only provider is not "failing" vision, it does not
 * offer it.
 *
 * `validate` gets the parsed structured object (or raw text for the text probe)
 * and returns true when the answer shows the provider genuinely did the work.
 * They are forgiving about wording and strict about substance.
 */
const PROBES = Object.freeze([
    {
        id: 'text',
        label: 'Basic text',
        capabilities: [CAPABILITIES.TEXT],
        maxOutputTokens: 16,
        inputText: 'Reply with the single word: ready',
        schema: null,
        validate: (text) => typeof text === 'string' && text.trim().length > 0,
    },
    {
        id: 'structured_json',
        label: 'Structured JSON',
        // The capability that silently broke every schema-using SafeHaul task
        // while the old text-only check reported the provider healthy.
        capabilities: [CAPABILITIES.STRUCTURED_JSON],
        maxOutputTokens: 120,
        inputText: 'What colour is a clear midday sky? Answer with one word in the "answer" field.',
        schema: answerSchema('One word.'),
        validate: (output) => /blue/i.test(output?.answer || ''),
    },
    {
        id: 'vision_single',
        label: 'Single-image vision',
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON],
        maxOutputTokens: 120,
        inputText: 'The image is one solid colour. Name that colour with one word in the "answer" field.',
        images: [{ dataUrl: RED_PNG }],
        schema: answerSchema('One word naming the colour.'),
        validate: (output) => /red/i.test(output?.answer || ''),
    },
    {
        id: 'vision_multi',
        label: 'Multi-image vision',
        capabilities: [CAPABILITIES.VISION, CAPABILITIES.MULTI_IMAGE, CAPABILITIES.STRUCTURED_JSON],
        maxOutputTokens: 120,
        // Asking about the *second* image is the point: a provider that accepts
        // the request but only ever looks at the first image fails this and
        // passes a naive "did it answer" check.
        inputText: 'Two images are supplied, each a solid colour. Name the colour of the SECOND image with one word in the "answer" field.',
        images: [{ dataUrl: RED_PNG }, { dataUrl: BLUE_PNG }],
        schema: answerSchema('One word naming the colour of the second image.'),
        validate: (output) => /blue/i.test(output?.answer || ''),
    },
    {
        id: 'article_generation',
        label: 'Article generation',
        capabilities: [CAPABILITIES.ARTICLE_WRITING, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT],
        maxOutputTokens: 400,
        // Shaped like the real article task — a system instruction, a source
        // extract, and a multi-key structured result — but about a fictional
        // subject, so nothing here can be mistaken for publishable material.
        systemInstructions: 'You are an editor for a trucking-industry publication. You never state a fact you were not given.',
        inputText: [
            'Source extract (fictional, for testing only):',
            '"The Example Freight Authority said on 1 March that pilot depot hours will extend to 22:00 at three sites."',
            'Write a headline and a one-sentence summary using only the facts above.',
        ].join('\n'),
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
            },
            required: ['title', 'summary'],
            additionalProperties: false,
        },
        validate: (output) => (
            typeof output?.title === 'string' && output.title.trim().length > 3
            && typeof output?.summary === 'string' && output.summary.trim().length > 10
        ),
    },
    {
        id: 'article_verification',
        label: 'Article verification',
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT],
        maxOutputTokens: 300,
        // The fact-check stage is fail-closed in the blog pipeline: if it cannot
        // run, nothing publishes. So a provider being *able* to run it is worth
        // knowing before the 07:00 slot comes round, not after.
        //
        // The claim below is deliberately unsupported by the source, so a
        // provider that rubber-stamps everything fails this probe.
        systemInstructions: 'You are a careful fact-checker. You would rather flag a borderline claim than let an unsupported one through.',
        inputText: [
            'Source (fictional, for testing only):',
            '"The Example Freight Authority said pilot depot hours will extend to 22:00 at three sites."',
            'Draft claim: "The Example Freight Authority extended depot hours at forty sites nationwide."',
            'Is the draft claim supported by the source? Set "supported" accordingly.',
        ].join('\n'),
        schema: {
            type: 'object',
            properties: {
                supported: { type: 'boolean' },
                unsupportedClaims: { type: 'array', items: { type: 'string' } },
            },
            required: ['supported', 'unsupportedClaims'],
            additionalProperties: false,
        },
        validate: (output) => output?.supported === false,
    },
]);

/** The probes this provider's declared capabilities allow. */
function probesFor(provider) {
    return PROBES.map((probe) => ({
        probe,
        applicable: probe.capabilities.every((capability) => provider.capabilities.includes(capability)),
    }));
}

module.exports = {
    PROBES,
    probesFor,
    PROBE_TIMEOUT_MS,
    RED_PNG,
    BLUE_PNG,
};
