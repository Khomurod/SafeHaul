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
 * edit. Which commit that is, though, is a question this repository has now
 * answered three times, and got wrong the first two:
 *
 *   1. `SOURCE_SIZE_BASE`, if set — an operator naming a commit. It clears
 *      exactly the same bar as an inferred base: a real commit, an ancestor of
 *      the head, not the head itself, and carrying a fully validated release.
 *   2. a pull request's own base commit (`GITHUB_PR_BASE_SHA`, or the merge base
 *      with `GITHUB_BASE_REF`) — what the change was proposed against, which is a
 *      definition rather than a baseline anyone chose, so it needs no validation
 *      proof. Requiring one would refuse every pull request opened while `main`
 *      is red.
 *   3. every other event — the newest ancestor carrying a fully validated
 *      release, asked of GitHub, because git cannot know whether CI ever passed
 *      on a commit.
 *   4. locally, with no event at all — the fork point with the default branch,
 *      then `HEAD~1`. Convenience only; CI never reaches it.
 *
 * **A push's own `before` is NOT in that list, and that is the second lesson.**
 * `before` is the tip of the previous push, and when that push FAILED this check,
 * comparing against it makes the tampered backlog and the regrown file look
 * unchanged — so the next push passes and `deploy-testing` ships the increment
 * that was refused. `scripts/secret-scan.mjs` has this written up for the
 * identical reason, and `scripts/resolve-deploy-base.mjs` moved off `before` after
 * a function silently failed to deploy for two merges. Using it here was a
 * mistake, found in review on 2026-08-27.
 *
 * **And an escape hatch is a bypass if nobody checks it — the third.** The
 * override existed so a manual run of `main` had an honest way past the refusal,
 * and it accepted anything that resolved: `SOURCE_SIZE_BASE=HEAD` on a dispatch
 * reported "compared against <head>" and passed, reopening the laundering path the
 * refusal was added to close. Measured. It now clears the same bar as an inferred
 * base, which is what AGENTS.md already says about the secret scanner's override.
 *
 * Whether a commit carries a validated release is the one part git cannot answer,
 * so it needs the check-runs API; `scripts/source-size-validated.mjs` asks, and
 * hands the answers here as plain functions. That is what keeps every branch
 * below synchronous and drivable from a test with no network.
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


import {
  bootstrapProblems, compareBacklog, compareBacklogSizes,
} from './source-size-direction.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
/** Shared with `source-size-validated.mjs`, which defaults `cwd` the same way. */
export const repoRootPath = repoRoot;

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * The structural bar an explicit base must clear, before anything compares it.
 *
 * Lifted from `scripts/secret-scan.mjs`'s `requireUsableBase`, and for the reason
 * recorded there: an abbreviated SHA is a different string and the same commit, so
 * everything downstream must compare the RESOLVED form. `SOURCE_SIZE_BASE=HEAD`
 * cleared the old check and produced a comparison of the head against itself.
 */
export function requireUsableBase(candidate, headSha, cwd = repoRoot) {
  if (!/^[0-9a-f]{7,40}$/i.test(candidate) && !/^[A-Za-z0-9_./~^-]+$/.test(candidate)) {
    return { ref: null, error: `${JSON.stringify(candidate)} is not a commit reference` };
  }
  const resolved = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd);
  const ref = resolved.ok ? resolved.stdout.trim() : '';
  if (!ref) return { ref: null, error: `${candidate} is not a commit in this clone` };
  if (ref === headSha) {
    return {
      ref: null,
      error: `${candidate} resolves to the head itself (${ref.slice(0, 8)}), so nothing would be `
        + 'compared. That is the manual-run laundering path this refuses to reopen',
    };
  }
  if (!git(['merge-base', '--is-ancestor', ref, headSha], cwd).ok) {
    return { ref: null, error: `${candidate} is not an ancestor of ${headSha.slice(0, 8)}` };
  }
  return { ref, error: null };
}

/**
 * The commit this change is measured against, and how it was chosen.
 *
 * `lastValidatedBase` and `overrideValidated` are injected because they are async
 * questions for GitHub, asked by the caller before this runs — which keeps every
 * branch here synchronous and drivable from a test without a network.
 */
export function resolveBaselineRef({
  env = process.env, cwd = repoRoot,
  lastValidatedBase = () => null, overrideValidated = () => false,
  automaticLookupComplete = () => true,
} = {}) {
  const headSha = git(['rev-parse', 'HEAD^{commit}'], cwd).stdout.trim();
  const override = (env.SOURCE_SIZE_BASE || '').trim();
  if (override) {
    const usable = requireUsableBase(override, headSha, cwd);
    if (!usable.ref) return { ref: null, source: 'SOURCE_SIZE_BASE', error: usable.error };
    if (!overrideValidated(usable.ref)) {
      return {
        ref: null,
        source: 'SOURCE_SIZE_BASE',
        error: `${override} does not carry a fully validated release. An override names a commit `
          + 'this check is known to have passed on; it is not a free choice of baseline, which is '
          + 'exactly how a refused increment gets laundered into a deploy',
      };
    }
    /*
     * And it may not reach BEHIND the base the run would have chosen for itself.
     *
     * `lastValidatedBase` is the NEWEST validated ancestor, so it is the strictest
     * comparison available; an override older than it widens the window back to a
     * looser recorded count, and a file regrown to that older ceiling passes. Same
     * laundering shape as the three above, one step further out. When the
     * automatic lookup found nothing — which is the refusal an override exists to
     * answer — there is nothing to be behind and this does not fire.
     *
     * "Not behind" is `automatic` being an ancestor of the override, NOT the
     * reverse. Asking the reverse only refuses a strictly older override, and
     * review on 2026-08-27 pointed out the third case: on a merge commit, a
     * validated tip of the second parent and the first-parent automatic base are
     * both ancestors of HEAD and ancestors of NEITHER each other, so an override
     * cut before a backlog reduction sailed through. Reproduced. Requiring the
     * override to CONTAIN the automatic base refuses older and incomparable alike.
     *
     * And a lookup that did not complete is not an answer of "none". Left as one,
     * a single 502 on the second request reopened the older-ceiling bypass — the
     * CLI only reports a lookup error alongside some other problem, so a clean
     * comparison against the older base exited 0. Refuse instead.
     */
    if (!automaticLookupComplete()) {
      return {
        ref: null,
        source: 'SOURCE_SIZE_BASE',
        error: `the lookup for this run's own baseline did not complete, so whether ${override} `
          + 'reaches behind it is unknown. "Could not ask" is not "there is none": a transient '
          + 'failure must not be the thing that widens the comparison',
      };
    }
    const automatic = lastValidatedBase();
    if (automatic && automatic !== usable.ref
      && !git(['merge-base', '--is-ancestor', automatic, usable.ref], cwd).ok) {
      return {
        ref: null,
        source: 'SOURCE_SIZE_BASE',
        error: `${override} does not contain ${automatic.slice(0, 8)}, which this run would have `
          + 'used on its own. An override fills in when no validated ancestor can be found; it '
          + 'does not reach past one — behind it or beside it — to a looser ceiling',
      };
    }
    return { ref: usable.ref, source: 'SOURCE_SIZE_BASE', error: null };
  }

  /*
   * A pull request's own base commit, straight from the event.
   *
   * Deliberately NOT routed through `SOURCE_SIZE_BASE`, which now demands a
   * validated release: a pull request's base is whatever the target branch's tip
   * happens to be, and requiring it to be validated would refuse every pull
   * request opened while `main` is red. What this change proposes is measured
   * against what it was proposed against — that is the definition, not a
   * baseline anyone chose.
   */
  const prBase = (env.GITHUB_PR_BASE_SHA || '').trim();
  if (prBase) {
    const usable = requireUsableBase(prBase, headSha, cwd);
    if (usable.ref) {
      const merged = git(['merge-base', usable.ref, 'HEAD'], cwd);
      const base = merged.ok ? merged.stdout.trim() : usable.ref;
      return { ref: base, source: "the pull request's base", error: null };
    }
    return { ref: null, source: "the pull request's base", error: usable.error };
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
   * Every other EVENT compares against the newest ancestor carrying a fully
   * validated release.
   *
   * Not `github.event.before`: that is the previous push's tip, and when that push
   * FAILED this check, comparing against it makes the tampered backlog and the
   * regrown file look unchanged — so the next push passes and `deploy-testing`
   * ships the increment that was refused. Not `HEAD~1` either, which after a
   * multi-commit push is inside that push. Both were measured.
   *
   * In the healthy case this changes nothing: the previous tip passed, so it IS
   * the last validated commit. It widens only where something was left
   * unverified, which is where widening is the point.
   */
  const eventName = (env.GITHUB_EVENT_NAME || '').trim();
  if (eventName) {
    const validated = lastValidatedBase();
    if (validated) {
      const usable = requireUsableBase(validated, headSha, cwd);
      if (usable.ref) {
        return { ref: usable.ref, source: 'the last validated commit', error: null };
      }
      return { ref: null, source: 'the last validated commit', error: usable.error };
    }
    return {
      ref: null,
      source: `${eventName} with nothing validated behind it`,
      error: 'no ancestor of this commit carries a fully validated release, so there is no '
        + 'baseline to compare against. That is what a re-run after a FAILED push looks like, and '
        + 'measuring from the failed tip would step over exactly what it refused. Set '
        + 'SOURCE_SIZE_BASE to a commit you know this check passed on, or fix the failing run',
    };
  }

  /*
   * No event at all, so this is a developer running the checker. The fork point
   * with the default branch answers "what does my branch change"; `HEAD~1` is what
   * remains on the default branch itself. Convenience only — CI always sets
   * GITHUB_EVENT_NAME, so it never reaches here.
   */
  for (const candidate of ['origin/main', 'origin/HEAD']) {
    const forkPoint = git(['merge-base', candidate, 'HEAD'], cwd);
    const base = forkPoint.ok ? forkPoint.stdout.trim() : '';
    if (!base) continue;
    if (base === headSha) break;
    return { ref: base, source: `merge-base with ${candidate}`, error: null };
  }

  const parent = git(['rev-parse', '--verify', '--quiet', 'HEAD~1^{commit}'], cwd);
  if (parent.ok && parent.stdout.trim()) {
    return { ref: parent.stdout.trim(), source: 'HEAD~1', error: null };
  }
  return {
    ref: null,
    source: 'HEAD~1',
    error: 'HEAD has no parent in this clone (a shallow or first commit)',
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
 * Compare, or refuse.
 *
 * @returns {{problems: string[], describe: string}} `problems` is empty when the
 *   backlog only shrank, and non-empty both when it grew and when the comparison
 *   could not be made in a run that required it.
 */
export function checkBacklogDirection({
  current, measured = [], countLines, path, requireBaseline = false,
  env = process.env, cwd = repoRoot,
  lastValidatedBase = () => null, overrideValidated = () => false,
  automaticLookupComplete = () => true,
  resolveRef = resolveBaselineRef, readAt = readBacklogAt, readSizes = readSizesAt,
} = {}) {
  const { ref, source, error } = resolveRef({
    env, cwd, lastValidatedBase, overrideValidated, automaticLookupComplete,
  });
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
    /*
     * Nothing to compare against, so this change is INTRODUCING the backlog —
     * true of the campaign's own pull request and of the push that merges it.
     * What makes that legitimate is not who chose the base but whether each entry
     * records debt the base already carried, which `bootstrapProblems` checks and
     * its comment explains. An override reaching back past the campaign's start is
     * refused before that, because it is a category error and deserves to read
     * like one rather than like a list of unjustified entries.
     */
    const at = `no backlog at ${ref.slice(0, 8)} (${source})`;
    const entries = Object.keys(current).length;
    if (source === 'SOURCE_SIZE_BASE' && entries > 0) {
      return {
        problems: [`${ref.slice(0, 8)} predates ${path}, so an override naming it would have the `
          + `current backlog's ${entries} ${entries === 1 ? 'entry' : 'entries'} judged against a `
          + 'commit the campaign never ran on. An override cannot reach behind its start'],
        describe: `${at} — refused as an override`,
      };
    }
    if (entries === 0) return { problems: [], describe: `${at}, and nothing recorded yet` };
    if (!countLines) {
      // Without it the base cannot be measured, so every entry would be taken on
      // trust — the exact thing this branch was found doing.
      const why = `${at}, and no way to measure it`;
      return { problems: requireBaseline ? [`${why}, so the entries cannot be justified`] : [], describe: why };
    }
    const sizes = readSizes(ref, Object.keys(current), { cwd, countLines });
    const problems = bootstrapProblems(sizes, current, ref, path);
    if (problems.length === 0) problems.push(...compareBacklogSizes(sizes, measured, current));
    return { problems, describe: `${at} — every entry checked against it` };
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
