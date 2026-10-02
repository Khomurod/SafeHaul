#!/usr/bin/env node
/**
 * Drives every refusal in `check-agent-docs.mjs`. A size lock that has never
 * been seen to refuse is a report, not a lock.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAgentDocs, globToRegExp, hasPathsFrontmatter, readAgentDocs } from './check-agent-docs.mjs';
import { AGENT_DOC_LIMITS } from './agent-docs-limits.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};
const linesOf = (n) => 'x\n'.repeat(n);
const scoped = (n) => `---\npaths:\n  - "src/**"\n---\n${linesOf(n - 4)}`;
const limits = [
    { pattern: 'AGENTS.md', mustExist: true, maxLines: 10, maxBytes: 200, why: 'test' },
    { pattern: '**/AGENTS.md', maxLines: 10, why: 'test' },
    { pattern: '.claude/rules/**/*.md', mustExist: true, maxLines: 10, requirePaths: true, why: 'test' },
];
const options = { limits, alwaysLoaded: ['AGENTS.md'], alwaysLoadedMaxBytes: 150 };
const base = () => [
    { path: 'AGENTS.md', text: linesOf(5) },
    { path: '.claude/rules/ui.md', text: scoped(8) },
];

console.log('\nG. Agent instruction size limits');
{
    const nested = globToRegExp('**/AGENTS.md');
    const rules = globToRegExp('.claude/rules/**/*.md');
    assert('G1. `**/` matches the root and any depth; `*` stays inside one directory',
        nested.test('AGENTS.md') && nested.test('a/b/AGENTS.md') && !nested.test('NOT_AGENTS.md')
        && rules.test('.claude/rules/x.md') && rules.test('.claude/rules/a/x.md')
        && !rules.test('.claude/rulesx.md') && !globToRegExp('docs/*.md').test('docs/a/b.md'));
    let threw = false;
    try { globToRegExp('src/*.{js,md}'); } catch { threw = true; }
    assert('G2. brace syntax is refused rather than silently matching nothing', threw);
}
assert('G3. files within their limits pass', checkAgentDocs(base(), options).length === 0,
    checkAgentDocs(base(), options).join('; '));
{
    const files = [{ path: 'AGENTS.md', text: linesOf(10) }, base()[1]];
    assert('G4. a file at exactly its limit passes', checkAgentDocs(files, options).length === 0);
}
{
    const problems = checkAgentDocs([{ path: 'AGENTS.md', text: linesOf(11) }, base()[1]], options);
    assert('G5. one line over the limit is refused, naming the file and the limit',
        problems.some((p) => p.startsWith('AGENTS.md: 11 lines') && p.includes('limit of 10')), problems.join('; '));
}
{
    const problems = checkAgentDocs([{ path: 'AGENTS.md', text: `${'y'.repeat(300)}\n` }, base()[1]], options);
    assert('G6. a file over its byte limit is refused even when its line count fits',
        problems.some((p) => p.includes('301 bytes')), problems.join('; '));
}
{
    const problems = checkAgentDocs([base()[1]], options);
    assert('G7. a required file that is gone is refused, so a rename cannot escape the limit',
        problems.some((p) => p.startsWith('AGENTS.md: no tracked file matches')), problems.join('; '));
}
{
    const problems = checkAgentDocs([...base(), { path: 'docs/team/AGENTS.md', text: linesOf(12) }], options);
    assert('G8. a nested AGENTS.md is measured too',
        problems.some((p) => p.startsWith('docs/team/AGENTS.md: 12 lines')), problems.join('; '));
}
{
    const files = [base()[0], { path: '.claude/rules/sub/always.md', text: linesOf(3) }];
    const problems = checkAgentDocs(files, options);
    assert('G9. a rule without `paths:` frontmatter is refused, even one directory down',
        problems.some((p) => p.startsWith('.claude/rules/sub/always.md: no `paths:`')), problems.join('; '));
    assert('G10. frontmatter is recognised only at the top of the file',
        hasPathsFrontmatter(scoped(6)) && !hasPathsFrontmatter(`x\n${scoped(6)}`) && !hasPathsFrontmatter('---\ntitle: x\n---\n'));
}
{
    const files = [{ path: 'AGENTS.md', text: `${'z'.repeat(160)}\n` }, base()[1]];
    const problems = checkAgentDocs(files, { ...options, limits: limits.map((l) => ({ ...l, maxBytes: undefined })) });
    assert('G11. the files every session loads are refused when they add up past the shared budget',
        problems.some((p) => p.includes('bytes together')), problems.join('; '));
}
{
    const files = readAgentDocs({ cwd: repoRoot });
    const missing = AGENT_DOC_LIMITS.filter((l) => l.mustExist)
        .filter((l) => !files.some((f) => globToRegExp(l.pattern).test(f.path)));
    assert('G12. every required pattern matches a tracked file in this repository',
        missing.length === 0, missing.map((l) => l.pattern).join(', '));
    let ok = true;
    try {
        execFileSync('node', ['scripts/check-agent-docs.mjs'], { cwd: repoRoot, stdio: 'pipe' });
    } catch (error) {
        ok = false;
        console.log(String(error.stderr || error.stdout));
    }
    assert('G13. this repository passes its own limits', ok);
}

console.log(failures === 0 ? '\nagent-docs guard: all assertions passed.' : `\n${failures} assertion(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
