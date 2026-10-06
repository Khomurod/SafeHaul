/**
 * Where a phrase is a claim about SafeHaul, and where it is not.
 *
 * `checkClaims` used to test each prohibited pattern against the whole text,
 * which was wrong both ways:
 *  - A phrase is a claim only where SafeHaul is its subject. A recruiting article
 *    telling carriers to "run an MVR check on every applicant" says nothing about
 *    SafeHaul, and was refused as claiming that SafeHaul runs MVR checks.
 *  - A limitation is not a claim. "This article is not legal advice", which the
 *    house style asks for, and "It does not send renewal reminders", which the
 *    capability package requires beside document storage, were refused as the
 *    very claims they deny.
 *
 * So the text is read sentence by sentence, and each sentence clause by clause:
 * a clause ends at a semicolon, a colon, a dash, or a "but" or "however". A match
 * counts unless a negation comes before it in its clause, or its own predicate
 * denies it ("drip sequences are not available"). "SafeHaul does not run MVR
 * checks, but it integrates with PSP screening" still makes a claim.
 *
 * Which sentences are about SafeHaul depends on who is speaking. On SafeHaul's
 * own pages and in an article about SafeHaul, every sentence is (`scope: 'all'`,
 * the default). In an industry article it is a sentence that names SafeHaul, and
 * the sentence after it, where "it" may still mean SafeHaul (`scope: 'mentions'`).
 *
 * A deterministic backstop, not a parser: "Not only does SafeHaul run MVR checks"
 * reads as a denial. The AI fact-check that follows it is the second line.
 *
 * It requires nothing. The public-claims check loads the capability package, and
 * so this file, in a CI job that installs nothing (K4, `scripts/ci-plan`).
 */

const NAMES_SAFEHAUL = /\bsafe\s?haul\b/i;
const NEGATION = /\b(?:not|no|never|neither|nor|cannot|without)\b|n['’]t\b/i;
// What follows a match and denies it: the rest of its word, up to three more that
// do not open a relative clause, then "is not", "are never", "isn't", "is
// unavailable". "Drip campaigns that are not spammy" is still a claim.
const DENIED_AFTER = /^\w*(?:\s+(?!(?:that|which|who)\b)\w+){0,3}?\s+(?:(?:is|are|was|were)\s+(?:not|never|unavailable)\b|(?:is|are|was|were)n['’]t\b)/i;
const CLAUSE_BREAK = /[;:]|\s[-–—]\s|[–—]|,?\s+\b(?:but|however|yet|whereas|although|though)\b/i;

function sentencesOf(text) {
    return String(text || '').split(/(?<=[.!?])\s+|\n+/).filter((sentence) => sentence.trim());
}

function globalCopy(pattern) {
    return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

/**
 * @param {string} text
 * @param {ReadonlyArray<{ pattern: RegExp, claim: string }>} patterns
 * @param {{ scope?: 'all'|'mentions' }} [options]
 * @returns {string[]} each claim made, once, in the order of `patterns`
 */
function claimsMade(text, patterns, { scope = 'all' } = {}) {
    const sentences = sentencesOf(text);
    const made = new Set();
    sentences.forEach((sentence, index) => {
        const aboutSafeHaul = scope === 'all'
            || NAMES_SAFEHAUL.test(sentence)
            || (index > 0 && NAMES_SAFEHAUL.test(sentences[index - 1]));
        if (!aboutSafeHaul) return;
        for (const clause of sentence.split(CLAUSE_BREAK)) {
            for (const { pattern, claim } of patterns) {
                for (const match of clause.matchAll(globalCopy(pattern))) {
                    const deniedBefore = NEGATION.test(clause.slice(0, match.index));
                    const deniedAfter = DENIED_AFTER.test(clause.slice(match.index + match[0].length));
                    if (!deniedBefore && !deniedAfter) made.add(claim);
                }
            }
        }
    });
    return [...new Set(patterns.map(({ claim }) => claim))].filter((claim) => made.has(claim));
}

module.exports = { claimsMade };
