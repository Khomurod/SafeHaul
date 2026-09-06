#!/usr/bin/env node
/**
 * Pins `scripts/codemods/lucide-to-icon-contract.mjs`.
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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from './codemods/lucide-to-icon-contract.mjs';
import { BACKLOG_PATH } from './icon-contract/scope.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

console.log('\nF. A glyph used as a value, not as a tag');

{
    const out = migrate(file({
        names: 'AlertTriangle',
        body: 'function StatusIcon({ icon: Glyph }) { return <Glyph className="h-9 w-9" />; }\n'
            + '<StatusIcon icon={AlertTriangle} />',
    }));
    assert('F1. a tag that renders a LOCAL BINDING is flagged by name — it throws on a screen',
        out.flags.length === 1 && out.flags[0].name === 'Glyph',
        JSON.stringify(out.flags.map((f) => f.name)));
}

{
    const out = migrate(file({
        names: 'AlertTriangle',
        head: "import React from 'react';\nimport { PageState } from '@design-system/patterns';\n",
        body: '<PageState icon={AlertTriangle} title="Nothing yet" />',
    }));
    assert('F2. an IMPORTED container is not flagged — it opens the token itself',
        out.flags.length === 0, JSON.stringify(out.flags.map((f) => f.name)));
}

{
    const out = migrate(file({
        names: 'AlertTriangle',
        head: "import React from 'react';\n",
        body: 'function Panel() { return <Shell><b>hi</b></Shell>; }\n<AlertTriangle size={16} aria-hidden="true" />',
    }));
    assert('F3. a locally-DECLARED component is not a local binding',
        out.flags.length === 1 && out.flags[0].name === 'Shell'
        && !out.flags.some((f) => f.name === 'Panel'),
        JSON.stringify(out.flags.map((f) => f.name)));
}

{
    const out = migrate(file({
        names: 'AlertTriangle, History',
        body: 'let Icon;\nif (x) { Icon = AlertTriangle; } else { Icon = History; }\n'
            + '<Icon size={18} aria-hidden="true" />',
    }));
    assert('F3b. `let Icon;` filled in by a branch is a local binding, not a declaration',
        out.flags.some((f) => f.name === 'Icon'),
        JSON.stringify(out.flags.map((f) => f.name)));
}

{
    const out = migrate(file({
        names: 'Check',
        head: "import React from 'react';\n",
        body: 'const Row = ({ a }) => <b>{a}</b>;\nconst Panel = React.memo(Row);\n'
            + 'const Later = React.lazy(() => import("./x"));\n'
            + '<Row a="x" /><Panel /><Later /><Check size={16} aria-hidden="true" />',
    }));
    assert('F3c. arrow, `memo(...)` and `lazy(...)` assignments ARE declarations',
        out.flags.length === 0, JSON.stringify(out.flags.map((f) => f.name)));
}

{
    const out = migrate(file({
        names: 'Search, Check',
        body: 'const M = { a: Check, b: Search };\n<Search size={16} aria-hidden="true" />',
    }));
    assert('F4. value uses are ONE note for the file, not one per name',
        out.notes.filter((n) => n.name === 'this file').length === 1
        && /glyph reference\(s\) reach code as VALUES/.test(out.notes[0].reason),
        JSON.stringify(out.notes.map((n) => n.name)));
}

{
    const out = migrate(file({ names: 'Search', body: '<Search size={16} aria-hidden="true" />' }));
    assert('F5. the transform\u2019s own `icon={Search}` is not counted as a value use',
        out.notes.length === 0 && out.flags.length === 0, JSON.stringify(out.notes));
}

console.log('\nE. Reading the open tag');

{
    const body = '<Info size={16} title={a > b ? "more" : "less"} aria-hidden="true" />';
    const out = migrate(file({ names: 'Info', body }));
    assert('E1. a `>` inside a braced expression does not end the tag early',
        out.rewritten === 1
        && out.source.includes('<Icon icon={Info} title={a > b ? "more" : "less"} />'),
        out.source);
}

{
    const body = '<Info size={16} data-hint="a > b" aria-hidden="true" />';
    const out = migrate(file({ names: 'Info', body }));
    assert('E2. a `>` inside a quoted attribute does not end the tag early',
        out.rewritten === 1 && out.source.includes('<Icon icon={Info} data-hint="a > b" />'),
        out.source);
}

{
    const body = '<Info size={16} aria-hidden="true">child</Info>';
    const out = migrate(file({ names: 'Info', body }));
    assert('E3. a non-self-closing tag keeps its `>` and its children',
        out.source.includes('<Icon icon={Info}>child</Info>'), out.source);
}

{
    const body = '<Search size={16} aria-hidden="true" />\n<SearchCheck size={20} aria-hidden="true" />';
    const out = migrate(file({ names: 'Search, SearchCheck', body }));
    assert('E4. `Search` does not match inside `SearchCheck`',
        out.rewritten === 2
        && out.source.includes('<Icon icon={Search} />')
        && out.source.includes('<Icon icon={SearchCheck} size="xl" />'),
        out.source);
}

/*
 * E5 compares the WHOLE file, and its first version did not.
 *
 * It asserted `rewritten === 3` and three `includes(...)` — and passed over
 * this, which is what the codemod produces when the edits are applied left to
 * right instead of right to left:
 *
 *     <Icon icon={A} />
 *     <A size={20} aria<Icon icon={A} size="xl" />6 w-6" a<Icon icon={A} size="2xl" />
 *
 * Every fragment it looked for is in there. The count is right. The file is
 * wreckage. A fragment test cannot see damage AROUND the fragment, and every
 * edit after the first lands at an offset measured before it — so this is the
 * one assertion that has to read the whole result.
 *
 * Fourth hollow assertion this campaign has caught by running the mutation
 * rather than reasoning about it, after `classAndAttributeCount`, P22 and P29.
 */
{
    const body = '<A size={16} aria-hidden="true" />\n<A size={20} aria-hidden="true" />\n<A className="h-6 w-6" aria-hidden="true" />';
    const out = migrate(file({ names: 'A', body }));
    const expected = "import React from 'react';\n"
        + "import { Icon, A } from '@design-system/icons';\n\n"
        + '<Icon icon={A} />\n<Icon icon={A} size="xl" />\n<Icon icon={A} size="2xl" />\n';
    assert('E5. three uses of one name all rewrite — offsets are applied right to left',
        out.rewritten === 3 && out.source === expected,
        JSON.stringify(out.source));
}

console.log('\nG. The live backlog, which is the claim this tool actually makes');

/*
 * Fixtures answer "does the transform work". This answers "does it reach every
 * file it says it will", and those are different questions — the second is the
 * one a fixture suite cannot ask itself.
 *
 * It earned its place immediately. The import matcher was written for single
 * quotes; `SuperAdminSidebar.jsx` writes `} from "lucide-react";`, and the run
 * over that file printed "no lucide-react import" for twenty glyphs. Every
 * fixture above was green. Running the matcher over the WHOLE backlog before
 * trusting it on one area is what found it, so that run is now an assertion
 * rather than something somebody remembered to do once.
 *
 * The same sentence this repository already writes about its other gates: a
 * check must not take its scope from something narrower than the claim it is
 * making.
 */
{
    const backlog = JSON.parse(readFileSync(resolve(repoRoot, BACKLOG_PATH), 'utf8'));
    const paths = Object.keys(backlog.files).filter(
        (path) => existsSync(resolve(repoRoot, path)),
    );
    const unreached = paths.filter(
        (path) => migrate(readFileSync(resolve(repoRoot, path), 'utf8')).skipped,
    );
    assert(`G1. every one of the ${paths.length} recorded files has its import recognised`,
        paths.length > 0 && unreached.length === 0,
        unreached.length ? `unreached: ${unreached.slice(0, 5).join(', ')}` : 'the backlog is empty');
}

console.log(failures === 0
    ? '\nAll codemod checks passed.'
    : `\n${failures} codemod check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
