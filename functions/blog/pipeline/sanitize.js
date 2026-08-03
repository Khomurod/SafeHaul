/**
 * Content sanitization and slug generation.
 *
 * The article body is produced by an AI model and rendered into a public HTML
 * page, so it is treated as hostile input. Rather than trying to filter
 * dangerous HTML out of a free-form string, the generator is required to return
 * *structured blocks*, and this module renders those blocks to HTML itself.
 * That inverts the trust: nothing the model writes is ever interpreted as
 * markup, because the markup is ours and only the text is theirs.
 *
 * Consequences worth stating: no script can execute, no event handler can be
 * attached, no `javascript:` link can be followed, no iframe or object can be
 * embedded, and no unclosed tag can break out of the article container —
 * because none of those constructs survive as anything but escaped text.
 */

/** Block types the renderer knows. Anything else is dropped. */
const BLOCK_TYPES = Object.freeze(['heading', 'paragraph', 'list', 'quote']);

const MAX_BLOCKS = 60;
const MAX_TEXT_CHARS = 4000;
const MAX_LIST_ITEMS = 15;
const MAX_SLUG_CHARS = 80;

/** Only these schemes may appear in a rendered link. */
const ALLOWED_LINK_SCHEMES = Object.freeze(['https:', 'http:']);

/** Escapes the five characters that matter in HTML text and attributes. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Strips control characters and collapses whitespace.
 *
 * Control characters are removed because they can be used to obscure content
 * from a reviewer while remaining meaningful to a parser.
 */
function cleanText(value, maxChars = MAX_TEXT_CHARS) {
    return String(value ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}

/**
 * Validates a URL for use in a link or an image.
 *
 * @returns {string|null} the URL, or null when it is not safely usable
 */
function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) return null;
    let parsed;
    try {
        parsed = new URL(value.trim());
    } catch {
        return null;
    }
    if (!ALLOWED_LINK_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.toString();
}

/**
 * Normalizes one content block, or returns null to drop it.
 */
function normalizeBlock(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || '').toLowerCase();
    if (!BLOCK_TYPES.includes(type)) return null;

    if (type === 'list') {
        const items = (Array.isArray(raw.items) ? raw.items : [])
            .slice(0, MAX_LIST_ITEMS)
            .map((item) => cleanText(item, 500))
            .filter(Boolean);
        return items.length > 0 ? { type, items } : null;
    }

    if (type === 'heading') {
        const text = cleanText(raw.text, 200);
        if (!text) return null;
        // Only h2 and h3 are permitted: the page owns its single h1, so an
        // article cannot introduce a competing document title.
        const level = raw.level === 3 ? 3 : 2;
        return { type, level, text };
    }

    const text = cleanText(raw.text);
    return text ? { type, text } : null;
}

/**
 * Normalizes a generated block list.
 *
 * @param {Array} blocks
 * @returns {Array} sanitized blocks
 */
function sanitizeBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks
        .slice(0, MAX_BLOCKS)
        .map(normalizeBlock)
        .filter(Boolean);
}

/**
 * Renders sanitized blocks to HTML.
 *
 * Every piece of model-supplied text goes through `escapeHtml`. The tags come
 * from this function, never from the content.
 */
function renderBlocksToHtml(blocks) {
    return sanitizeBlocks(blocks).map((block) => {
        switch (block.type) {
            case 'heading':
                return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
            case 'list':
                return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
            case 'quote':
                return `<blockquote><p>${escapeHtml(block.text)}</p></blockquote>`;
            case 'paragraph':
            default:
                return `<p>${escapeHtml(block.text)}</p>`;
        }
    }).join('\n');
}

/** Plain text of an article, for word counts and similarity comparison. */
function blocksToPlainText(blocks) {
    return sanitizeBlocks(blocks).map((block) => (
        block.type === 'list' ? block.items.join(' ') : block.text
    )).join(' ');
}

function wordCount(blocks) {
    const text = blocksToPlainText(blocks);
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Builds a URL-safe slug.
 *
 * Restricted to lowercase ASCII letters, digits and single hyphens, so a slug
 * can be placed in a path and compared for equality without normalization
 * surprises.
 */
function slugify(title) {
    const base = String(title || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036F]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_CHARS)
        .replace(/-+$/g, '');
    return base;
}

/** Whether a slug arriving from a public URL is one we could have produced. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidSlug(slug) {
    return typeof slug === 'string'
        && slug.length > 0
        && slug.length <= MAX_SLUG_CHARS
        && SLUG_PATTERN.test(slug);
}

module.exports = {
    BLOCK_TYPES,
    MAX_BLOCKS,
    MAX_SLUG_CHARS,
    SLUG_PATTERN,
    escapeHtml,
    cleanText,
    safeUrl,
    sanitizeBlocks,
    renderBlocksToHtml,
    blocksToPlainText,
    wordCount,
    slugify,
    isValidSlug,
};
