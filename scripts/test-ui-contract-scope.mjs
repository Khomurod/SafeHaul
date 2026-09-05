#!/usr/bin/env node
/**
 * What does the UI-contract guard actually look at?
 *
 * Run with `npm run test:ui-contract`. Exit 0 = all pass.
 *
 * A different subject from its siblings, and the one a 2026-09-04 audit found
 * nothing covering at all:
 *
 * | file                             | asks                                      |
 * |----------------------------------|-------------------------------------------|
 * | `test-ui-contract.mjs`           | are the DECISIONS right?                  |
 * | `test-ui-contract-scope.mjs`     | is it still LOOKING at the whole tree?    |
 * | `test-ui-contract-baseline.mjs`  | can the inventory be edited by the branch?|
 * | `test-ui-contract-ci.mjs`        | does CI run it, and can that be skipped?  |
 *
 * ## The way a guard fails is silently
 *
 * Not by reporting the wrong thing — by reporting less. Narrow the extension
 * regex by one format and the scan drops from 554 files to 528, which still
 * clears the only floor there was; twenty-six stylesheets stop being read, and
 * the output still says "intact". That is not hypothetical: this guard read only
 * JSX until 2026-08-25, and `src/shared/styles/designTokens.css` sat there for
 * the whole campaign with a second colour, type, radius and shadow scale in
 * forty-odd raw hexes, invisible to a check the README called zero-tolerance.
 *
 * A shorter report reads exactly like progress. So the floors below are **per
 * format**, not just on the total — a total floor cannot see a category go to
 * zero underneath it. `scripts/source-size.mjs` learned the same thing and calls
 * it `REQUIRED_ROOTS`.
 *
 * Every assertion names the mutation that turns it red.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MINIMUM_SCANNED_FILES } from './check-ui-contract.mjs';
import {
    SOURCE_FILE_PATTERN, TOKEN_DEFINITION_FILES, isTestFile, scanTargets, sourceFiles,
} from './ui-contract/paths.mjs';
import { CSS_RULE_NAMES, RULES, STYLED_CONTROL_RULES } from './ui-contract/rules.mjs';
import { HTML_RULE_NAMES, STORY_RULE_NAMES, rulesFor } from './ui-contract/source-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

let failures = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ========================================================================== */
console.log('\nS1. Which files count as source');

{
    const accepts = ['Button.jsx', 'helpers.js', 'types.ts', 'Card.tsx', 'Button.css',
        'index.html'];
    const rejects = [
        'data.json', 'README.md', 'logo.svg', 'Button.test.jsx.snap', 'photo.png',
        'schema.graphql', 'notes.txt',
    ];
    // Mutation: drop `css` from the pattern. The scan goes 554 -> 528, which the
    // total floor cannot see, and 26 stylesheets stop being read.
    assert('S1a. every format the guard claims to cover is accepted',
        accepts.every((name) => SOURCE_FILE_PATTERN.test(name)),
        accepts.filter((name) => !SOURCE_FILE_PATTERN.test(name)).join(', '));

    // Mutation: widen the pattern to `.` and the guard starts flagging fixture
    // JSON and prose — a check that fires on correct content gets switched off.
    assert('S1b. data, prose, artwork and snapshots are not source',
        rejects.every((name) => !SOURCE_FILE_PATTERN.test(name)),
        rejects.filter((name) => SOURCE_FILE_PATTERN.test(name)).join(', '));

    /*
     * S1c is the subtle one. `RegExp.prototype.test` on a `/g` regex advances
     * `lastIndex` and resumes from it on the next call, so a global pattern used
     * in a loop matches every OTHER file — a walk that silently halves itself and
     * reports a smaller, cleaner-looking number.
     */
    assert('S1c. the pattern is stateless, so the walk cannot skip every other file',
        !SOURCE_FILE_PATTERN.global
        && SOURCE_FILE_PATTERN.test('a.jsx') && SOURCE_FILE_PATTERN.test('a.jsx'),
        `flags: ${SOURCE_FILE_PATTERN.flags}`);
}

/* ========================================================================== */
console.log('\nS2. The walker reaches every format it claims to cover');

{
    // Mutation: lower the floor, or narrow the extension regex.
    assert('S2a. the floor is a real constant, not a magic number',
        Number.isInteger(MINIMUM_SCANNED_FILES) && MINIMUM_SCANNED_FILES >= 400,
        String(MINIMUM_SCANNED_FILES));

    const files = scanTargets().flatMap(sourceFiles);
    const ending = (suffix) => files.filter((file) => file.endsWith(suffix)).length;

    assert('S2b. the live scan is comfortably above the floor',
        files.length > MINIMUM_SCANNED_FILES, `scanned ${files.length}`);

    /*
     * The two floors the total cannot enforce. Stylesheets and stories are each
     * a few per cent of the tree, so either could go to zero — by a narrowed
     * regex, a moved directory, a widened `isTestFile` — while the total stays
     * comfortably above 400 and the report still says "intact".
     */
    assert('S2c. stylesheets are still scanned', ending('.css') >= 20, `${ending('.css')} .css files`);
    assert('S2d. stories are still scanned',
        ending('.stories.jsx') + ending('.stories.tsx') >= 30,
        `${ending('.stories.jsx') + ending('.stories.tsx')} story files`);

    // The repository-root shell, which Tailwind compiles and the walk missed
    // for the whole campaign. Mutation: drop it from `scanTargets()`.
    assert('S2e. the repository-root index.html is scanned',
        ending('index.html') === 1, `${ending('index.html')} html files`);

    /*
     * S2f is the assertion that makes the widening durable rather than a
     * one-off. The set of files Tailwind compiles is defined by its `content`
     * array, NOT by a directory this guard happens to walk — so every static
     * prefix there must be covered by a scan target. Mutation: add a
     * `"./emails/**"` entry to `tailwind.config.js` and this fails until the
     * walk covers it.
     */
    /*
     * Comments stripped FIRST. The `content` array carries a long explanation of
     * why stories are excluded, and that prose contains the quoted word
     * "shadow" — which the extractor below read as a glob, reporting Tailwind as
     * compiling a directory called `shadow`. A check that fires on its own
     * documentation is one this repository has already had to fix twice.
     */
    const config = readFileSync(resolve(repoRoot, 'tailwind.config.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const contentBlock = config.slice(config.indexOf('content: ['), config.indexOf(']', config.indexOf('content: [')));
    const globs = [...contentBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1])
        .filter((glob) => !glob.startsWith('!'));
    const targets = scanTargets().map((target) => resolve(target));
    const uncovered = globs.filter((glob) => {
        const prefix = resolve(repoRoot, glob.split('*')[0].replace(/\/$/, ''));
        return !targets.some((target) => prefix === target || prefix.startsWith(`${target}/`));
    });
    assert('S2f. every Tailwind content root is covered by a scan target',
        uncovered.length === 0,
        `${uncovered.join(', ')} — Tailwind compiles it, so the guard must read it`);

    // And the CLI reports the same number it walked, rather than a stale one.
    const intact = execFileSync('node', [resolve(here, 'check-ui-contract.mjs')],
        { cwd: repoRoot, encoding: 'utf8' });
    const reported = Number(intact.match(/intact: (\d+) files scanned/)?.[1] ?? 0);
    assert('S2g. the number the CLI prints is the number it walked',
        reported === files.length, `printed ${reported}, walked ${files.length}`);
}

/* ========================================================================== */
console.log('\nS3. The only files exempt by path, and why');

{
    /*
     * A raw hex is the whole job of the token files — that is where the
     * product's colours are declared. They are exempt by PATH rather than by an
     * allowlist entry, because a number there would need updating every time a
     * palette step was added, which trains people to update numbers.
     *
     * Mutation: add a third path. Every path-based exemption is a hole nothing
     * else can see, so the set is pinned by content, not merely by size.
     */
    const expected = ['src/design-system/tokens/foundation.css',
        'src/design-system/tokens/semantic.css'];
    assert('S3a. exactly the two token-definition stylesheets are exempt by path',
        TOKEN_DEFINITION_FILES.size === expected.length
        && expected.every((file) => TOKEN_DEFINITION_FILES.has(file)),
        [...TOKEN_DEFINITION_FILES].join(', '));

    // Mutation: rename a token file and leave the exemption behind. A path-based
    // exemption for a file that does not exist is an exemption nobody notices is
    // dead — and the renamed file is then scanned with rules written for others.
    const missing = [...TOKEN_DEFINITION_FILES].filter((file) => !existsSync(join(repoRoot, file)));
    assert('S3b. every exempt path still exists', missing.length === 0, missing.join(', '));

    assert('S3c. and the exemption is what `rulesFor` actually applies',
        [...TOKEN_DEFINITION_FILES].every((file) => {
            const only = rulesFor(file);
            return Array.isArray(only) && only.length === 0;
        }));
}

/* ========================================================================== */
console.log('\nS6. Which rules each kind of file is held to');

{
    const ruleNames = [...RULES.map((rule) => rule.name), ...CSS_RULE_NAMES,
        ...STYLED_CONTROL_RULES.map((rule) => rule.name)];

    // `null` means "every JSX rule". Mutation: return `[]` instead and every
    // feature file is scanned with no rules at all — a silent, total bypass.
    assert('S6a. ordinary source gets the full JSX rule set',
        rulesFor('features/company-admin/Thing.jsx') === null
        && rulesFor('shared/utils/helpers.js') === null);

    assert('S6b. a stylesheet gets the CSS rules, which are a different set',
        rulesFor('design-system/components/button/Button.css') === CSS_RULE_NAMES
        && CSS_RULE_NAMES.length > 0
        && CSS_RULE_NAMES.every((name) => ruleNames.includes(name)));

    assert('S6a2. an HTML document gets the class-list rules only',
        rulesFor('index.html') === HTML_RULE_NAMES
        && HTML_RULE_NAMES.length > 0
        && HTML_RULE_NAMES.every((name) => ruleNames.includes(name))
        && !HTML_RULE_NAMES.includes('raw-table'),
        'index.html is a shell — it has no tables or controls, but every class on it ships');

    assert('S6c. a story gets the reduced class-list set',
        rulesFor('design-system/stories/Button.stories.jsx') === STORY_RULE_NAMES
        && rulesFor('design-system/stories/Button.stories.tsx') === STORY_RULE_NAMES);

    /*
     * The routing is by suffix, and a component whose NAME contains "stories"
     * must not inherit the reduced set — that would be a per-file bypass anyone
     * could buy with a rename.
     */
    assert('S6d. only a real story file gets the story set',
        rulesFor('features/campaigns/SuccessStories.jsx') === null
        && rulesFor('features/campaigns/stories.js') === null);
}

/* ========================================================================== */
console.log('\nS5. Story rules are a deliberate subset, not an accident');

{
    const ruleNames = [...new Set([...RULES.map((rule) => rule.name), ...CSS_RULE_NAMES,
        ...STYLED_CONTROL_RULES.map((rule) => rule.name)])];

    // Mutation: add a class-list rule and forget the story set. A story is
    // scanned with a reduced set on purpose — its prose *discusses* the class
    // names, and class names live inside string literals so strings cannot be
    // stripped — so the subset has to be intentional and asserted, not inferred.
    const unknown = STORY_RULE_NAMES.filter((name) => !ruleNames.includes(name));
    assert('S5a. every story rule is a real rule', unknown.length === 0, unknown.join(', '));
    assert('S5b. the story set is a strict subset',
        STORY_RULE_NAMES.length > 0 && STORY_RULE_NAMES.length < ruleNames.length,
        `${STORY_RULE_NAMES.length} of ${ruleNames.length}`);

    /*
     * S5c is the half that would otherwise rot. The markup-shaped rules are left
     * off deliberately; the CSS rules are left off because a story is not CSS.
     * Anything else missing is an oversight, and naming the exclusions here is
     * what makes a NEW class-list rule fail until someone decides.
     */
    const excluded = new Set([
        // Markup-shaped: a story legitimately demonstrates the pattern, and the
        // permissions matrix in `Checkbox.stories` is an approved native table.
        'hand-built-overlay', 'raw-table', 'raw-file-input', 'hand-rolled-tablist',
        'hand-written-target-blank', 'jsx-label-on-throwing-primitive',
        // CSS rules: opt-in by name, and a story is not a stylesheet.
        ...CSS_RULE_NAMES,
    ]);
    const unaccounted = ruleNames.filter((name) => !STORY_RULE_NAMES.includes(name)
        && !excluded.has(name));
    assert('S5c. every rule is either in the story set or a documented exclusion',
        unaccounted.length === 0,
        `unaccounted: ${unaccounted.join(', ')} — add it to STORY_RULE_NAMES or to the `
        + 'exclusion list here with the reason');
}

/* ========================================================================== */
console.log('\nS9. Tests are skipped, and only tests');

{
    const tests = ['Button.test.jsx', 'a.test.js', 'b.spec.ts', 'c.spec.tsx', 'd.test.tsx'];
    assert('S9a. a test file is skipped, because tests assert on the forbidden strings',
        tests.every(isTestFile), tests.filter((name) => !isTestFile(name)).join(', '));

    /*
     * Mutation: relax the pattern to `/test/`. `TestDriveForm.jsx`,
     * `LatestActivity.jsx` and `ContestBanner.jsx` all stop being scanned, and
     * the total barely moves — a per-file bypass anyone could buy with a rename.
     */
    const notTests = [
        'TestDriveForm.jsx', 'LatestActivity.jsx', 'ContestBanner.jsx',
        'testUtils.js', 'protest.css', 'spectrum.js',
    ];
    assert('S9b. a file whose NAME merely contains "test" is still scanned',
        notTests.every((name) => !isTestFile(name)),
        notTests.filter(isTestFile).join(', '));
}

/* ========================================================================== */
console.log('\nX. The CLI stays out of the Vitest module graph');

{
    /*
     * Mutation: import `check-ui-contract.mjs` from a test under `src/`. Vitest
     * rewrites `import.meta.url`, so anything at the CLI's module scope — or at
     * the module scope of anything it imports, such as the git-baseline helpers,
     * which resolve the repository root on import — runs inside that rewrite and
     * throws before a single assertion runs. `paths.mjs` puts every path behind a
     * function call for this reason.
     *
     * Matches an import SPECIFIER, not a mention: naming the file in a comment is
     * exactly what the ratchet suite does to explain why it imports elsewhere,
     * and a check that fires on its own documentation gets switched off.
     */
    let found = '';
    try {
        // grep exits 1 when it matches nothing, which is the passing case here.
        found = execFileSync('grep',
            ['-rlE', '--include=*.js', '--include=*.jsx',
                String.raw`(from|import\()\s*['"][^'"]*(check-ui-contract|ui-contract/baseline)`,
                resolve(repoRoot, 'src')],
            { encoding: 'utf8', cwd: repoRoot });
    } catch (error) {
        if (error.status !== 1) throw error;
    }
    const offenders = found.trim().split('\n').filter(Boolean);
    assert('X1. nothing under src/ imports the CLI entry or the git baseline',
        offenders.length === 0, offenders.join(', '));
}

/* ========================================================================== */
console.log(failures === 0
    ? '\nAll UI-contract scope checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
