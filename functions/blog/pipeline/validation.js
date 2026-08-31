/**
 * What a publishable draft is.
 *
 * The structural validation gate and the word-count floor it enforces,
 * including the owner decisions that set that floor. Extracted from
 * `generate.js`; this runs before the AI verification steps because it is
 * deterministic and free.
 */

const dedupe = require('./dedupe');
const sanitize = require('./sanitize');

/**
 * An article shorter than this is not worth publishing.
 *
 * **150, down from 450 in three owner decisions** on 2026-08-03. The trade-off was
 * put to them each time: the free tiers of both AI providers cannot sustain a longer
 * article, and the alternative was a paid tier. This is recorded at length because
 * it is a deliberate reduction in article substance below the 700-1,200 words
 * originally specified — not a constant that drifted.
 *
 * 350, then 200, then 150 — each step measured against what the providers actually
 * produce rather than chosen. Groq's observed drafts were 165, 175 and 213 words,
 * so a 200 floor discarded two of three sound articles and published nothing. 150
 * is set below the measured floor of Groq's output so that a day never passes with
 * nothing published.
 *
 * This is a thin article by any editorial standard, and it is a long way from the
 * 700-1,200 words the brief asked for. It is here because the owner chose a
 * published short article over an unpublished long one, on a free tier, twice.
 * Raising a provider tier is what reverses it.
 *
 * The two free tiers fail in opposite directions: Gemini writes 311-417 words but
 * caps at 20 requests per minute, while Groq is reliably available and reliably
 * terse at 175-213. Gemini leads and will usually clear 300 comfortably; the floor
 * sits below Groq's measured output so that when Gemini's quota is spent, Groq's
 * shorter article still publishes rather than the day producing nothing. The
 * owner's words: "even the 200 word article is okay, if Gemini fails".
 *
 * **There is one enforced number and it is 150.** An earlier revision of this
 * comment said the floor "sits at 200" while the constant read 150, and the prompt
 * asks for at least 300 — three numbers for one rule. The prompt's 300 is an
 * instruction to the model, deliberately above the gate so it aims high rather
 * than at the minimum; 150 is the gate. Under-shooting the prompt is tolerated,
 * padding is still forbidden, and nothing but this constant refuses an article.
 *
 * Three numbers move together — this floor, `maxOutputTokens` in
 * articleGeneration, and `MAX_DOCUMENT_TEXT_CHARS` in fetchSources. Raise all
 * three if a provider tier is upgraded.
 */
const MIN_WORD_COUNT = 150;

/**
 * Structural validation of a generated draft. Runs before the AI verification
 * step because it is deterministic and free.
 */
function validateDraft(article) {
    const problems = [];
    const title = sanitize.cleanText(article?.title, 200);
    const slug = sanitize.slugify(title);
    const blocks = sanitize.sanitizeBlocks(article?.blocks);
    const words = sanitize.wordCount(blocks);

    if (title.length < 20) problems.push('title too short');
    if (title.length > 110) problems.push('title too long');
    if (!sanitize.isValidSlug(slug)) problems.push('title does not yield a usable slug');
    if (blocks.length < 4) problems.push('too few content blocks survived sanitization');
    if (words < MIN_WORD_COUNT) problems.push(`article too short (${words} words)`);

    const metaDescription = sanitize.cleanText(article?.metaDescription, 165);
    if (metaDescription.length < 60) problems.push('meta description too short');

    const excerpt = sanitize.cleanText(article?.excerpt, 320);
    if (excerpt.length < 60) problems.push('excerpt too short');

    // A heading identical to the title reads as a duplicated document title.
    const duplicateHeading = blocks.some(
        (block) => block.type === 'heading' && dedupe.normalizeTitle(block.text) === dedupe.normalizeTitle(title),
    );
    if (duplicateHeading) problems.push('a heading repeats the title');

    return { ok: problems.length === 0, problems, title, slug, blocks, words, metaDescription, excerpt };
}

module.exports = {
    MIN_WORD_COUNT,
    validateDraft,
};
