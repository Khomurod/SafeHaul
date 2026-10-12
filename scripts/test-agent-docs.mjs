#!/usr/bin/env node
/**
 * Drives every refusal and warning in `check-agent-docs.mjs`. A size lock that
 * has never been seen to refuse is a report, not a lock.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    checkAgentDocs, globToRegExp, hasPathsFrontmatter, missingPaths, namedPaths, readAgentDocs, trackedPaths,
} from './check-agent-docs.mjs';
import { AGENT_DOC_LIMITS, ALWAYS_LOADED, ALWAYS_LOADED_MAX_BYTES } from './agent-docs-limits.mjs';
import { initThrowawayRepo, removeTree } from './lib/throwaway.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};
const linesOf = (n) => 'x\n'.repeat(n);
const scoped = (n) => `---\npaths:\n  - "src/**"\n---\n${linesOf(n - 4)}`;
const limits = [
    { pattern: 'AGENTS.md', mustExist: true, hard: true, maxLines: 10, maxBytes: 200, why: 'test' },
    { pattern: '*/**/AGENTS.md', maxLines: 10, why: 'test' },
    { pattern: '.claude/rules/**/*.md', mustExist: true, maxLines: 10, requirePaths: true, why: 'test' },
];
const options = { limits, alwaysLoaded: ['AGENTS.md'], alwaysLoadedMaxBytes: 150 };
const base = () => [
    { path: 'AGENTS.md', text: linesOf(5) },
    { path: '.claude/rules/ui.md', text: scoped(8) },
];
const both = ({ problems, warnings }) => [...problems, ...warnings].join('; ');

console.log('\nG. Agent instruction size limits');
{
    const nested = globToRegExp('**/AGENTS.md');
    const rules = globToRegExp('.claude/rules/**/*.md');
    assert('G1. `**/` matches the root and any depth; `*` stays inside one directory',
        nested.test('AGENTS.md') && nested.test('a/b/AGENTS.md') && !nested.test('NOT_AGENTS.md')
        && rules.test('.claude/rules/x.md') && rules.test('.claude/rules/a/x.md')
        && !rules.test('.claude/rulesx.md') && !globToRegExp('docs/*.md').test('docs/a/b.md'));
    const below = globToRegExp('*/**/AGENTS.md');
    assert('G1b. `*/**/` matches every depth below the root, and not the root',
        below.test('a/AGENTS.md') && below.test('a/b/AGENTS.md') && !below.test('AGENTS.md'));
    let threw = false;
    try { globToRegExp('src/*.{js,md}'); } catch { threw = true; }
    assert('G2. brace syntax is refused rather than silently matching nothing', threw);
}
{
    const verdict = checkAgentDocs(base(), options);
    assert('G3. files within their limits pass, with no warning',
        verdict.problems.length === 0 && verdict.warnings.length === 0, both(verdict));
}
{
    const verdict = checkAgentDocs([{ path: 'AGENTS.md', text: linesOf(10) }, base()[1]], options);
    assert('G4. a file at exactly its limit passes', verdict.problems.length === 0 && verdict.warnings.length === 0);
}
{
    const { problems } = checkAgentDocs([{ path: 'AGENTS.md', text: linesOf(11) }, base()[1]], options);
    assert('G5. one line over a hard limit is refused, naming the file and the limit',
        problems.some((p) => p.startsWith('AGENTS.md: 11 lines') && p.includes('limit of 10')), problems.join('; '));
}
{
    const { problems } = checkAgentDocs([{ path: 'AGENTS.md', text: `${'y'.repeat(300)}\n` }, base()[1]], options);
    assert('G6. a file over its hard byte limit is refused even when its line count fits',
        problems.some((p) => p.startsWith('AGENTS.md: 301 bytes, over its limit of 200')), problems.join('; '));
}
{
    const { problems } = checkAgentDocs([base()[1]], options);
    assert('G7. a required file that is gone is refused, so a rename cannot escape the limit',
        problems.some((p) => p.startsWith('AGENTS.md: no tracked file matches')), problems.join('; '));
}
{
    const verdict = checkAgentDocs([...base(), { path: 'docs/team/AGENTS.md', text: linesOf(12) }], options);
    assert('G8. a nested AGENTS.md over its limit warns, and is not refused',
        verdict.problems.length === 0 && verdict.warnings.some((w) => w.startsWith('docs/team/AGENTS.md: 12 lines')),
        both(verdict));
}
{
    const files = [base()[0], { path: '.claude/rules/sub/always.md', text: linesOf(3) }];
    const { problems } = checkAgentDocs(files, options);
    assert('G9. a rule without `paths:` frontmatter is refused, even one directory down',
        problems.some((p) => p.startsWith('.claude/rules/sub/always.md: no `paths:`')), problems.join('; '));
    assert('G10. frontmatter is recognised only at the top of the file',
        hasPathsFrontmatter(scoped(6)) && !hasPathsFrontmatter(`x\n${scoped(6)}`) && !hasPathsFrontmatter('---\ntitle: x\n---\n'));
}
{
    const files = [{ path: 'AGENTS.md', text: `${'z'.repeat(160)}\n` }, base()[1]];
    const { problems } = checkAgentDocs(files, { ...options, limits: limits.map((l) => ({ ...l, maxBytes: undefined })) });
    assert('G11. the files every session loads are refused when they add up past the shared budget',
        problems.some((p) => p.includes('bytes together')), problems.join('; '));
}
{
    const verdict = checkAgentDocs([base()[0], { path: '.claude/rules/ui.md', text: scoped(11) }], options);
    assert('G12. a topic rule over its limit warns, and is not refused',
        verdict.problems.length === 0 && verdict.warnings.some((w) => w.startsWith('.claude/rules/ui.md: 11 lines')),
        both(verdict));
}
{
    const files = readAgentDocs({ cwd: repoRoot });
    const missing = AGENT_DOC_LIMITS.filter((l) => l.mustExist)
        .filter((l) => !files.some((f) => globToRegExp(l.pattern).test(f.path)));
    assert('G13. every required pattern matches a tracked file in this repository',
        missing.length === 0, missing.map((l) => l.pattern).join(', '));
    const run = spawnSync('node', ['scripts/check-agent-docs.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    assert('G14. this repository passes its own limits', run.status === 0, `${run.stdout}${run.stderr}`);
}

console.log('\nH. The refused limits are the owner\'s, and named files exist');
{
    // A raise is the owner's decision: it has to change this test as well.
    const hard = AGENT_DOC_LIMITS.filter((limit) => limit.hard);
    const limitOf = (pattern) => JSON.stringify(hard.find((limit) => limit.pattern === pattern), ['mustExist', 'maxLines', 'maxBytes']);
    assert('H1. only AGENTS.md and CLAUDE.md, which every session loads, are refused past their size',
        hard.map((limit) => limit.pattern).sort().join() === 'AGENTS.md,CLAUDE.md', hard.map((l) => l.pattern).join(', '));
    assert('H2. AGENTS.md may hold 150 lines and 16 KiB, and must exist',
        limitOf('AGENTS.md') === JSON.stringify({ mustExist: true, maxLines: 150, maxBytes: 16 * 1024 }), limitOf('AGENTS.md'));
    assert('H3. CLAUDE.md may hold 40 lines, and must exist',
        limitOf('CLAUDE.md') === JSON.stringify({ mustExist: true, maxLines: 40 }), limitOf('CLAUDE.md'));
    assert('H4. the two together may hold 24 KiB',
        ALWAYS_LOADED_MAX_BYTES === 24 * 1024 && [...ALWAYS_LOADED].sort().join() === 'AGENTS.md,CLAUDE.md',
        `${ALWAYS_LOADED.join(' + ')}: ${ALWAYS_LOADED_MAX_BYTES}`);
    const rules = AGENT_DOC_LIMITS.find((limit) => limit.pattern === '.claude/rules/**/*.md');
    assert('H5. every topic rule must carry `paths:`, so none joins what every session loads',
        rules?.requirePaths === true && rules.mustExist === true);
}
{
    const text = 'Read `.claude/rules/gone.md`, `docs/`, `npm run x/y`, `src/**/*.jsx`, `/implement`, `a=b/c`, `https://x.io/a`.';
    assert('H6. only plain relative paths count as named', JSON.stringify(namedPaths(text)) === JSON.stringify(['.claude/rules/gone.md', 'docs/']),
        JSON.stringify(namedPaths(text)));
    const files = [{ path: 'AGENTS.md', text }, { path: 'docs/notes.md', text: '`also/gone.md`' }];
    const problems = missingPaths(files, ['AGENTS.md', 'docs/a.md']);
    assert('H7. a missing file named by the instructions is refused; a directory with files passes; other docs are not checked',
        problems.length === 1 && problems[0].includes('`.claude/rules/gone.md`'), problems.join('; '));
    const tracked = trackedPaths(repoRoot).filter((path) => path !== '.claude/rules/testing.md');
    const realFiles = readAgentDocs({ cwd: repoRoot });
    assert('H8. deleting a topic file that AGENTS.md names is refused',
        missingPaths(realFiles, tracked).some((p) => p.includes('`.claude/rules/testing.md`')));
}

console.log('\nI. The command, in a repository of its own');
{
    const dir = mkdtempSync(join(tmpdir(), 'agent-docs-'));
    try {
        const git = initThrowawayRepo(dir);
        const write = (path, text) => {
            mkdirSync(dirname(join(dir, path)), { recursive: true });
            writeFileSync(join(dir, path), text);
            git('add', path);
        };
        // One small file for every pattern that must match one.
        for (const limit of AGENT_DOC_LIMITS.filter((l) => l.mustExist)) {
            write(limit.pattern.replace('**/', '').replace('*', 'x'), limit.requirePaths ? scoped(6) : linesOf(3));
        }
        const check = (env) => spawnSync('node', [join(repoRoot, 'scripts/check-agent-docs.mjs')], {
            cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
        });
        const clean = check({ GITHUB_ACTIONS: '' });
        assert('I1. a repository within every limit passes', clean.status === 0, `${clean.stdout}${clean.stderr}`);

        const brief = AGENT_DOC_LIMITS.find((l) => l.pattern === 'docs/APP_BRIEF.md');
        write('docs/APP_BRIEF.md', linesOf(brief.maxLines + 1));
        const warned = check({ GITHUB_ACTIONS: 'true' });
        assert('I2. a brief over its limit passes with a warning, annotated in CI',
            warned.status === 0 && warned.stdout.includes(`::warning title=Agent docs::docs/APP_BRIEF.md: ${brief.maxLines + 1} lines`),
            `${warned.stdout}${warned.stderr}`);
        const local = check({ GITHUB_ACTIONS: '' });
        assert('I3. outside CI the warning is printed without the annotation',
            local.status === 0 && local.stdout.includes('warning: docs/APP_BRIEF.md') && !local.stdout.includes('::warning'),
            local.stdout);

        write('AGENTS.md', linesOf(151));
        const refused = check({ GITHUB_ACTIONS: '' });
        assert('I4. an AGENTS.md over its limit fails the command, reported once as a refusal',
            refused.status === 1 && refused.stderr.includes('AGENTS.md: 151 lines')
                && !refused.stdout.includes('warning: AGENTS.md'), `${refused.stdout}${refused.stderr}`);

        write('AGENTS.md', 'Read `docs/gone.md` first.\n');
        const dangling = check({ GITHUB_ACTIONS: '' });
        assert('I5. an AGENTS.md that names a missing file fails the command',
            dangling.status === 1 && dangling.stderr.includes('`docs/gone.md`'), `${dangling.stdout}${dangling.stderr}`);
    } finally {
        removeTree(dir);
    }
}

console.log(failures === 0 ? '\nagent-docs guard: all assertions passed.' : `\n${failures} assertion(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
