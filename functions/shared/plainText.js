// functions/shared/plainText.js
//
// Showing text people typed inside HTML we send: escaped, and, for text a
// stranger typed into an email a company's mail server sends, cut short and
// free of anything a mail client would turn into a link.

/** Escapes the five characters that matter in HTML text and attributes. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Invisible or direction-changing characters can hide part of a text from the
// person reading it, or split a web address so a check misses it.
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Text someone typed, made fit to show in an email: no control or invisible
 * characters, single spaces, at most `maxChars` characters (an ellipsis marks a
 * cut). Still escape it with `escapeHtml` where it goes into HTML.
 */
function clipText(value, maxChars) {
    const text = String(value ?? '').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    const chars = Array.from(text);
    return chars.length > maxChars ? `${chars.slice(0, maxChars).join('').trimEnd()}…` : text;
}

// A whole word holding a web address, an email address or a bare domain
// ("evil.test/login"): the shapes mail clients turn into links.
const LINK_WORDS = [
    /\S*(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/giu,
    /\S*@\S*/gu,
    /\S*[\p{L}\p{N}]\.\p{L}{2,}\S*/gu,
];

/**
 * `clipText` minus every word a mail client would turn into a link, for a
 * person's name or a job title a stranger typed: neither holds a link, and a
 * link in one would reach its reader through a real company's mail.
 */
function plainGuestText(value, maxChars) {
    let text = String(value ?? '').replace(INVISIBLE, '');
    for (const pattern of LINK_WORDS) text = text.replace(pattern, ' ');
    return clipText(text, maxChars);
}

module.exports = { escapeHtml, clipText, plainGuestText };
