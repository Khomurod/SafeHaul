/**
 * The allowlist's key format and shape.
 *
 * Version 1 keyed every entry relative to `src/`, because `src/` was the only
 * thing the guard walked. Widening the scan to `index.html`, which Tailwind
 * compiles, put a file outside `src/` into the inventory, and there is no honest
 * `src/`-relative name for it. So version 2 keys everything from the repository
 * root: `src/features/…/Thing.jsx`, `index.html`. Reading a version-1 document
 * still lifts its keys; reading a version-2 one is the identity.
 */

/** The format the checker writes today. */
export const ALLOWLIST_VERSION = 2;

/**
 * A file map keyed from the repository root, whatever version it arrived as.
 *
 * @param {object} document the parsed allowlist (`{version?, files}`)
 * @returns {object} `files`, repo-relative
 */
export function normaliseAllowlist(document) {
    const files = document?.files ?? {};
    /*
     * `>= ALLOWLIST_VERSION` rather than `=== `: a document from a FUTURE
     * version is already repo-relative too, and silently re-prefixing it would
     * be worse than reading it as-is. An absent version means 1 — the field did
     * not exist then.
     */
    if (Number(document?.version ?? 1) >= ALLOWLIST_VERSION) return files;

    return Object.fromEntries(
        Object.entries(files).map(([key, entry]) => [
            key.startsWith('src/') ? key : `src/${key}`,
            entry,
        ]),
    );
}

/** `reasons` is metadata, not a rule. */
const REASONS_KEY = 'reasons';

/**
 * A malformed entry is refused rather than ignored.
 *
 * The verdicts compare counts, and a count that is not a whole number compares
 * false either way, so `{"raw-table": "unbounded"}` would read as a ceiling
 * nothing can reach. Nothing is judged until the shape is sound.
 *
 * @returns {string[]} one sentence per malformed entry
 */
export function allowlistShapeProblems(files, label = 'the allowlist') {
    const problems = [];
    for (const [file, entry] of Object.entries(files ?? {})) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            problems.push(`${label} records ${file} as ${JSON.stringify(entry)}, which is not a set `
                + 'of rule counts.');
            continue;
        }
        for (const [rule, value] of Object.entries(entry)) {
            if (rule === REASONS_KEY) {
                if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                    problems.push(`${label} records ${file} → reasons as ${JSON.stringify(value)}, `
                        + 'which is not a map of rule to explanation.');
                    continue;
                }
                for (const [reasonRule, text] of Object.entries(value)) {
                    if (typeof text !== 'string') {
                        problems.push(`${label} records ${file} → reasons → ${reasonRule} as `
                            + `${JSON.stringify(text)}, which is not an explanation.`);
                    }
                }
                continue;
            }
            if (!Number.isInteger(value) || value < 0) {
                problems.push(`${label} records ${file} → ${rule} as ${JSON.stringify(value)}, which `
                    + 'is not a violation count. Use a whole number.');
            }
        }
    }
    return problems;
}
