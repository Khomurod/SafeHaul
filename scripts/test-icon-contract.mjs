#!/usr/bin/env node
/**
 * Tests for `check:icon-contract`.
 *
 * Run with `npm run test:icon-contract`. Exit 0 = all pass.
 *
 * §I is the pure rule set, driven on fixtures rather than on the repository's own
 * 178 entries — a test that reads the live backlog passes for whatever the
 * backlog happens to say.
 *
 * §J is the part that matters, and it is the same lesson three of this
 * repository's guards were each built on: **a gate must not take its scope from
 * the branch it is gating.** Every case in §J is reproduced against a real
 * throwaway repository, because a pure comparison cannot catch a wrong ref — the
 * size guard's first version asked for `HEAD^{commit}`, which peels HEAD to a
 * commit rather than naming its parent, so every push compared the inventory
 * against itself and could never fail.
 *
 * Plain assertions, no external runner, matching `test-source-size-baseline.mjs`
 * and `test-ui-contract-baseline.mjs`. Each assertion names the mutation that
 * turns it red.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkBacklogDirection } from './source-size-baseline.mjs';
import {
    BACKLOG_PATH, countLucideImports, hasUncountableImport, isGoverned,
} from './icon-contract/scope.mjs';
import { backlogShapeProblems, evaluate } from './icon-contract/evaluate.mjs';
import { initThrowawayRepo, removeTree } from './lib/throwaway.mjs';

let failures = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOTS = [
    { path: 'src/features/a.jsx', imports: 0, uncountable: false },
    { path: 'src/shared/b.jsx', imports: 0, uncountable: false },
    { path: 'src/design-system/c.jsx', imports: 0, uncountable: false },
];
const withRoots = (...files) => [...ROOTS, ...files];
const fired = (result, needle) => result.problems.some((p) => p.includes(needle));

console.log('\nI. the rules, on fixtures');

{
    const r = evaluate(withRoots({ path: 'src/features/new.jsx', imports: 3, uncountable: false }), {});
    assert('I1. an unlisted file importing lucide is refused',
        !r.ok && fired(r, 'may not name the package'),
        JSON.stringify(r.problems));
}
{
    const r = evaluate(withRoots({ path: 'src/features/x.jsx', imports: 5, uncountable: false }),
        { 'src/features/x.jsx': 4 });
    assert('I2. a listed file whose count rose is refused',
        !r.ok && fired(r, 'may not grow'));
}
{
    const r = evaluate(withRoots({ path: 'src/features/x.jsx', imports: 2, uncountable: false }),
        { 'src/features/x.jsx': 4 });
    assert('I3. a listed file that shrank is fine — the list is a ratchet', r.ok,
        JSON.stringify(r.problems));
}
{
    const r = evaluate(withRoots({ path: 'src/features/x.jsx', imports: 0, uncountable: false }),
        { 'src/features/x.jsx': 4 });
    assert('I4. a listed file at zero must lose its entry',
        !r.ok && fired(r, 'only shrinks'));
}
{
    const r = evaluate(withRoots(), { 'src/features/gone.jsx': 4 });
    assert('I5. an entry for a path that does not exist is refused',
        !r.ok && fired(r, 'does not carry its exemption'));
}
{
    const r = evaluate(withRoots({ path: 'src/features/x.jsx', imports: 9, uncountable: false }),
        { 'src/features/x.jsx': 'unbounded' });
    assert('I6. a count that is not a count is refused before anything is compared',
        !r.ok && fired(r, 'non-negative integer') && r.problems.length === 1,
        JSON.stringify(r.problems));
}
{
    const r = evaluate(withRoots({ path: 'src/features/x.jsx', imports: 0, uncountable: true }), {});
    assert('I7. a namespace import is refused rather than scored zero',
        !r.ok && fired(r, 'without a name list'));
}
{
    const r = evaluate([{ path: 'src/features/a.jsx', imports: 0, uncountable: false }], {});
    assert('I8. a scan that stopped covering a root refuses',
        !r.ok && fired(r, 'stopped covering'));
}
{
    assert('I9. a negative count is refused too',
        backlogShapeProblems({ 'a.jsx': -1 }).length === 1);
    assert('I10. an array is not a backlog',
        backlogShapeProblems([]).length === 1);
}

console.log('\nJ. what is counted, and where');

assert('J1. named imports are counted',
    countLucideImports("import { A, B, C } from 'lucide-react';") === 3);
assert('J2. an aliased name is one name',
    countLucideImports("import { A as B } from 'lucide-react';") === 1);
assert('J3. two statements add up',
    countLucideImports("import { A } from 'lucide-react';\nimport { B, C } from 'lucide-react';") === 3);
assert('J4. prose naming the package is not an import',
    countLucideImports(' * 178 files import from `lucide-react` today.') === 0,
    'a substring search would have counted `Icon.jsx`’s own docstring as the offence');
assert('J5. a namespace import is flagged, not counted',
    hasUncountableImport("import * as icons from 'lucide-react';")
    && countLucideImports("import * as icons from 'lucide-react';") === 0);
assert('J6. a default import is flagged too',
    hasUncountableImport("import icons from 'lucide-react';"));
assert('J7. a named import is not flagged as uncountable',
    !hasUncountableImport("import { A } from 'lucide-react';"));
assert('J8. the contract directory is exempt',
    !isGoverned('src/design-system/icons/glyphs.js')
    && !isGoverned('src/design-system/icons/Icon.test.jsx'));
assert('J9. a file just outside it is governed',
    isGoverned('src/design-system/icon-helpers.js')
    && isGoverned('src/design-system/stories/Badge.stories.jsx'),
    'the exemption is the directory, not the word "icon"');
assert('J10. non-source files are not scanned',
    !isGoverned('src/design-system/icons/README.md') && !isGoverned('docs/APP_BRIEF.md'));

console.log('\nK. the direction, against real history');

const commit = (git, dir, files, message) => {
    for (const [path, body] of Object.entries(files)) {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), body);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
};
const backlogJson = (files) => JSON.stringify({ files }, null, 2);
const glyphFile = (n) => `import { ${Array.from({ length: n }, (_, i) => `G${i}`).join(', ')} } from 'lucide-react';\n`;

const dir = mkdtempSync(join(tmpdir(), 'safehaul-icon-base-'));
try {
    const git = initThrowawayRepo(dir);
    const base = commit(git, dir, {
        'src/features/x.jsx': glyphFile(4),
        [BACKLOG_PATH]: backlogJson({ 'src/features/x.jsx': 4 }),
    }, 'base');

    // The bypass: raise the file AND its recorded count in one change.
    commit(git, dir, {
        'src/features/x.jsx': glyphFile(9),
        [BACKLOG_PATH]: backlogJson({ 'src/features/x.jsx': 9 }),
    }, 'grow both');

    const grown = checkBacklogDirection({
        current: { 'src/features/x.jsx': 9 },
        measured: [{ path: 'src/features/x.jsx', lines: 9 }],
        countLines: countLucideImports,
        path: BACKLOG_PATH,
        requireBaseline: true,
        cwd: dir,
        env: { GITHUB_EVENT_NAME: 'push' },
        lastValidatedBase: () => base,
    });
    assert('K1. raising a count from inside the change is refused',
        grown.problems.length > 0,
        JSON.stringify(grown.problems));

    // A brand-new file arriving with its own entry.
    commit(git, dir, {
        'src/features/new.jsx': glyphFile(6),
        [BACKLOG_PATH]: backlogJson({ 'src/features/x.jsx': 4, 'src/features/new.jsx': 6 }),
    }, 'new file with its own entry');
    const added = checkBacklogDirection({
        current: { 'src/features/x.jsx': 4, 'src/features/new.jsx': 6 },
        measured: [{ path: 'src/features/x.jsx', lines: 4 }, { path: 'src/features/new.jsx', lines: 6 }],
        countLines: countLucideImports,
        path: BACKLOG_PATH,
        requireBaseline: true,
        cwd: dir,
        env: { GITHUB_EVENT_NAME: 'push' },
        lastValidatedBase: () => base,
    });
    assert('K2. a new file arriving with its own entry is refused',
        added.problems.length > 0,
        JSON.stringify(added.problems));

    // Draining is what the campaign is for, and needs no ceremony.
    commit(git, dir, {
        'src/features/x.jsx': glyphFile(1),
        [BACKLOG_PATH]: backlogJson({ 'src/features/x.jsx': 1 }),
    }, 'drain');
    const drained = checkBacklogDirection({
        current: { 'src/features/x.jsx': 1 },
        measured: [{ path: 'src/features/x.jsx', lines: 1 }],
        countLines: countLucideImports,
        path: BACKLOG_PATH,
        requireBaseline: true,
        cwd: dir,
        env: { GITHUB_EVENT_NAME: 'push' },
        lastValidatedBase: () => base,
    });
    assert('K3. draining an entry passes without ceremony',
        drained.problems.length === 0,
        JSON.stringify(drained.problems));

    const noBase = checkBacklogDirection({
        current: { 'src/features/x.jsx': 1 },
        measured: [{ path: 'src/features/x.jsx', lines: 1 }],
        countLines: countLucideImports,
        path: BACKLOG_PATH,
        requireBaseline: true,
        cwd: dir,
        env: { GITHUB_EVENT_NAME: 'push' },
        lastValidatedBase: () => null,
    });
    assert('K4. "could not find a base" is a refusal, not a skip, under --require-baseline',
        noBase.problems.length > 0,
        JSON.stringify(noBase.problems));
} finally {
    removeTree(dir);
}

console.log(failures === 0
    ? '\nAll icon-contract checks passed.'
    : `\n${failures} icon-contract check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
