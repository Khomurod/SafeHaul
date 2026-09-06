#!/usr/bin/env node
/**
 * Pins what `scripts/codemods/lucide-to-icon-contract.mjs` READS.
 *
 * Its sibling `test-icon-contract-codemod.mjs` pins what it writes. This half is
 * the one that has actually caught things, and the reason is in the preamble
 * below: a bad rewrite is visible in the diff, while a bad READ produces an
 * absence — a tag nobody converted, in a file the report called finished.
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
console.log('\nH. Comments and strings are not call sites');

/*
 * H1/H2 exist because this codebase documents its own markup, and the codemod
 * reported two comments as call sites needing a size decision:
 *
 *     //  *  children were a decorative `<Bell>`/`<Phone>` and a bare number.
 *     //  * an icon-only button whose only child was a decorative `<X>`.
 *
 * Both happened to be FLAGGED rather than rewritten, so nothing was damaged.
 * A comment quoting `<Bell size={16} />` would have had its prose rewritten
 * into `<Icon icon={Bell} />`, and the diff would have looked deliberate.
 */
{
    const out = migrate(file({
        names: 'Bell',
        body: '/* a decorative `<Bell size={16} />` beside the count */\n<Bell size={20} aria-hidden="true" />',
    }));
    assert('H1. a tag quoted inside a block comment is not a call site',
        out.rewritten === 1
        && out.source.includes('/* a decorative `<Bell size={16} />` beside the count */')
        && out.source.includes('<Icon icon={Bell} size="xl" />'),
        out.source);
}

{
    const out = migrate(file({
        names: 'Bell',
        body: '// the old `<Bell size={16} />` had no name\n<Bell size={20} aria-hidden="true" />',
    }));
    assert('H2. and neither is one inside a line comment',
        out.rewritten === 1 && out.source.includes('// the old `<Bell size={16} />` had no name'),
        out.source);
}

{
    const out = migrate(file({
        names: 'Bell',
        body: "const doc = 'renders <Bell size={16} />';\n<Bell size={20} aria-hidden=\"true\" />",
    }));
    assert('H3. nor one inside a string literal',
        out.rewritten === 1 && out.source.includes("const doc = 'renders <Bell size={16} />';"),
        out.source);
}

{
    const out = migrate(file({
        names: 'Bell',
        body: '// see https://example.test/docs\n<Bell size={20} aria-hidden="true" />',
    }));
    assert('H4. a URL inside a comment does not swallow the line after it',
        out.rewritten === 1 && out.source.includes('<Icon icon={Bell} size="xl" />'),
        out.source);
}

/*
 * H5-H8: the apostrophe. Measured on `NumberAssignmentManager.jsx` on
 * 2026-09-06, in the settings slice: three contractions in ordinary JSX prose
 * ("Couldn't Load SMS Settings", "We couldn't find any phone numbers"), and the
 * scan reported ONE of four tags. The masker read `couldn't` as a string
 * opening, ran to the next apostrophe, and blanked everything between — which
 * with an odd count is the rest of the file. The three tags it could not see
 * survived the migration as raw glyph renders and threw
 * `TypeError: Phone is an icon token` on the SMS settings screen.
 *
 * H8 is the important one and does not depend on knowing that cause: whatever a
 * future mask gets wrong, a glyph tag left behind that no flag accounts for is
 * reported and fails the run.
 */
{
    const out = migrate(file({
        names: 'Bell',
        body: '<p>We couldn\'t find it</p>\n<Bell size={20} aria-hidden="true" />',
    }));
    assert('H5. an apostrophe in JSX prose does not blank the rest of the file',
        out.rewritten === 1 && out.source.includes('<Icon icon={Bell} size="xl" />'),
        out.source);
}

{
    const out = migrate(file({
        names: 'Bell, Phone',
        body: "<h3>Couldn't Load</h3>\n<Bell size={20} aria-hidden=\"true\" />\n"
            + "<p>We couldn't reach it</p>\n<Phone size={24} aria-hidden=\"true\" />",
    }));
    assert('H6. two contractions do not hide the tag between them, nor the one after',
        out.rewritten === 2
        && out.source.includes('<Icon icon={Bell} size="xl" />')
        && out.source.includes('<Icon icon={Phone} size="2xl" />'),
        out.source);
}

{
    const out = migrate(file({
        names: 'Bell',
        body: "const doc = 'renders <Bell size={16} />';\n<Bell size={20} aria-hidden=\"true\" />",
    }));
    assert('H7. and a REAL single-quoted string is still masked — the fix is narrow',
        out.rewritten === 1 && out.source.includes("const doc = 'renders <Bell size={16} />';"),
        out.source);
}

/*
 * H8 drives the post-condition rather than the mask. `<Bell>` inside a template
 * literal is invisible to the scan (a backtick string) and visible to
 * `maskCommentsOnly`, which is exactly the asymmetry the check is built on: it
 * reports rather than staying silent. A check that read the file the way the
 * scan does could never fire, which is what made the first version of this
 * post-condition worthless.
 */
{
    const out = migrate(file({
        names: 'Bell',
        body: 'const doc = `renders <Bell size={16} />`;\n<Bell size={20} aria-hidden="true" />',
    }));
    assert('H8. a glyph tag the scan cannot see is reported as a MISS, not passed over',
        out.rewritten === 1 && out.missed.length === 1
        && out.missed[0].name === 'Bell' && out.missed[0].count === 1,
        JSON.stringify(out.missed));
}

{
    const out = migrate(file({ names: 'Bell', body: '<Bell size={20} aria-hidden="true" />' }));
    assert('H9. and a clean file reports no MISS at all',
        out.rewritten === 1 && out.missed.length === 0, JSON.stringify(out.missed));
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
    ? '\nAll codemod reading checks passed.'
    : `\n${failures} codemod reading check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
