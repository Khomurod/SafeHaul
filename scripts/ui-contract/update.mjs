/**
 * Lowering the allowlist to what the tree still contains.
 *
 * A fixed violation should cost neither a hand edit nor a red build. So when an
 * entry records more than the tree still has, the checker lowers it to the count
 * it measures, and drops an entry that reached zero together with its reason. It
 * never adds a file, a rule or a higher count: an exception that grows is written
 * by hand, with a reason, where review sees it.
 *
 * Locally the lowered file is written back for the change to commit. CI cannot
 * write, so there the same finding is a warning on the pull request.
 */

import { ALLOWLIST_VERSION } from './allowlist.mjs';

/**
 * Every entry lowered to what the tree still holds; nothing added.
 *
 * Files keep their order and rules keep theirs, with `reasons` last, so the
 * written file differs from the one on disk only where a count fell.
 *
 * @param {object} measured rule counts per file, from `scan()`
 * @param {object} allowlist the loaded allowlist document
 * @returns {object} the lowered `files` map
 */
export function shrink(measured, allowlist) {
    const files = {};
    for (const [file, entry] of Object.entries(allowlist.files ?? {})) {
        const counts = measured[file] ?? {};
        const kept = {};
        for (const [rule, permitted] of Object.entries(entry)) {
            if (rule === 'reasons') continue;
            const count = Math.min(permitted, counts[rule] ?? 0);
            if (count > 0) kept[rule] = count;
        }
        if (Object.keys(kept).length === 0) continue;
        // A reason for a rule the file no longer breaks goes with it, so a
        // retired exception cannot linger as cover for a future one.
        const reasons = Object.fromEntries(
            Object.entries(entry.reasons ?? {}).filter(([rule]) => rule in kept),
        );
        files[file] = Object.keys(reasons).length > 0 ? { ...kept, reasons } : kept;
    }
    return files;
}

/**
 * The on-disk form: three keys, two-space indent, trailing newline.
 *
 * `version` is written at the current value rather than echoed from the input:
 * the written keys are today's format, so the document declares today's version.
 */
export function serialise(allowlist, files) {
    return `${JSON.stringify(
        { $comment: allowlist.$comment, version: ALLOWLIST_VERSION, files }, null, 2,
    )}\n`;
}

/**
 * What to do about entries the tree has outgrown: lower them on disk, or in CI
 * only say so.
 *
 * @param {{measured: object, allowlist: object, stale: string[], env?: object,
 *   write: (text: string) => void}} options
 * @returns {'none'|'warned'|'written'}
 */
export function settleShrinkage({ measured, allowlist, stale, env = process.env, write }) {
    if (stale.length === 0) return 'none';
    if (env.GITHUB_ACTIONS === 'true') return 'warned';
    write(serialise(allowlist, shrink(measured, allowlist)));
    return 'written';
}
