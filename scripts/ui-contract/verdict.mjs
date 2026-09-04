/**
 * What the measured tree and the allowlist say about each other.
 *
 * Pure: it reads two plain objects and returns findings. No filesystem, no git,
 * no process exit — which is what lets `scripts/test-ui-contract.mjs` drive
 * every branch on fixtures rather than on the repository it is guarding.
 *
 * Extracted from `check-ui-contract.mjs` on 2026-09-04, unchanged, so the CLI
 * could take the git-baseline comparison without going over the 500-line cap.
 */

/**
 * How much text an exception has to carry before it counts as a reason.
 *
 * Deliberately a length rather than a shape: the check cannot know whether a
 * sentence is *true*, and pretending otherwise would be a guard that lies. What
 * it can insist on is that somebody wrote something a reviewer can disagree
 * with. The baseline comparison in `./baseline.mjs` is what stops a filler
 * sentence buying a *new* exemption.
 */
export const MIN_REASON_LENGTH = 20;

/** Violations the allowlist does not cover, or covers by too small a number. */
export function findProblems(measured, allowlist) {
    const problems = [];
    let toleratedTotal = 0;

    for (const [file, counts] of Object.entries(measured)) {
        const allowed = allowlist.files?.[file] ?? {};
        for (const [rule, count] of Object.entries(counts)) {
            const permitted = typeof allowed[rule] === 'number' ? allowed[rule] : 0;
            toleratedTotal += Math.min(count, permitted);
            if (count > permitted) {
                problems.push({
                    kind: 'new',
                    file,
                    rule,
                    detail: permitted === 0
                        ? `${count} new`
                        : `${count}, inventory allows ${permitted}`,
                });
            }
        }
    }

    return { problems, toleratedTotal };
}

/**
 * Every allowlist entry must say why it is there.
 *
 * This is what makes the file an allowlist rather than a pile of tolerated
 * numbers. Without it, "add it to the allowlist" is a way to make any
 * failure go away, and the next reader has no way to tell a deliberate
 * exception from something someone was in a hurry about.
 */
export function findUnexplained(allowlist) {
    const unexplained = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        for (const rule of Object.keys(allowed)) {
            if (rule === 'reasons') continue;
            const reason = allowed.reasons?.[rule];
            if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
                unexplained.push(`${file} → ${rule}`);
            }
        }
    }
    return unexplained;
}

/** Shrinkage: the allowlist describes a tree that no longer exists. */
export function findStale(measured, allowlist) {
    const stale = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        const counts = measured[file] ?? {};
        for (const [rule, permitted] of Object.entries(allowed)) {
            if (rule === 'reasons') continue;
            const count = counts[rule] ?? 0;
            if (count < permitted) stale.push(`${file} → ${rule}: ${permitted} → ${count}`);
        }
    }
    return stale;
}

/** The three verdicts together, in the order the CLI reports them. */
export function evaluate(measured, allowlist) {
    const { problems, toleratedTotal } = findProblems(measured, allowlist);
    return {
        problems,
        toleratedTotal,
        unexplained: findUnexplained(allowlist),
        stale: findStale(measured, allowlist),
    };
}
