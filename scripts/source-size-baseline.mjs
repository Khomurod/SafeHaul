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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * The two directions that are forbidden, as a pure function so every case has a
 * test that needs no repository.
 *
 * Removals and reductions produce nothing: they are the campaign working.
 */
export function compareBacklog(previous, current, label = 'the backlog') {
  const problems = [];
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
 * Compare, or refuse.
 *
 * @returns {{problems: string[], describe: string}} `problems` is empty when the
 *   backlog only shrank, and non-empty both when it grew and when the comparison
 *   could not be made in a run that required it.
 */
export function checkBacklogDirection({
  current, path, requireBaseline = false, env = process.env, cwd = repoRoot,
  resolveRef = resolveBaselineRef, readAt = readBacklogAt,
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

  return {
    problems: compareBacklog(previous.files, current, path),
    describe: `compared against ${ref.slice(0, 8)} (${source})`,
  };
}
