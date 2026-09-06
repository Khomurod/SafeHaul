#!/usr/bin/env node
/**
 * Pins what `scripts/codemods/lucide-to-icon-contract.mjs` WRITES — the import
 * it emits, the sizes it is willing to prove, the decisions it refuses, and the
 * attributes the contract takes over.
 *
 * Its sibling `test-icon-contract-reading.mjs` pins what the codemod READS: the
 * open tag, values that are not tags, comments and strings, and the live
 * backlog. The split is by responsibility rather than by size — a rewrite is
 * wrong when it produces the wrong text, and a read is wrong when it produces
 * an absence, and those fail in different ways.
 *
 * ## Why campaign tooling gets a test
 *
 * The codemod does not decide anything a reviewer will not see — every file it
 * touches is read in the pull request that ships it. So the case for testing it
 * is not "the diff might be wrong"; the diff is the review surface.
 *
 * The case is what happened on its first run. The import statement was matched
 * with a lazy `[\s\S]*?` group, which starts at the file's FIRST `import {` and
 * expands across statements until it finds `} from 'lucide-react';`. In a file
 * beginning `import { useParams } from 'react-router-dom';` it captured
 * `useParams` as a glyph, reported "2 glyph names" where the source has one, and
 * SILENTLY SKIPPED the real import's other names — they were never rewritten and
 * they were never flagged, so the report read like a clean file.
 *
 * That is the failure a review does not catch, because what it produces is an
 * absence. A9 is that bug, and it is the reason this file exists.
 *
 * Run by `npm run test:icon-contract`.
 */


import { migrate } from './codemods/lucide-to-icon-contract.mjs';

let failures = 0;
function assert(label, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

/** A file body with `head` before the lucide import and `body` after it. */
function file({ head = "import React from 'react';\n", names, body }) {
    return `${head}import { ${names} } from 'lucide-react';\n\n${body}\n`;
}
console.log('\nA. The import statement');

{
    const out = migrate(file({ names: 'Search', body: '<Search size={16} aria-hidden="true" />' }));
    assert('A1. the specifier moves to the design system and `Icon` joins the list',
        out.source.includes("import { Icon, Search } from '@design-system/icons';")
        && !out.source.includes('lucide-react'),
        out.source);
}

{
    const out = migrate(file({ names: 'Check', body: 'const ACTIONS = [{ icon: Check }];' }));
    assert('A2. `Icon` is NOT added when no element was rewritten',
        out.source.includes("import { Check } from '@design-system/icons';")
        && out.rewritten === 0,
        out.source);
}

{
    const out = migrate('import { Rocket, Globe } from "lucide-react";\n<Rocket size={16} aria-hidden="true" />\n');
    assert('A5. a double-quoted specifier is the same import',
        out.names.join(',') === 'Rocket,Globe'
        && out.rewritten === 1
        && out.source.startsWith("import { Icon, Rocket, Globe } from '@design-system/icons';"),
        `names=${JSON.stringify(out.names)} ${out.source}`);
}

{
    const out = migrate(`import { A } from 'lucide-react";\n<A size={16} aria-hidden="true" />\n`);
    assert('A6. a MISMATCHED pair of quotes is not an import',
        out.skipped === true, out.source);
}

{
    const head = "import React from 'react';\nimport { useParams } from 'react-router-dom';\n";
    const out = migrate(file({ head, names: 'ShieldCheck, Send', body: '<ShieldCheck size={16} aria-hidden="true" />\n<Send size={20} aria-hidden="true" />' }));
    assert('A9. an earlier named import does not leak into the glyph list (the real defect)',
        out.names.join(',') === 'ShieldCheck,Send'
        && out.rewritten === 2
        && out.source.includes("import { useParams } from 'react-router-dom';"),
        `names=${JSON.stringify(out.names)} rewritten=${out.rewritten}`);
}

{
    const body = 'const Wide = () => null;';
    const out = migrate(`import { Search } from 'lucide-react';\n${body}\n`);
    assert('A3. a file whose lucide import is the very first line still migrates',
        out.source.startsWith("import { Search } from '@design-system/icons';"),
        out.source);
}

{
    const out = migrate("import React from 'react';\n<div />\n");
    assert('A4. a file with no lucide import is skipped and returned unchanged',
        out.skipped === true && out.source === "import React from 'react';\n<div />\n");
}

/*
 * A7 is a run-time break the first version shipped, and the pilot's tests are
 * what caught it: `ReferenceError: ImageIcon is not defined` on the driver's
 * upload field, in nine tests across three files.
 *
 * `import { Image as ImageIcon }` renders `<ImageIcon>`. Taking the imported
 * name for both roles wrote `Image` into the new import AND left `<ImageIcon>`
 * untouched, because nothing matched it — so the file imported a name it never
 * used and used a name it never imported. Five files in the campaign are
 * aliased.
 */
{
    const out = migrate(file({
        names: 'Image as ImageIcon, X',
        body: '<ImageIcon size={16} aria-hidden="true" />\n<X size={20} aria-hidden="true" />',
    }));
    assert('A7. an aliased specifier keeps its alias AND is matched by its local name',
        out.source.includes("import { Icon, Image as ImageIcon, X } from '@design-system/icons';")
        && out.source.includes('<Icon icon={ImageIcon} />')
        && out.rewritten === 2,
        out.source);
}

{
    const out = migrate(file({
        names: 'Image as ImageIcon',
        body: '<Image size={16} aria-hidden="true" />',
    }));
    assert('A8. the IMPORTED name is not a tag — only the local one is',
        out.rewritten === 0 && out.source.includes('<Image size={16} aria-hidden="true" />'),
        out.source);
}

console.log('\nB. Size — what is provable');

{
    const out = migrate(file({ names: 'Search', body: '<Search size={16} aria-hidden="true" />' }));
    assert('B1. 16px is `md`, the default, so no `size` is written at all',
        out.source.includes('<Icon icon={Search} />'), out.source);
}

{
    const out = migrate(file({ names: 'Send', body: '<Send size={20} aria-hidden="true" />' }));
    assert('B2. 20px is `size="xl"`', out.source.includes('<Icon icon={Send} size="xl" />'), out.source);
}

{
    const out = migrate(file({ names: 'Bell', body: '<Bell size={32} aria-hidden="true" />' }));
    assert('B3. 32px is `size="3xl"` — the seventh step exists',
        out.source.includes('<Icon icon={Bell} size="3xl" />'), out.source);
}

{
    const out = migrate(file({ names: 'Trash2', body: '<Trash2 className="h-4 w-4 text-ds-status-danger-fg" aria-hidden="true" />' }));
    assert('B4. `h-4 w-4` is 16px, and the classes that are NOT geometry survive',
        out.source.includes('<Icon icon={Trash2} className="text-ds-status-danger-fg" />'), out.source);
}

{
    const out = migrate(file({ names: 'Loader2', body: '<Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />' }));
    assert('B5. `h-6 w-6` is 24px — `size="2xl"` — and `animate-spin` is not geometry',
        out.source.includes('<Icon icon={Loader2} size="2xl" className="animate-spin" />'), out.source);
}

{
    const out = migrate(file({ names: 'Dot', body: '<Dot className="h-4 w-4" aria-hidden="true" />' }));
    assert('B6. a className that was ONLY geometry is removed rather than left empty',
        out.source.includes('<Icon icon={Dot} />') && !out.source.includes('className=""'), out.source);
}

/*
 * D5 is a formatting defect the pilot's diff caught rather than any test: a tag
 * written across four lines came out with two whitespace-only lines in the
 * middle, because dropping an attribute consumed one space and left the newline
 * and indent that preceded it.
 */
{
    const out = migrate(file({
        names: 'FileSignature',
        body: '<FileSignature\n    size={18}\n    aria-hidden="true"\n    className="mt-ds-1 shrink-0"\n/>',
    }));
    assert('D5. a multi-line tag loses its dropped attributes without leaving blank lines',
        out.source.includes('<Icon icon={FileSignature} size="lg"\n    className="mt-ds-1 shrink-0" />')
        && !/\n[ \t]+\n/.test(out.source),
        JSON.stringify(out.source));
}

console.log('\nC. Size — what is a decision, and is therefore refused');

for (const [label, body, name] of [
    ['C1. an off-scale pixel size', '<Shield size={22} aria-hidden="true" />', 'Shield'],
    ['C2. an off-scale Tailwind pair', '<Shield className="h-12 w-12" aria-hidden="true" />', 'Shield'],
    ['C3. a height and width that disagree', '<Shield className="h-5 w-6" aria-hidden="true" />', 'Shield'],
    ['C4. no size at all — lucide renders 24 and the contract renders 16', '<Shield aria-hidden="true" />', 'Shield'],
]) {
    const source = file({ names: name, body });
    const out = migrate(source);
    assert(`${label} is flagged AND left byte-identical`,
        out.flags.length === 1
        && out.rewritten === 0
        && out.source.includes(body)
        && !out.source.includes('<Icon'),
        `flags=${out.flags.length} rewritten=${out.rewritten}`);
}

{
    const out = migrate(file({ names: 'A, B', body: '<A size={16} aria-hidden="true" />\n<B size={13} aria-hidden="true" />' }));
    assert('C5. one flagged site does not stop the rest of the file migrating',
        out.rewritten === 1 && out.flags.length === 1
        && out.source.includes('<Icon icon={A} />')
        && out.source.includes('<B size={13} aria-hidden="true" />')
        && out.source.includes("import { Icon, A, B } from '@design-system/icons';"),
        out.source);
}

console.log('\nD. Attributes the contract now owns');

{
    const out = migrate(file({ names: 'X', body: '<X size={16} strokeWidth={2} focusable="false" aria-hidden="true" className="text-ds-content-muted" />' }));
    assert('D1. the three defaults are dropped and everything else survives',
        out.source.includes('<Icon icon={X} className="text-ds-content-muted" />'), out.source);
}

{
    const out = migrate(file({ names: 'X', body: '<X size={16} strokeWidth={1.5} aria-hidden="true" />' }));
    assert('D2. a NON-default strokeWidth is a deliberate choice and is kept',
        out.source.includes('<Icon icon={X} strokeWidth={1.5} />'), out.source);
}

{
    const out = migrate(file({ names: 'Shield', body: '<Shield size={24} className="text-ds-status-info-fg" />' }));
    assert('D3. a site that never stated `aria-hidden` is rewritten AND noted',
        out.rewritten === 1 && out.notes.length === 1 && out.flags.length === 0
        && out.source.includes('<Icon icon={Shield} size="2xl" className="text-ds-status-info-fg" />'),
        `notes=${out.notes.length} flags=${out.flags.length}`);
}

{
    const out = migrate(file({ names: 'Shield', body: '<Shield size={24} aria-hidden={true} />' }));
    assert('D4. `aria-hidden={true}` is the same statement as `aria-hidden="true"`',
        out.notes.length === 0 && out.source.includes('<Icon icon={Shield} size="2xl" />'),
        `notes=${out.notes.length} ${out.source}`);
}

console.log(failures === 0
    ? '\nAll codemod rewrite checks passed.'
    : `\n${failures} codemod rewrite check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
