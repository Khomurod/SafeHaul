/**
 * Which way the allowlist moved, as pure functions.
 *
 * The sibling of `scripts/source-size-direction.mjs`, and written for the same
 * reason: a gate must not take its scope from the branch it is gating. The
 * source-size backlog learned that on 2026-08-27; the UI-contract allowlist was
 * still taking every number on trust from the file the pull request could edit,
 * and a 2026-09-04 audit reproduced both ways through:
 *
 *   1. bump `VOEDocument.jsx` raw-palette-class 100 → 103, run `--update`, and
 *      the check prints "239 known violations, none new";
 *   2. add a brand-new file with five violations and one allowlist entry whose
 *      reason is a twenty-character sentence naming nothing, and it passes.
 *
 * Neither is a bug in a rule. Both are the *inventory* being writable by the
 * change it is measuring. These functions are what a base commit is compared
 * against; `./baseline.mjs` is what fetches it.
 *
 * Shape note: the source-size backlog is flat (`{path: number}`); this one is
 * nested (`{file: {rule: number, reasons: {rule: string}}}`), which is the whole
 * reason `compareBacklog` could not simply be reused. `reasons` is not a rule
 * and is skipped everywhere.
 *
 * Removals and reductions produce nothing. They are the campaign working, and
 * the checker's own `stale` verdict already forces them to be recorded.
 */

/** `reasons` is metadata, not a rule. Everything here skips it. */
const REASONS_KEY = 'reasons';

/**
 * A malformed entry is refused rather than ignored.
 *
 * Every rule below compares with `>`, and a non-number coerces to `NaN`, for
 * which every comparison is false — so `{"raw-table": "unbounded"}` would exempt
 * a file from the ceiling AND from the may-not-grow rule, silently. That exact
 * shape was found in the source-size backlog and is refused there for the same
 * reason. Nothing is compared until the shape is sound.
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
                    + 'is not a violation count. Every rule here compares counts with `>`, and a '
                    + 'non-number coerces to NaN — for which every comparison is false, so a '
                    + 'malformed entry would exempt the file from its ceiling AND from the '
                    + 'may-not-grow rule. Use a whole number.');
            }
        }
    }
    return problems;
}

/**
 * The two directions that are forbidden: an entry that did not exist at the
 * base, and a count higher than the base recorded.
 *
 * Returns the growth rather than refusing it outright, because growth is not
 * automatically wrong — a *rule* added in this same change legitimately records
 * violations the base content already contained. `growthJustifiedByBase` is what
 * decides, by measuring the base's own content with the current rules.
 *
 * @returns {{problems: string[], growth: Array<{file, rule, count, previous}>}}
 */
export function compareAllowlist(previous, current, label = 'the allowlist') {
    const problems = [
        ...allowlistShapeProblems(previous, `${label} at the baseline`),
        ...allowlistShapeProblems(current, label),
    ];
    if (problems.length > 0) return { problems, growth: [] };

    const growth = [];
    for (const [file, entry] of Object.entries(current ?? {})) {
        const before = (previous ?? {})[file];
        for (const [rule, count] of Object.entries(entry)) {
            if (rule === REASONS_KEY) continue;
            const permittedBefore = before && typeof before[rule] === 'number' ? before[rule] : null;
            if (permittedBefore === null || count > permittedBefore) {
                growth.push({ file, rule, count, previous: permittedBefore });
            }
        }
    }
    return { problems, growth };
}

/**
 * An entry may only record a violation the base already carried.
 *
 * This is the rule that makes the two reproduced bypasses impossible, and it is
 * `bootstrapProblems` (source-size) applied per entry rather than per file. The
 * base is a commit this change cannot edit, so "was it already like this?" is a
 * checkable question — unlike "is this reason true?", which is not.
 *
 * It is deliberately not "the count must be unchanged". A widening rule lands
 * with new entries whose violations are years old, and refusing those would make
 * the guard impossible to improve. What it refuses is a violation the base did
 * not have: new code being written straight into the inventory.
 *
 * The consequence, which is intended and matches source-size: a recorded
 * exception is a frozen ceiling. `VOEDocument.jsx` cannot grow a 101st palette
 * class — the way out is to make the exception unnecessary, not larger.
 *
 * @param {Array} growth from `compareAllowlist`
 * @param {object} countsAtBase file → rule → count, measured from the base's own
 *   content with the CURRENT rules; a file absent at the base is absent here
 */
export function growthJustifiedByBase(growth, countsAtBase, ref, label = 'the allowlist') {
    const at = ref.slice(0, 8);
    const problems = [];
    for (const { file, rule, count, previous } of growth) {
        const measured = countsAtBase[file];
        if (measured === undefined) {
            problems.push(`${label} adds ${file} → ${rule}, but ${file} does not exist at ${at}. An `
                + 'entry records a violation that was already there; one for a file this change '
                + 'adds is a new exemption being written, which is the one thing the inventory may '
                + 'never grant. Fix the violation instead.');
            continue;
        }
        const carried = typeof measured[rule] === 'number' ? measured[rule] : 0;
        if (count > carried) {
            const was = previous === null ? 'no entry' : `${previous}`;
            problems.push(`${label} records ${file} → ${rule} as ${count} (${was} at ${at}), but the `
                + `file at ${at} carries only ${carried} under the current rules. A recorded count `
                + 'is a ceiling on what was already there, not a running total — raising it to '
                + 'match code this change wrote is how an inventory stops meaning anything.');
        }
    }
    return problems;
}
