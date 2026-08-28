/**
 * The git questions the secret scanner asks, and how a SHA is printed.
 *
 * Small on purpose, and separate on purpose: `range.mjs` takes this object as an
 * argument so `scripts/secret-scan/test-range.mjs` can drive range selection
 * against real throwaway repositories without a GitHub event in sight. A test
 * that reimplements these gets to be wrong in a way the gate is not — the first
 * version of that test did exactly that, reading `git cat-file -e` (which prints
 * nothing on success) as "commit missing".
 */

import { spawnSync } from 'node:child_process';

/** The first eight characters, which is how every message in here names a commit. */
export const short = (sha) => String(sha || '').slice(0, 8);

/**
 * The git questions the plan needs, as booleans and SHAs.
 *
 * Exported so `scripts/secret-scan/test-range.mjs` drives range selection through the
 * same plumbing CI uses. A test that reimplements these gets to be wrong in a
 * way the gate is not — the first version of that test did exactly that, reading
 * `git cat-file -e` (which prints nothing on success) as "commit missing".
 */
export const gitRunner = (cwd) => ({
    exists: (sha) => run('git', ['cat-file', '-e', `${sha}^{commit}`], cwd).ok,
    isAncestor: (a, b) => run('git', ['merge-base', '--is-ancestor', a, b], cwd).ok,
    mergeBase: (a, b) => {
        const result = run('git', ['merge-base', a, b], cwd);
        return result.ok ? result.stdout.trim() : null;
    },
    resolve: (ref) => {
        const result = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
        return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    },
});

export function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    return {
        ok: result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}
