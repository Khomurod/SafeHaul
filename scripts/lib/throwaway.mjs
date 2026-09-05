/**
 * Removing a throwaway git repository, without racing git.
 *
 * ## The failure this exists for
 *
 * `callable-contract` failed on 2026-09-05 with
 *
 *     Error: ENOTEMPTY: directory not empty, rmdir '/tmp/safehaul-ui-invent-…/.git'
 *
 * in the cleanup of a guard's own test harness — after every assertion in that
 * harness had passed. Nothing was wrong with the code under test; the gate went
 * red because a temp directory would not delete.
 *
 * Two causes, and both are fixed here rather than in the caller:
 *
 * 1. **git works in the background.** A repository that has taken commits can
 *    fire `git gc --auto`, which writes into `.git` after the command that
 *    triggered it has returned. On a loaded runner that write lands in the
 *    middle of the recursive delete. `initThrowawayRepo` turns automatic
 *    maintenance off, so a throwaway repo never starts any.
 * 2. **`force: true` does not mean "keep trying".** It suppresses `ENOENT` and
 *    nothing else — an `ENOTEMPTY` from a concurrent write still throws. Node's
 *    own rimraf retries on exactly that class of error, but only when asked.
 *
 * ## Why it is shared rather than patched where it broke
 *
 * Four test harnesses and the secret scanner itself build throwaway git
 * repositories and delete them. One of them failed; all five had the same
 * shape. This repository's own rule for a CI bug is to list every job with that
 * shape *before* fixing one, because patching the instance in front of you is
 * how one root cause becomes three separate rounds — which is written down in
 * `CLAUDE.md` after it happened three times in one day.
 *
 * `scripts/test-ui-contract-scope.mjs` §S10 asserts no recursive `rmSync` in
 * `scripts/` is written without retries, so the next harness cannot reintroduce
 * it by copying an older one.
 */

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * Delete a directory tree, retrying the transient errors a concurrent writer
 * causes (`ENOTEMPTY`, `EBUSY`, `EPERM`, `EMFILE`, `ENFILE`).
 *
 * Half a second of retries in total: long enough to outlast a stray git write,
 * short enough that a genuinely undeletable path still fails the run rather
 * than hanging it.
 */
export function removeTree(dir) {
    rmSync(dir, {
        recursive: true, force: true, maxRetries: 10, retryDelay: 50,
    });
}

/**
 * `git init` for a repository that exists only for the length of one test.
 *
 * The identity is fixed so a commit works on a runner with no global git
 * config, signing is off so a developer's own `commit.gpgsign` cannot hang the
 * suite, and automatic maintenance is off so nothing writes into `.git` after
 * the last command returns.
 *
 * @param {string} dir an existing empty directory
 * @returns {(...args: string[]) => string} a `git` runner bound to that directory
 */
export function initThrowawayRepo(dir) {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tests@safehaul.invalid');
    git('config', 'user.name', 'SafeHaul tests');
    git('config', 'commit.gpgsign', 'false');
    // No background writes into `.git` after a command returns. See the header.
    git('config', 'gc.auto', '0');
    git('config', 'maintenance.auto', 'false');
    return git;
}
