/**
 * Sentry is switched off (owner decision, `docs/performance-plan/T5b-sentry-off.md`):
 * nothing under `src/` imports or mocks the SDK, and no package of it is
 * installed. A half-done removal, or an import added back later, fails here.
 *
 * Scope comes from `git ls-files`, as in `mockResetHygiene.test.js`, with
 * untracked files included so a new file is caught before it is committed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const THIS_FILE = 'src/tests/noSentry.test.js';
const SDK_USE = [
    /\bfrom\s*['"]@sentry\//,
    /\bimport\(\s*['"]@sentry\//,
    /\bvi\.mock\(\s*['"]@sentry\//,
];

function repoRoot() {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function sourceFiles(root) {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && path !== THIS_FILE);
    return [...new Set(listed)].filter((path) => existsSync(resolve(root, path)));
}

describe('Sentry is switched off', () => {
    it('no file under src/ imports or mocks @sentry/*', () => {
        const root = repoRoot();
        const files = sourceFiles(root);
        // A filter that matched nothing would read exactly like a clean tree.
        expect(files.length).toBeGreaterThan(1000);

        const offenders = files.filter((path) => {
            const source = readFileSync(resolve(root, path), 'utf8');
            return SDK_USE.some((pattern) => pattern.test(source));
        });

        expect(offenders, `these files still use the Sentry SDK:\n  ${offenders.join('\n  ')}`).toEqual([]);
    });

    it('no @sentry/* package is a dependency or in the lockfile', () => {
        const root = repoRoot();
        const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
        const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
        expect(declared.filter((name) => name.startsWith('@sentry/'))).toEqual([]);

        const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
        expect(Object.keys(lock.packages).filter((path) => path.includes('node_modules/@sentry/'))).toEqual([]);
    });
});
