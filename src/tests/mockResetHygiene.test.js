/**
 * AGENTS.md, "Local test-runner process safety", rule 6: `vi.clearAllMocks()`
 * resets call records and leaves queued `*Once` values in place, so a test that
 * queues one its component never consumes leaks it into the next test. That
 * cost a real CI failure on 2026-08-26, and the 2026-09-06 audit found the same
 * pairing in 23 more files. All were converted to `vi.resetAllMocks()` in one
 * change; this test keeps the family closed by refusing any test file under
 * `src/` that pairs the two again.
 *
 * Scope comes from `git ls-files`, not a directory walk, for the reason the
 * source-size checker gives: a file cannot escape by being moved. The needle is
 * assembled so this file does not itself contain the string it forbids.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLEAR_ALL = 'vi.clear' + 'AllMocks()';
const ONCE_QUEUE = /mock(?:Resolved|Rejected|Return)ValueOnce\(|mockImplementationOnce\(/;

function repoRoot() {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function trackedTestFiles(root) {
    return execFileSync('git', ['ls-files', '-z', 'src'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
}

describe('mock reset hygiene', () => {
    it('no test file under src/ pairs vi.clearAllMocks with a *Once queue', () => {
        const root = repoRoot();
        const files = trackedTestFiles(root);
        // The scan must still be looking at something; a filter that silently
        // matched nothing would read exactly like a clean tree.
        expect(files.length).toBeGreaterThan(200);

        const offenders = files.filter((path) => {
            const source = readFileSync(resolve(root, path), 'utf8');
            return source.includes(CLEAR_ALL) && ONCE_QUEUE.test(source);
        });

        expect(
            offenders,
            `these files queue a *Once value but only clear mocks; use vi.resetAllMocks() (AGENTS.md rule 6):\n  ${offenders.join('\n  ')}`,
        ).toEqual([]);
    });
});
