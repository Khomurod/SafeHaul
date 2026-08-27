/**
 * Did the backlog move the wrong way?
 *
 * Three pure comparisons, split out of `scripts/source-size-baseline.mjs` on
 * 2026-08-27 when that file crossed 400 lines. They answer "did it grow"; the
 * baseline module answers the harder question — grew relative to WHAT — which is
 * a different subject, and the one this repository keeps getting wrong.
 *
 * Pure on purpose: every case in `scripts/test-source-size-baseline.mjs` drives
 * these directly, with no repository and no network.
 */

/**
 * Is every recorded count actually a count?
 *
 * Found in review on 2026-08-27, and it is the original hole wearing a different
 * hat. Every rule here and in `evaluate` compares numbers with `>`, and JavaScript
 * coerces a non-numeric value to `NaN` — for which every comparison is false. So
 * `{"src/big.js": "unbounded"}` made a 9000-line file pass BOTH the hard limit and
 * the may-not-grow rule, with no error anywhere. Reproduced before fixing.
 *
 * A malformed entry is refused rather than ignored: "this is not a line count" is
 * a problem in its own right, and treating it as absent would silently apply the
 * hard limit instead, which reads as a different failure than it is.
 */
export function backlogShapeProblems(backlog, label = 'the backlog') {
  const problems = [];
  for (const [path, lines] of Object.entries(backlog ?? {})) {
    if (!Number.isInteger(lines) || lines < 0) {
      problems.push(`${label} records ${path} as ${JSON.stringify(lines)}, which is not a line `
        + 'count. Every rule here compares counts with `>`, and a non-number coerces to NaN — for '
        + 'which every comparison is false, so a malformed entry would exempt the file from the '
        + 'hard limit AND from the may-not-grow rule. Use a whole number of lines.');
    }
  }
  return problems;
}

/**
 * The two directions that are forbidden, as a pure function so every case has a
 * test that needs no repository.
 *
 * Removals and reductions produce nothing: they are the campaign working.
 */
export function compareBacklog(previous, current, label = 'the backlog') {
  const problems = [
    ...backlogShapeProblems(previous, `${label} at the baseline`),
    ...backlogShapeProblems(current, label),
  ];
  // A malformed count makes every comparison below meaningless rather than false,
  // so nothing is compared until the shape is sound.
  if (problems.length > 0) return problems;
  for (const [path, lines] of Object.entries(current)) {
    if (!(path in previous)) {
      problems.push(`${label} adds ${path}. The backlog records what was already over the `
        + 'limit when the standard arrived; a new entry is a new oversized file being given '
        + 'permission, which is the one thing it may never do. Split the file instead.');
      continue;
    }
    if (lines > previous[path]) {
      problems.push(`${label} raises ${path} from ${previous[path]} to ${lines}. A recorded `
        + 'count is a ceiling, not a running total — raising it to match a file that grew '
        + 'defeats the rule that the file may not grow.');
    }
  }
  return problems;
}

/** The ref to compare against, and how it was chosen. */

/**
 * A backlogged file may not be bigger than it was at the base of this change.
 *
 * The recorded count alone does not give this. Review on 2026-08-27: a file that
 * shrinks while its dated count stays put can be regrown to anything at or below
 * the snapshot — `1358 → 1200 → 1300` passes twice — so campaign progress was
 * reversible despite the may-never-grow rule.
 *
 * Comparing against the file's actual size at the base ratchets automatically and
 * needs no bookkeeping, which is why the recorded count stays what it says it is:
 * a dated record of where the campaign started, not a live ceiling somebody has
 * to remember to lower. The two rules together mean a backlogged file may never
 * exceed EITHER its 2026-08-26 size or its size on the branch it came from.
 */
export function compareBacklogSizes(previousSizes, measured, backlog) {
  const problems = [];
  for (const file of measured) {
    if (!(file.path in backlog)) continue;
    const before = previousSizes[file.path];
    if (before === undefined || file.lines === null) continue;
    if (file.lines > before) {
      problems.push(`${file.path} is ${file.lines} lines, up from ${before} at the base of this `
        + 'change. A file in the backlog may not grow — not past its recorded count, and not past '
        + 'the size it had on the branch this change came from.');
    }
  }
  return problems;
}
