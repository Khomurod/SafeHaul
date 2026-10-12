#!/usr/bin/env node
/**
 * The lint rules whose violation is a broken screen or a broken contract,
 * driven through ESLint's own API on sample code. A rule switched off, scoped to
 * the wrong files or left at "warn" reports the same clean run as one that found
 * nothing, so each is shown refusing.
 *
 *   npm run test:lint-rules
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: repoRoot });
let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};

/** The rules that report an error for `code` placed at `path`. */
async function errorsFor(code, path) {
    const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, path) });
    return result.messages.filter((message) => message.severity === 2).map((message) => message.ruleId ?? message.message);
}

console.log('\nL. Glyphs come from the design system');
{
    const ways = {
        'an import': "import { Trash2 } from 'lucide-react';\nexport const glyph = Trash2;\n",
        'a deep import': "import Trash2 from 'lucide-react/dist/esm/icons/trash-2';\nexport const glyph = Trash2;\n",
        'a re-export': "export { Trash2 } from 'lucide-react';\n",
        'an export of everything': "export * from 'lucide-react';\n",
        'a dynamic import': "export const load = () => import('lucide-react');\n",
        'a dynamic import in backticks': 'export const load = () => import(`lucide-react`);\n',
        'a dynamic deep import built from a name': 'export const load = (name) => import(`lucide-react/dist/esm/icons/${name}`);\n',
        'a require': "const { Trash2 } = require('lucide-react');\nexport const glyph = Trash2;\n",
        'a require in backticks': 'const { Trash2 } = require(`lucide-react`);\nexport const glyph = Trash2;\n',
    };
    for (const [way, code] of Object.entries(ways)) {
        const errors = await errorsFor(code, 'src/features/example/Widget.jsx');
        assert(`L1. ${way} of lucide-react under src/ is an error`, errors.includes('no-restricted-syntax'), errors.join(', '));
    }
    const elsewhere = [];
    for (const path of ['src/App.jsx', 'src/shared/components/Widget.jsx', 'src/design-system/components/x/Widget.jsx']) {
        if (!(await errorsFor(ways['an import'], path)).includes('no-restricted-syntax')) elsewhere.push(path);
    }
    assert('L1b. and so it is anywhere else under src/', elsewhere.length === 0, elsewhere.join(', '));
    const registry = await errorsFor(ways['an import'], 'src/design-system/icons/glyphs.js');
    assert('L2. the icons directory may import it', !registry.includes('no-restricted-syntax'), registry.join(', '));
    const viaRegistry = await errorsFor("import { Icon, Trash2 } from '@design-system/icons';\nexport const a = [Icon, Trash2];\n",
        'src/features/example/Widget.jsx');
    const lookalike = await errorsFor(
        "import x from 'lucide-reactive';\nexport const a = x;\nexport const load = () => import(`lucide-reactive`);\n",
        'src/features/example/Widget.jsx',
    );
    assert('L3. glyphs from the registry pass, and so does a package that only starts with the name',
        !viaRegistry.includes('no-restricted-syntax') && !lookalike.includes('no-restricted-syntax'),
        [...viaRegistry, ...lookalike].join(', '));

    /*
     * The rule holds only where ESLint looks, and ESLint here lints JavaScript
     * alone: a `.ts` or `.tsx` file under src/ would reach no lint rule at all.
     * So every source file the replaced checker governed, TypeScript included,
     * must be one this rule reaches. Read from git, so a new file is judged in
     * the pull request that adds it.
     */
    const governed = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter((file) => /\.(?:[jt]sx?|mjs|cjs)$/.test(file) && !file.startsWith('src/design-system/icons/'));
    const unreached = [];
    for (const file of governed) {
        const config = await eslint.calculateConfigForFile(file);
        const [severity, ...options] = [config?.rules?.['no-restricted-syntax']].flat();
        const reached = severity === 2 && options.some((option) => /lucide-react/.test(option?.message ?? ''));
        if (!reached) unreached.push(file);
    }
    // A listing that came back empty would pass over nothing.
    const unlisted = ['src/features/', 'src/shared/', 'src/design-system/']
        .filter((root) => !governed.some((file) => file.startsWith(root)));
    assert(`L4. the rule reaches every source file under src/ outside icons/ (${governed.length})`,
        unlisted.length === 0 && unreached.length === 0,
        unreached.length > 0
            ? `${unreached.slice(0, 5).join(', ')}: ESLint does not apply the rule here; lint the file type before adding one`
            : `git listed no source file under ${unlisted.join(', ')}`);
}

console.log('\nM. Lint refuses what would crash a screen');
{
    const undefinedTag = await errorsFor('export const Row = () => <Icon />;\n', 'src/features/example/Row.jsx');
    assert('M1. a JSX tag whose component is not in scope is an error',
        undefinedTag.includes('react/jsx-no-undef'), undefinedTag.join(', '));
    const conditionalHook = await errorsFor(
        "import { useState } from 'react';\nexport function Row({ on }) {\n  if (on) useState(0);\n  return null;\n}\n",
        'src/features/example/Row.jsx',
    );
    assert('M2. a hook called conditionally is an error',
        conditionalHook.includes('react-hooks/rules-of-hooks'), conditionalHook.join(', '));
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/main.yml'), 'utf8');
    assert('M3. and a CI job runs the lint', /\n\s+run: npm run lint(:frontend)?\n/.test(workflow));
}

console.log(failures === 0 ? '\nlint rules: all assertions passed.' : `\n${failures} assertion(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
