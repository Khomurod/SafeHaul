#!/usr/bin/env node
/**
 * What does GitHub say has actually been validated?
 *
 * The one question about the baseline that git cannot answer. Whether a commit
 * carries a fully validated release is a fact about CI runs, so it needs the
 * check-runs API, and asking it is the only asynchronous, networked, credentialed
 * part of the size guard. Split out of `scripts/source-size-baseline.mjs` on
 * 2026-08-27, when that file crossed 400 lines doing three jobs: choose a ref
 * from git, read the backlog at it, and ask GitHub about it. This is the third.
 *
 * `scripts/source-size.mjs` calls this once, before the synchronous resolution
 * runs, and hands the answers to `checkBacklogDirection` as plain functions —
 * which is what keeps every branch of `resolveBaselineRef` drivable from a test
 * with no network.
 */

/*
 * "The newest ancestor carrying a fully validated release" is a release-system
 * question, not a secret-scanning one; it lives in the scanner because that is
 * where it was first needed. Reusing it rather than inventing a second notion of
 * "validated" is deliberate — two definitions would disagree eventually, and this
 * one is already tested against stubbed check-runs responses.
 */
export { findLastValidatedAncestor, isValidatedRelease } from './secret-scan.mjs';
import { findLastValidatedAncestor, isValidatedRelease } from './secret-scan.mjs';


import { requireUsableBase, repoRootPath } from './source-size-baseline.mjs';

/**
 * Ask GitHub what it has to be asked, before the synchronous resolution runs.
 *
 * Kept here rather than in the CLI because "which commit is a trustworthy base"
 * is this module's question in both its halves — the structural bar and the
 * validated-release proof. The CLI just reports what comes back.
 *
 * A pull request needs none of this: its base is what the change was proposed
 * against, which git already knows.
 *
 * @returns {Promise<{lastValidatedBase: () => string|null,
 *                    overrideValidated: () => boolean, error: string|null}>}
 */
export async function resolveValidatedBaseline({
  env = process.env, cwd = repoRootPath, headSha, log = () => {},
  lookupAncestor = findLastValidatedAncestor, lookupOne = isValidatedRelease,
} = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const eventName = (env.GITHUB_EVENT_NAME || '').trim();
  const override = (env.SOURCE_SIZE_BASE || '').trim();
  const none = { lastValidatedBase: () => null, overrideValidated: () => false, error: null };

  if (override) {
    const usable = requireUsableBase(override, headSha, cwd);
    // A structurally unusable override is refused by `resolveBaselineRef` with a
    // better message than "not validated"; do not spend a request on it.
    if (!usable.ref) return none;
    const check = await lookupOne({ sha: usable.ref, repository, token });
    log(`override   : ${usable.ref.slice(0, 8)} — `
      + `${check.validated ? 'validated release' : 'NOT a validated release'}`
      + `${check.error ? ` (${check.error})` : ''}`);
    /*
     * Asked even though the override wins, because `resolveBaselineRef` needs to
     * know whether the override is reaching behind a stricter base that was there
     * for the taking. One extra request on a manual run only.
     */
    const behind = await lookupAncestor({ headSha, cwd, repository, token });
    return {
      lastValidatedBase: () => behind.sha,
      overrideValidated: () => check.validated,
      // `sha: null, error: null` means "asked, and nothing is validated". With an
      // error it means "could not ask", and the two must not fail the same way.
      automaticLookupComplete: () => !behind.error,
      error: check.error || behind.error,
    };
  }

  const asksGitHub = eventName && eventName !== 'pull_request' && eventName !== 'pull_request_target'
    && !(env.GITHUB_PR_BASE_SHA || '').trim();
  if (!asksGitHub) return none;

  const lookup = await lookupAncestor({ headSha, cwd, repository, token });
  log(`validated  : ${lookup.sha ? lookup.sha.slice(0, 8) : 'none found'}`
    + ` (asked about ${lookup.checked} ancestor(s)${lookup.error ? `; ${lookup.error}` : ''})`);
  return { ...none, lastValidatedBase: () => lookup.sha, error: lookup.error };
}

