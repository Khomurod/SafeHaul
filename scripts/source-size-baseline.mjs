#!/usr/bin/env node
/**
 * Which direction did the backlog move?
 *
 * ## The hole this closes
 *
 * `.github/source-size-backlog.json` records the files that were already over the
 * limit when the standard arrived, and `scripts/source-size.mjs` enforces three
 * rules against it: an unlisted file may not exceed the limit, a listed file may
 * not grow past its recorded count, and a listed file that comes back under the
 * limit must be removed.
 *
 * Review on 2026-08-27 pointed out that all three are enforced against the
 * backlog **in the branch under test**, which the branch under test may edit. So a
 * change could add a 900-line file together with `{"src/new.js": 900}`, or grow a
 * listed file and raise its recorded count to match, and the checker would report
 * success. The campaign rules were documented as "a campaign, not an allowlist",
 * and without this the enforcement was exactly the mutable allowlist they
 * prohibit.
 *
 * It is the same lesson `scripts/secret-scan.mjs` was built on and it is worth
 * stating once more: **a gate must not take its scope from the branch it is
 * gating.** `.gitleaks.toml` is pinned line for line for this reason. The backlog
 * cannot be pinned that way — it is meant to change on nearly every PR of the
 * campaign — so what is pinned is the DIRECTION: entries may leave and counts may
 * fall; nothing may be added and no count may rise.
 *
 * ## Where the previous version comes from
 *
 * Git, at the base of the change, because that is the one copy the change cannot
 * edit. The ref is chosen explicitly rather than inferred from a payload:
 *
 *   1. `SOURCE_SIZE_BASE`, if set — an operator naming a ref.
 *   2. `GITHUB_BASE_REF` on a pull request — the merge base with that branch, so
 *      the comparison is what this change proposes and never the base branch's
 *      own later history.
 *   3. `HEAD^`, which is the previous tip on a push and the previous commit
 *      locally.
 *
 * The backlog's path is a parameter rather than an import, so this module knows
 * nothing about `scripts/source-size.mjs` and that one can import it statically
 * without the two forming a cycle.
 *
 * A run that cannot resolve any of them **refuses when `--require-baseline` is
 * passed**, which CI does, and otherwise says the comparison was skipped and why.
 * The split matters: a contributor's shallow or fresh clone may genuinely have no
 * base, and making `npm run check:source-size` unusable there would get the whole
 * check removed. In CI, where tampering is the concern, there is no skip path.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Events that re-verify a commit already on the branch rather than proposing one. */
const REVERIFICATION_EVENTS = Object.freeze(['workflow_dispatch', 'schedule', 'repository_dispatch']);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

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
export function resolveBaselineRef({ env = process.env, cwd = repoRoot } = {}) {
  const override = (env.SOURCE_SIZE_BASE || '').trim();
  if (override) {
    const resolved = git(['rev-parse', '--verify', '--quiet', `${override}^{commit}`], cwd);
    if (!resolved.ok || !resolved.stdout.trim()) {
      return { ref: null, source: 'SOURCE_SIZE_BASE', error: `${override} is not a commit here` };
    }
    return { ref: resolved.stdout.trim(), source: 'SOURCE_SIZE_BASE', error: null };
  }

  const baseRef = (env.GITHUB_BASE_REF || '').trim();
  if (baseRef) {
    const merged = git(['merge-base', `origin/${baseRef}`, 'HEAD'], cwd);
    if (merged.ok && merged.stdout.trim()) {
      return { ref: merged.stdout.trim(), source: `merge-base with origin/${baseRef}`, error: null };
    }
    return {
      ref: null,
      source: `merge-base with origin/${baseRef}`,
      error: merged.stderr.trim() || 'no merge base; is the checkout deep enough?',
    };
  }

  /*
   * `HEAD~1`, and the `^{commit}` peel is on the PARENT deliberately.
   *
   * The first version of this asked for `HEAD^{commit}`, which is not the parent
   * at all — it is "peel HEAD to a commit object", so it resolved to HEAD itself
   * and every push compared the backlog against its own commit. Trivially equal,
   * and therefore a check that could never fail. Caught by printing the resolved
   * SHA and noticing it was the head.
   */
  /*
   * The fork point, for a branch being verified without a pull-request event.
   *
   * `merge-base` answers "where did this branch leave the default branch", which
   * is the same question `GITHUB_BASE_REF` answers above. This is load-bearing
   * rather than a nicety: a `workflow_dispatch` run of a feature branch used to
   * fall through to `HEAD~1`, which compares a commit against the one before it
   * INSIDE the same change — so a branch that legitimately records a backlog
   * entry in one commit stands accused of adding one. Measured on this very
   * branch, whose first commit records the whole backlog: it refused three
   * entries that its base does not have at all.
   *
   * When HEAD is ON the default branch the merge base is HEAD itself, which would
   * compare the backlog against its own commit — so that case falls through.
   */
  for (const candidate of ['origin/main', 'origin/HEAD']) {
    const forkPoint = git(['merge-base', candidate, 'HEAD'], cwd);
    const base = forkPoint.ok ? forkPoint.stdout.trim() : '';
    if (!base) continue;
    if (base === git(['rev-parse', 'HEAD^{commit}'], cwd).stdout.trim()) break;
    return { ref: base, source: `merge-base with ${candidate}`, error: null };
  }

  /*
   * A manual or scheduled run of the default branch has no honest `HEAD~1`.
   *
   * Found in review on 2026-08-27 and reproduced. `workflow_dispatch` on
   * `refs/heads/main` DEPLOYS (see `deploy-testing`'s `if:`), and a dispatch
   * lands here only when the fork point is the head — i.e. on the default
   * branch. `HEAD~1` is then the commit before the tip, which after a
   * multi-commit push is INSIDE the push: measured `1200 → 1300 → unrelated
   * tip`, where the dispatch compared 1300 against 1300 and passed, while the
   * push run anchored at 1200 refused the regrowth. So a red push could be
   * laundered into a green deploy by pressing "Run workflow".
   *
   * This is the same hole `scripts/secret-scan.mjs` was built to close — it used
   * to anchor a re-verification at `head^1` on the reasoning that every earlier
   * commit was already scanned, which assumes the earlier scan PASSED. Refusing
   * is the answer there and it is the answer here: a re-verification that cannot
   * say what it is comparing against has not verified anything. The operator
   * names the base, and `main.yml` offers `source_size_base` for it.
   */
  const eventName = (env.GITHUB_EVENT_NAME || '').trim();
  if (REVERIFICATION_EVENTS.includes(eventName)) {
    return {
      ref: null,
      source: `${eventName} on the default branch`,
      error: 'a manual or scheduled run has no change to measure against, and HEAD~1 after a '
        + 'multi-commit push is inside that push — so it would pass a regrowth the push itself '
        + 'refused. Set SOURCE_SIZE_BASE (the workflow offers a `source_size_base` input) to the '
        + 'last commit you know this check passed on',
    };
  }

  const parent = git(['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}'], cwd);
  if (parent.ok && parent.stdout.trim()) {
    return { ref: parent.stdout.trim(), source: 'HEAD~1', error: null };
  }
  return {
    ref: null,
    source: 'HEAD~1',
    error: parent.stderr.trim() || 'HEAD has no parent in this clone (a shallow or first commit)',
  };
}

/**
 * The backlog as committed at `ref`.
 *
 * `absent` is not an error: the commit that INTRODUCES the backlog has no earlier
 * copy to be compared against, and that is the only situation in which every
 * entry is legitimately new.
 */
export function readBacklogAt(ref, { cwd = repoRoot, path } = {}) {
  const shown = git(['show', `${ref}:${path}`], cwd);
  if (!shown.ok) return { files: null, absent: true, error: null };
  try {
    return { files: JSON.parse(shown.stdout).files || {}, absent: false, error: null };
  } catch (error) {
    return { files: null, absent: false, error: `unreadable at ${ref}: ${error.message}` };
  }
}

/**
 * How big each of these files was at `ref`.
 *
 * `countLines` is injected rather than imported so this module stays free of any
 * dependency on `scripts/source-size.mjs` — which imports it, and would otherwise
 * form a cycle. Files absent at `ref` are simply omitted: a path that did not
 * exist there cannot have grown, and a backlog entry for one is caught as an
 * addition instead.
 */
export function readSizesAt(ref, paths, { cwd = repoRoot, countLines } = {}) {
  const sizes = {};
  for (const path of paths) {
    const shown = git(['show', `${ref}:${path}`], cwd);
    if (shown.ok) sizes[path] = countLines(shown.stdout);
  }
  return sizes;
}

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

/**
 * Compare, or refuse.
 *
 * @returns {{problems: string[], describe: string}} `problems` is empty when the
 *   backlog only shrank, and non-empty both when it grew and when the comparison
 *   could not be made in a run that required it.
 */
export function checkBacklogDirection({
  current, measured = [], countLines, path, requireBaseline = false,
  env = process.env, cwd = repoRoot,
  resolveRef = resolveBaselineRef, readAt = readBacklogAt, readSizes = readSizesAt,
} = {}) {
  const { ref, source, error } = resolveRef({ env, cwd });
  if (!ref) {
    const why = `no baseline to compare the backlog against (${source}: ${error})`;
    if (requireBaseline) {
      return {
        problems: [`${why}. This run was asked to prove the backlog did not grow and cannot, so it `
          + 'refuses rather than pass on an unverified backlog. Fetch enough history, or set '
          + 'SOURCE_SIZE_BASE to a commit to compare against.'],
        describe: why,
      };
    }
    return { problems: [], describe: `${why} — comparison skipped (not required for this run)` };
  }

  const previous = readAt(ref, { cwd, path });
  if (previous.error) {
    return {
      problems: requireBaseline ? [`the backlog at ${ref.slice(0, 8)} could not be read: ${previous.error}`] : [],
      describe: `backlog at ${ref.slice(0, 8)} unreadable: ${previous.error}`,
    };
  }
  if (previous.absent) {
    return { problems: [], describe: `no backlog at ${ref.slice(0, 8)} (${source}) — the campaign starts here` };
  }

  const problems = compareBacklog(previous.files, current, path);
  /*
   * The per-file ratchet needs a sound backlog to know which paths to ask about,
   * so it runs only once the direction check is happy.
   */
  if (problems.length === 0 && countLines) {
    const backlogged = Object.keys(current);
    problems.push(...compareBacklogSizes(
      readSizes(ref, backlogged, { cwd, countLines }), measured, current,
    ));
  }
  return { problems, describe: `compared against ${ref.slice(0, 8)} (${source})` };
}
