/**
 * `.claude/rules/testing.md`, "Jest under functions/": `jest.clearAllMocks()`
 * resets call records and leaves a queued `*Once` value in place, so a test that
 * queues one it never consumes leaks it into the next test. This refuses any
 * test file that pairs the two, in its own code or in a module under
 * `functions/test/` that it requires: twenty suites once cleared through
 * `applicationDrafts.support.js` and queued in their own files.
 *
 * Scope comes from `git ls-files`, not a directory walk, so a file cannot escape
 * by being moved. The needle is assembled so this file does not itself contain
 * the string it forbids.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLEAR_ALL = 'jest.clear' + 'AllMocks()';
const ONCE_QUEUE = /mock(?:Resolved|Rejected|Return)ValueOnce\(|mockImplementationOnce\(/;
const LOCAL_REQUIRE = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sources = new Map(
    execFileSync('git', ['ls-files', '-z', 'functions/test'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter((file) => file.endsWith('.js'))
        .map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]),
);

/** The file and every module under `functions/test/` it requires, directly or not. */
function withSupport(file) {
    const seen = new Set();
    const pending = [file];
    while (pending.length) {
        const next = pending.pop();
        if (seen.has(next)) continue;
        seen.add(next);
        for (const [, request] of sources.get(next).matchAll(LOCAL_REQUIRE)) {
            const base = path.posix.join(path.posix.dirname(next), request);
            const found = [base, `${base}.js`, `${base}/index.js`].find((candidate) => sources.has(candidate));
            if (found) pending.push(found);
        }
    }
    return [...seen];
}

describe('mock reset hygiene', () => {
    const testFiles = [...sources.keys()].filter((file) => file.endsWith('.test.js'));

    it('reads the suites and the support modules they require', () => {
        // A filter or a resolver that silently matched nothing would read exactly
        // like a clean tree.
        expect(testFiles.length).toBeGreaterThan(150);
        const reachingSupport = testFiles.filter((file) => withSupport(file).some((module) => module.endsWith('.support.js')));
        expect(reachingSupport.length).toBeGreaterThan(40);
    });

    it('no test file pairs jest.clearAllMocks with a *Once queue, through its support modules either', () => {
        const offenders = testFiles.filter((file) => {
            const code = withSupport(file).map((module) => sources.get(module));
            return code.some((text) => text.includes(CLEAR_ALL)) && code.some((text) => ONCE_QUEUE.test(text));
        });
        expect(offenders).toEqual([]);
    });
});
