/**
 * Article generation and verification tasks.
 *
 * Three narrow tasks, not one general "write me a blog post":
 *  - `generateArticle` produces a structured draft from a fact package;
 *  - `verifyArticleClaims` re-reads the draft against the same facts and flags
 *    anything unsupported;
 *  - `selectTopic` picks one story from a candidate list.
 *
 * The draft is returned as *structured blocks*, never as HTML or Markdown. The
 * renderer in `blog/pipeline/sanitize.js` builds the markup itself, so nothing
 * the model writes is ever interpreted as markup.
 *
 * Privacy: everything on this path is public internet material plus SafeHaul's
 * own approved capability package. No driver, applicant, employee or
 * company-private data is ever included in one of these prompts.
 */

const { CAPABILITIES } = require('../registry/capabilities');
const { TASK_TYPES, PRIVACY, defineTask } = require('./contract');
const { runAiTask } = require('../router/router');

/**
 * The article contract.
 *
 * ## What this schema is for, and what it is not for
 *
 * It enforces only what the pipeline **cannot** repair: required fields, minimum
 * lengths, a minimum number of blocks, and the permitted block types. Those are
 * genuine failures — a missing field, a two-sentence article or a 20-character
 * excerpt cannot be fixed after the fact, and failing over to another provider is
 * the right response.
 *
 * Upper bounds are *not* editorial policy here. `sanitizeBlocks` and
 * `validateDraft` already normalise every one of them: blocks are capped at 60,
 * list items at 15 and 500 characters each, heading text at 200, the meta
 * description at 165 and the excerpt at 320, unknown block types are dropped and
 * `level` is coerced to 2 or 3.
 *
 * Duplicating those limits here — and enforcing them *fatally*, before the
 * sanitizer ever runs — threw away good articles over values the pipeline was
 * about to trim. Groq guarantees structure, not string lengths, so a sound draft
 * with 13 solid sections was discarded for a 198-character meta description; a
 * later draft was discarded again after being asked for four sections. That is a
 * schema fighting its own pipeline.
 *
 * The maxima that remain are payload bounds — protection against a runaway
 * response — deliberately set far above anything a real article reaches. Editorial
 * limits live in `validateDraft`, once.
 */
const ARTICLE_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        title: { type: 'string', minLength: 20, maxLength: 300 },
        metaDescription: { type: 'string', minLength: 60, maxLength: 600 },
        excerpt: { type: 'string', minLength: 60, maxLength: 1200 },
        imageQuery: { type: 'string', minLength: 3, maxLength: 300 },
        imageAltText: { type: 'string', minLength: 10, maxLength: 600 },
        blocks: {
            type: 'array',
            // A floor, because too few blocks is not repairable. The ceiling is
            // the sanitizer's, so it cannot reject what the sanitizer accepts.
            minItems: 6,
            maxItems: 60,
            items: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'quote'] },
                    level: { type: 'integer', minimum: 2, maximum: 3 },
                    text: { type: 'string', maxLength: 8000 },
                    items: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 2000 } },
                },
                required: ['type'],
                additionalProperties: false,
            },
        },
    },
    required: ['title', 'metaDescription', 'excerpt', 'imageQuery', 'imageAltText', 'blocks'],
    additionalProperties: false,
});

const VERIFICATION_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        supported: { type: 'boolean' },
        unsupportedClaims: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', maxLength: 400 },
        },
        notes: { type: 'string', maxLength: 1000 },
    },
    required: ['supported', 'unsupportedClaims'],
    additionalProperties: false,
});

const TOPIC_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        selectedIndex: { type: 'integer', minimum: 0 },
        angle: { type: 'string', minLength: 10, maxLength: 300 },
        reason: { type: 'string', maxLength: 400 },
    },
    required: ['selectedIndex', 'angle'],
    additionalProperties: false,
});

/** The editorial standard, applied to every article regardless of theme. */
const HOUSE_STYLE = [
    'You write for SafeHaul News & Insights, read by trucking-company owners, recruiters, safety teams and fleet managers.',
    'Write in clear, plain English. Short sentences. No marketing language, no filler, no hype.',
    'Stay on the one topic in the headline. Do not wander into adjacent subjects.',
    'Explain why the subject matters to a carrier, concretely.',
    'Use only facts present in the supplied source material. If a figure is not in the sources, do not state it.',
    'Separate fact from interpretation: when you are drawing a conclusion, say so.',
    'Never present regulatory information as legal advice. Where a rule is discussed, say that carriers should confirm how it applies to them.',
    'Do not copy sentences from the sources. Write original prose.',
    'Do not invent quotes or attribute statements to people.',
    // The floor is stated as a requirement because `validateDraft` enforces it
    // as one. The previous wording — "aim for roughly 700 to 1,200 words when the
    // topic supports it, do not pad" — invited exactly the outcome it got: given
    // a single short Federal Register abstract the model correctly declined to
    // pad, returned 251 words, and the validator then threw the article away for
    // being under 450. The prompt and the validator contradicted each other.
    //
    // The way out is not to permit padding. It is to say what a short source
    // legitimately supports: practical implications for a carrier are the
    // writer's own analysis, not invented facts, and the separate claim
    // verification step still refuses anything asserted beyond the sources.
    'The article must be at least 500 words. Aim for 700 to 1,200.',
    'If the source material is thin, do not pad and do not invent facts. Add length by'
        + ' explaining what the subject means in practice for a carrier: who it applies to,'
        + ' what to check, what to do next, and what remains unclear. Label interpretation as'
        + ' interpretation.',
    // A structural floor rather than a word target. Asking for four distinct
    // sections lengthens an article by making it cover more ground, which is the
    // opposite of padding: each section has to earn its heading. Drafts sat just
    // under the 450-word floor at 417 with the length stated only as a number.
    'Structure the article with at least four h2 sections. Cover, at minimum: what changed'
        + ' or happened; exactly who it applies to; what a carrier should check or do; and what'
        + ' is still unclear or yet to be decided.',
    'Do not write a heading that repeats the title. Do not write a section with only one sentence.',
    'The title must be specific and unique, under 110 characters, and must not be clickbait.',
].join('\n');

function renderSources(sources) {
    return sources.map((source, index) => [
        `[${index + 1}] ${source.title}`,
        `    Publisher: ${source.publisher}${source.tier === 'primary' ? ' (official/primary source)' : ''}`,
        `    Published: ${source.publishedAt || 'date not stated'}`,
        `    URL: ${source.url}`,
        source.action ? `    Action: ${source.action}` : '',
        source.docketIds?.length ? `    Docket: ${source.docketIds.join(', ')}` : '',
        source.cfrReferences?.length ? `    Regulations touched: ${source.cfrReferences.join(', ')}` : '',
        `    Summary: ${source.summary || '(no summary provided)'}`,
        // The lead document's own text, where it was retrievable. This is the
        // material an article is actually built from; the abstract alone is a
        // headline. Still bounded by the fetcher.
        source.fullText ? `    Full document text follows.\n    ---\n${source.fullText}\n    ---` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
}

function renderKnowledge(knowledge) {
    if (!knowledge) return '';
    const features = knowledge.features.map((feature) => [
        `- ${feature.name} (${feature.status})`,
        `  What it does: ${feature.description}`,
        `  Who uses it: ${feature.who}`,
        `  Benefit: ${feature.benefit}`,
        feature.limitations.length ? `  Limitations you must state if you mention this: ${feature.limitations.join(' ')}` : '',
    ].filter(Boolean).join('\n')).join('\n');

    return [
        '',
        'APPROVED SAFEHAUL CAPABILITY PACKAGE.',
        'This is the only information about SafeHaul you may use. Do not describe any',
        'SafeHaul feature that is not listed here, however plausible it sounds.',
        '',
        features,
        '',
        'You must NOT make any of the following claims:',
        ...knowledge.doNotClaim.map((claim) => `- ${claim}`),
    ].join('\n');
}

/**
 * Generates a structured article draft.
 *
 * @param {object} params
 * @param {object} params.theme theme row from blog/pipeline/themes
 * @param {object} params.topic `{ title, angle }`
 * @param {Array} params.sources saved source evidence
 * @param {object|null} params.knowledge approved capability briefing, for the SafeHaul theme
 * @param {string[]} params.recentTitles titles to avoid repeating
 */
async function generateArticle({ theme, topic, sources, knowledge, recentTitles = [] }, deps = {}) {
    const prompt = [
        HOUSE_STYLE,
        '',
        `THEME: ${theme.name}. ${theme.description}`,
        `EDITORIAL ANGLE: ${theme.editorialAngle}`,
        '',
        `TOPIC: ${topic.title}`,
        topic.angle ? `ANGLE TO TAKE: ${topic.angle}` : '',
        '',
        sources.length ? 'SOURCE MATERIAL (the only facts you may use):' : 'No external sources apply to this theme.',
        sources.length ? renderSources(sources) : '',
        renderKnowledge(knowledge),
        '',
        recentTitles.length
            ? `Recently published titles. Your article must not repeat these subjects:\n${recentTitles.map((title) => `- ${title}`).join('\n')}`
            : '',
        '',
        'Return the article as structured blocks. Do not return HTML or Markdown.',
        'imageQuery should be two to four plain words describing a suitable stock photograph',
        'of trucking, freight or fleet operations. imageAltText should describe that',
        'photograph for a screen-reader user in the context of this article.',
    ].filter(Boolean).join('\n');

    const task = defineTask({
        taskType: TASK_TYPES.ARTICLE_GENERATION,
        capabilities: [CAPABILITIES.ARTICLE_WRITING, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT],
        systemInstructions: 'You are an editor for a trucking-industry publication. You are precise, plain-spoken, and you never state a fact you were not given.',
        inputText: prompt,
        outputSchema: ARTICLE_SCHEMA,
        schemaName: 'safehaul_article',
        // A little variation reads better than temperature 0 over hundreds of
        // articles, but not enough to loosen the model's grip on the facts.
        temperature: 0.4,
        // Sized from measurement, not habit. 1,200 words — the validator's upper
        // bound — is roughly 1,700 tokens, so 3,000 is generous for the prose plus
        // a reasoning model's thinking.
        //
        // The upper constraint is Groq's per-minute token ceiling, which its
        // headers state as `x-ratelimit-limit-tokens: 8000` and which charges the
        // full `max_output_tokens` whether used or not. With an enriched prompt at
        // roughly 2,300 input tokens, a 4,096 request plus headroom totalled 8,120
        // and was refused outright as `rate_limited`.
        //
        // An earlier attempt at 2,500 went the other way and starved the writer,
        // but that draft was short because the source was a one-paragraph abstract,
        // not because of the budget. With the document's own text supplied, 3,000
        // is ample.
        maxOutputTokens: 3000,
        privacy: PRIVACY.PUBLIC,
        totalDeadlineMs: 180000,
    });

    const result = await runAiTask(task, deps);
    return { article: result.output, providerId: result.providerId, model: result.model, fallbackCount: result.fallbackCount };
}

/**
 * Independent check that every factual claim traces to the supplied sources.
 *
 * Deliberately a *separate* request rather than an instruction appended to the
 * generation prompt: a model asked to check its own work in the same breath
 * tends to approve it.
 */
async function verifyArticleClaims({ articleText, sources, knowledge }, deps = {}) {
    const prompt = [
        'You are fact-checking a draft article before publication.',
        'List every factual claim in the draft that is NOT supported by the source material below.',
        'Treat a specific number, date, rule name, agency action or attributed statement as a factual claim.',
        'General industry background that any practitioner would know is not a claim.',
        'If a claim about SafeHaul is not in the approved capability package, list it as unsupported.',
        'Set supported to false if you list anything.',
        '',
        'DRAFT:',
        articleText,
        '',
        sources.length ? 'SOURCE MATERIAL:' : 'No external sources were supplied for this article.',
        sources.length ? renderSources(sources) : '',
        renderKnowledge(knowledge),
    ].filter(Boolean).join('\n');

    const task = defineTask({
        taskType: TASK_TYPES.ARTICLE_FACT_CHECK,
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.LONG_CONTEXT],
        systemInstructions: 'You are a careful fact-checker. You would rather flag a borderline claim than let an unsupported one through.',
        inputText: prompt,
        outputSchema: VERIFICATION_SCHEMA,
        schemaName: 'safehaul_article_verification',
        temperature: 0,
        maxOutputTokens: 1500,
        privacy: PRIVACY.PUBLIC,
        totalDeadlineMs: 120000,
    });

    const result = await runAiTask(task, deps);
    return result.output;
}

/**
 * Chooses which candidate story to write about.
 *
 * @param {object} params
 * @param {object} params.theme
 * @param {Array<{ title: string, publisher: string, summary: string }>} params.candidates
 */
async function selectTopic({ theme, candidates, recentTitles = [] }, deps = {}) {
    const prompt = [
        `You are choosing today's article for the "${theme.name}" section of a trucking-industry publication.`,
        theme.editorialAngle,
        '',
        'CANDIDATES:',
        candidates.map((candidate, index) => (
            `[${index}] ${candidate.title} — ${candidate.publisher}\n     ${candidate.summary || ''}`
        )).join('\n'),
        '',
        recentTitles.length
            ? `Already covered recently, so do not choose a candidate about the same subject:\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
            : '',
        '',
        'Choose the candidate most useful to trucking-company owners, recruiters, safety teams',
        'and fleet managers. Prefer a concrete development over a general commentary piece.',
        'Return its index and the angle the article should take.',
    ].filter(Boolean).join('\n');

    const task = defineTask({
        taskType: TASK_TYPES.TOPIC_SELECTION,
        capabilities: [CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON, CAPABILITIES.CLASSIFICATION],
        inputText: prompt,
        outputSchema: TOPIC_SCHEMA,
        schemaName: 'safehaul_topic_selection',
        temperature: 0.2,
        maxOutputTokens: 500,
        privacy: PRIVACY.PUBLIC,
    });

    const result = await runAiTask(task, deps);
    return result.output;
}

module.exports = {
    ARTICLE_SCHEMA,
    VERIFICATION_SCHEMA,
    TOPIC_SCHEMA,
    HOUSE_STYLE,
    generateArticle,
    verifyArticleClaims,
    selectTopic,
    renderSources,
};
