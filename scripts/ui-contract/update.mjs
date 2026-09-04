/**
 * Regenerating the inventory after a migration.
 *
 * `--update` exists so that *shrinkage* is cheap to record: a slice that retires
 * an exception should not also require hand-editing a JSON file, and the check
 * fails on a decrease precisely so the shrinkage lands in its own diff.
 *
 * Extracted from `check-ui-contract.mjs` on 2026-09-04. Behaviour is unchanged
 * here; the shrink-only refusal that stops `--update` writing a *raised* ceiling
 * is added in the baseline slice, where there is a base to judge it against.
 */

/**
 * Recompute the inventory from a fresh scan, preserving written reasons.
 *
 * @param {object} measured rule counts per file, from `scan()`
 * @param {object} allowlist the loaded allowlist document
 * @returns {{files: object, total: number}}
 */
export function regenerate(measured, allowlist) {
    const files = {};
    for (const [file, counts] of Object.entries(measured).sort()) {
        const previous = allowlist.files?.[file] ?? {};
        files[file] = { ...counts };
        // Annotations survive a regeneration; only the numbers are recomputed.
        // A `reasons` entry for a rule the file no longer breaks is dropped
        // with it, so a retired exception cannot linger as cover for a
        // future one.
        if (previous.reasons) {
            const live = Object.fromEntries(
                Object.entries(previous.reasons).filter(([rule]) => rule in counts),
            );
            if (Object.keys(live).length > 0) files[file].reasons = live;
        }
        /*
         * `debt` used to be the other way to pass — "a migration slice still
         * owes work here". It is deliberately not carried forward: since
         * 2026-08-25 every entry needs a reason, and `--update` inventing one
         * would defeat the point. An entry whose rule has no reason fails the
         * check instead, which is where the author has to write it.
         */
    }

    const total = Object.values(measured).reduce(
        (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0,
    );

    return { files, total };
}

/** The on-disk form: two keys, two-space indent, trailing newline. */
export function serialise(allowlist, files) {
    return `${JSON.stringify({ $comment: allowlist.$comment, files }, null, 2)}\n`;
}
