/**
 * Composing the reader's two passes into one answer.
 *
 * The second call carries only the documents the model itself said it could not
 * read, so its answer is complete in SHAPE and almost entirely empty in content:
 * a medical-card vision read comes back with `carriers: []`, `violations: []` and
 * an empty `driver` beside the one date it found. Spread over the first pass, that
 * erased the licence, the carriers and the violations that had read perfectly —
 * an empty result wearing the shape of an answer, which is the exact failure this
 * feature is built to notice rather than commit.
 *
 * ## Why the SECOND pass wins here, when the callable prefers the first
 *
 * Inside one call, `mergeExtraction` in `functions/companyApplications/aiExtract.js`
 * lets the text result win over a vision result, because there the two are fresh
 * reads of different documents and text is the more exact of the two.
 *
 * Between the two calls the situation is the opposite. A document only reaches the
 * second pass because the model reported its text as garbage — and OCR fails by
 * producing plausible nonsense, so a value the first pass reported for such a
 * document is precisely the value not to trust. Nothing readable is ever re-sent,
 * so every value the second pass returns comes from a document the first pass
 * admitted it could not read. Second wins where it found something; first survives
 * everywhere it did not.
 *
 * Duplicate carriers and violations are the expected consequence of joining the
 * lists, and are removed downstream by `applyExtractedFields`, which checks each
 * incoming row against the ones already on the application as it adds them.
 */

/** Only the keys that actually hold something — a blank must not win over a value. */
function withValues(value) {
    return Object.fromEntries(
        Object.entries(value || {})
            .filter(([, entry]) => (Array.isArray(entry) ? entry.length > 0 : Boolean(entry))),
    );
}

/**
 * @param {object} first the text pass's answer
 * @param {object} second the vision pass's answer, over the unreadable documents
 * @returns {{driver: object, license: object, carriers: Array, violations: Array, unreadable: string[]}}
 */
export function mergeExtractionResults(first, second) {
    const text = first || {};
    const vision = second || {};
    return {
        driver: { ...withValues(text.driver), ...withValues(vision.driver) },
        license: { ...withValues(text.license), ...withValues(vision.license) },
        carriers: [...(text.carriers || []), ...(vision.carriers || [])],
        violations: [...(text.violations || []), ...(vision.violations || [])],
        // The first pass is what named the documents it could not read, and the
        // second pass *was* that list, so it has nothing to add here.
        unreadable: Array.isArray(text.unreadable) ? text.unreadable : [],
    };
}

export default mergeExtractionResults;
