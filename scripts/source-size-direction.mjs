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
 *
 * `unit` names what is being counted, because this ratchet is shared: the icon
 * campaign counts glyph imports through the same code, and a refusal reading
 * "is 9 lines, up from 4" about an import count names something that was never
 * measured. It defaults to `lines`, so the size campaign is untouched.
 */
export function compareBacklogSizes(previousSizes, measured, backlog, unit = 'lines') {
  const problems = [];
  for (const file of measured) {
    if (!(file.path in backlog)) continue;
    const before = previousSizes[file.path];
    if (before === undefined || file.lines === null) continue;
    if (file.lines > before) {
      problems.push(`${file.path} is ${file.lines} ${unit}, up from ${before} at the base of this `
        + 'change. A file in the backlog may not grow — not past its recorded count, and not past '
        + 'the size it had on the branch this change came from.');
    }
  }
  return problems;
}

/**
 * The one moment the backlog has no previous copy, and what can still be checked.
 *
 * When `git show` finds no backlog at the base, the change under test is
 * INTRODUCING it, so every entry is new and `compareBacklog` has nothing to
 * compare. The first version of this treated that as "the campaign starts here"
 * and returned no problems at all — which review on 2026-08-27 showed was a
 * bypass reachable two ways, both reproduced:
 *
 *   - an operator naming a validated pre-campaign commit in `SOURCE_SIZE_BASE`;
 *   - and, with no override at all, the push AFTER a bootstrap that failed some
 *     unrelated required job. That bootstrap never became a validated release, so
 *     the next push's newest validated ancestor is still pre-campaign — and it
 *     could add a 9000-line file with its own entry, pass, and deploy once the
 *     unrelated failure was fixed.
 *
 * The second one is why the refusal cannot live in "was the base chosen by an
 * operator". What makes a bootstrap legitimate is not who picked the base: it is
 * that every entry records debt **that was already there**. That is a fact about
 * the base commit, which the change under test cannot edit, so it can be checked:
 *
 *   1. the file must exist at the base — an entry for a file this change creates
 *      is a new exemption wearing the campaign's clothes;
 *   2. its recorded count may not exceed its size at the base — otherwise a file
 *      that grew THROUGH the limit on this branch could be recorded at its new
 *      size and inherit the exemption.
 *
 * Deliberately no reference to the hard limit here. An entry naming a file that
 * is comfortably under it is already refused by `evaluate`'s "a listed file that
 * comes back under must be removed", so restating the limit would add a constant
 * to keep in step for nothing.
 */
export function bootstrapProblems(sizesAtBase, current, ref, label = 'the backlog', unit = 'lines') {
  // Same reason `compareBacklog` opens this way: `lines > before` is false for a
  // NaN, so `{"big.js": "unbounded"}` would sail past the second rule below with
  // nothing reported. `evaluate` also refuses it, but a rule that only holds
  // because some other caller checks first is not a rule this module has.
  const problems = backlogShapeProblems(current, label);
  if (problems.length > 0) return problems;
  const at = ref.slice(0, 8);
  for (const [path, lines] of Object.entries(current ?? {})) {
    const before = sizesAtBase[path];
    if (before === undefined) {
      problems.push(`${label} records ${path}, which does not exist at ${at} — the base this `
        + 'bootstrap is measured against. The campaign records debt that was already there, so an '
        + 'entry for a file the change itself adds is a new exemption, not a record of one.');
      continue;
    }
    if (lines > before) {
      problems.push(`${label} records ${path} at ${lines} ${unit}, but it was ${before} at ${at}. `
        + 'An entry may only record how big a file already was; recording the size it grew to '
        + 'would let a file cross the limit and be exempted in the same change.');
    }
  }
  return problems;
}
