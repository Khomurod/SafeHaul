/**
 * Regenerating the inventory after a migration.
 *
 * `--update` exists so that *shrinkage* is cheap to record: a slice that retires
 * an exception should not also require hand-editing a JSON file, and the check
 * fails on a decrease precisely so the shrinkage lands in its own diff.
 *
 * Extracted from `check-ui-contract.mjs` on 2026-09-04.
 *
 * ## `--update` may only shrink, and that is the point of the flag
 *
 * A 2026-09-04 audit reproduced the bypass in two commands: bump
 * `VOEDocument.jsx`'s raw-palette-class count from 100 to 103, run `--update`,
 * and the check reports "239 known violations, none new". The flag rewrote every
 * number it found, so the inventory it maintained was whatever the branch's
 * source happened to contain — an allowlist that regenerates itself is not an
 * allowlist, it is a description.
 *
 * So `additions` computes what a regeneration would ADD — a file, a rule, or a
 * higher count — and the CLI refuses to write when there is any. Shrinkage and
 * re-sync still write, because that is the case the flag exists for and the one
 * `stale` already forces.
 *
 * The refusal is deliberately offline and one step earlier than
 * `./baseline.mjs`: an addition is compared against the allowlist ON DISK, so it
 * fires in a fresh clone with no history and needs no ref to resolve. A
 * hand-written entry that the base already carried still passes the baseline
 * check afterwards — which is exactly the rule-widening case, and the reason the
 * refusal says "add it by hand with a reason" rather than "you may not".
 */

import { compareAllowlist } from './direction.mjs';

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

/**
 * What a regeneration would add, and what it would write.
 *
 * `problems` carries a malformed on-disk allowlist — refused before anything is
 * compared, because every rule below uses `>` and a non-number coerces to `NaN`,
 * for which every comparison is false.
 *
 * @returns {{files: object, total: number, problems: string[], growth: Array}}
 */
export function additions(measured, allowlist) {
    const { files, total } = regenerate(measured, allowlist);
    const { problems, growth } = compareAllowlist(
        allowlist.files || {}, files, 'the allowlist on disk',
    );
    return { files, total, problems, growth };
}
