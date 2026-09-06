#!/usr/bin/env node
/**
 * Phase 7 campaign tooling — move one file off `lucide-react` and onto
 * `@design-system/icons`.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is not a migration. It is the mechanical half of one, plus an honest list
 * of everything it refused to decide. 178 files import glyphs straight from the
 * package; the parts of that which are truly mechanical — the import specifier,
 * a size that is already a step on the scale, an `aria-hidden="true"` that is
 * now the default — are the same edit 700 times and a human doing them by hand
 * will make a typo. The parts that are not mechanical are design decisions, and
 * a codemod that guessed at them would produce a diff nobody could review,
 * because every line would look equally considered.
 *
 * So every site lands in exactly one of three buckets:
 *
 *   REWRITTEN — the transform is provably appearance-preserving.
 *   FLAGGED   — a decision about SIZE. Printed with the reason, left untouched.
 *   NOTED     — rewritten, and carrying a question about MEANING that the size
 *               transform did not answer: the call site never said whether the
 *               glyph is decoration or the control's only name.
 *
 * The split matters because the two need opposite handling. A flag is work
 * still to do in the file; a note is a reading to confirm in the diff. Printing
 * both as one list would have buried the four sites that need an edit under the
 * dozen that need a glance.
 *
 * A file with any flag is still rewritten for everything else; the flags are
 * the hand-review list for the pull request, not a refusal to run.
 *
 * ## What it found on the whole backlog, before any area was touched
 *
 * 545 mechanical rewrites, 83 size decisions, and — the reason the third
 * detector exists — **21 files that render a glyph held in a local binding**:
 *
 *     const { Icon } = AGREEMENT_PRESENTATION[status];
 *     <Icon size={16} />
 *
 * Once the name is a token that throws, on a screen, in a branch a unit test
 * does not reach. Twenty of the twenty-one are exactly that; the twenty-first
 * is a heading level held in a prop, which has the same shape and is fine. No
 * test in this repository would have caught any of them before a user did.
 *
 * ## The one thing that makes a bare glyph dangerous
 *
 * `<Search />` from lucide renders at **24px** — its own default. `<Icon
 * icon={Search} />` renders at 16px, because `md` is the scale's default. A
 * codemod that dropped the missing size on the floor would silently shrink
 * every unsized glyph in the application by a third.
 *
 * It is not enough to answer "then map bare to 2xl", either, because a glyph
 * inside `Button`, `Tabs`, `Badge` or `IconButton` is sized by its container's
 * own CSS and always was — lucide's 24 never applied there. Those two cases
 * need opposite edits and they look identical in the source, so both are
 * FLAGGED and neither is guessed.
 *
 * ## Usage
 *
 *     node scripts/codemods/lucide-to-icon-contract.mjs <file...>            # report only
 *     node scripts/codemods/lucide-to-icon-contract.mjs --apply <file...>    # rewrite
 *
 * This file is campaign tooling. It is deleted with
 * `src/design-system/icons/lucide-import.backlog.json`, when the last entry goes.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** Pixel → step, from `foundation.css` `--ds-icon-size-*`. */
const STEP_FOR_PIXELS = new Map([
    [12, 'xs'], [14, 'sm'], [16, 'md'], [18, 'lg'], [20, 'xl'], [24, '2xl'], [32, '3xl'],
]);

/** Tailwind's `h-N`/`w-N` are quarter-rem: `h-4` is 1rem is 16px. */
const PIXELS_FOR_TAILWIND_STEP = new Map([
    [3, 12], [3.5, 14], [4, 16], [5, 20], [6, 24], [8, 32],
]);

/**
 * Containers that size the glyph they are handed, so a bare glyph inside one
 * was never 24px and must not gain a size. Used only to sharpen a flag's
 * wording — the flag is raised either way, because an ancestor is not something
 * a line-oriented scan can prove.
 */
const SIZING_CONTAINERS = /<(?:Button|IconButton|Tab|Tabs|Badge|Chip|SegmentedControl)\b/;

/**
 * The lucide import statement.
 *
 * `[^}]*` and not `[\s\S]*?`, which is the first version and was wrong in a way
 * a report reads straight past. A lazy any-character group starts at the FIRST
 * `import {` in the file and expands across statements until it finds
 * `} from 'lucide-react';` — so in a file whose earlier line is
 * `import { useParams } from 'react-router-dom';` it captured that name too, and
 * the run reported two glyphs where the source has one and silently skipped the
 * real import's other names. Refusing to cross a `}` cannot do that: the wrong
 * statement's own brace ends the group, `from 'lucide-react'` fails to follow,
 * and the engine moves on to the next `import {`.
 *
 * Both quote styles, because one of the 175 files uses double quotes and the
 * single-quoted version matched nothing there — the run printed
 * "no lucide-react import" for a file with twenty glyphs in it. A backreference
 * rather than a character class, so `'lucide-react"` is not a match. Found by
 * running the regex over the whole backlog before trusting it on one area, which
 * is the same reason `A9` exists.
 */
const LUCIDE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(['"])lucide-react\2;[ \t]*\r?\n/m;

/**
 * The specifiers one `import { … } from 'lucide-react'` brings in, as
 * `{ imported, local }`.
 *
 * The two are not always the same, and collapsing them is a run-time break the
 * first version shipped. `import { Image as ImageIcon }` renders `<ImageIcon>`;
 * taking the imported name for both wrote `Image` into the new import, left
 * `<ImageIcon>` untouched because nothing matched it, and produced
 * `ReferenceError: ImageIcon is not defined` on the driver's upload field.
 *
 * So the LOCAL name is what the file writes and what element matching uses, and
 * the IMPORTED name is what the registry exports — the rewritten import carries
 * both, exactly as the original did. Five files in the campaign are aliased:
 * `Image as ImageIcon`, `Link as LinkIcon` twice, `Users as UsersIcon`.
 */
function importSpecifiers(block) {
    return block
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [imported, local] = entry.split(/\s+as\s+/).map((part) => part.trim());
            return { imported, local: local || imported };
        });
}

/**
 * The open tag starting at `from`, as text, honouring quotes and braces.
 *
 * Not a regex to `/>` — `<X title={a > b ? 'y' : 'n'} />` and a `>` inside a
 * string both end it early, and an open tag read too short is the same class of
 * mistake as a body read too short: it makes the caller act on a fragment.
 */
function openTag(source, from) {
    let depth = 0;
    let quote = null;
    for (let i = from; i < source.length; i += 1) {
        const ch = source[i];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '{') { depth += 1; continue; }
        if (ch === '}') { depth -= 1; continue; }
        if (ch === '>' && depth === 0) return source.slice(from, i + 1);
    }
    return null;
}

/** Every `<Name …>` open tag in the file, outermost first. */
function elementUses(source, name) {
    const uses = [];
    const opener = new RegExp(`<${name}(?=[\\s/>])`, 'g');
    let match = opener.exec(source);
    while (match) {
        const tag = openTag(source, match.index);
        if (tag) uses.push({ index: match.index, tag });
        match = opener.exec(source);
    }
    return uses;
}

/**
 * How many times `name` appears NOT as `<name` and NOT inside the import.
 *
 * A word-boundary count of the identifier, minus its tag uses and its one
 * mention in the import specifier list. Deliberately crude, and reported as ONE
 * line per file rather than one per name: run over the whole backlog it finds
 * 312 sites, nearly all of them the safe shape — a glyph in a lookup handed to a
 * design-system container, which opens the token itself. 312 lines of "have a
 * look at this" is a report nobody reads, which is worse than no report. The
 * dangerous shape gets its own detector below, by name and by line.
 */
function countValueUses(source, name) {
    const body = source.replace(LUCIDE_IMPORT, '');
    const all = body.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'))?.length ?? 0;
    const tags = body.match(new RegExp(`</?${name}(?=[\\s/>])`, 'g'))?.length ?? 0;
    return Math.max(0, all - tags);
}

/**
 * Capitalised JSX tags whose name is a LOCAL BINDING — not imported, and not a
 * component this file declares.
 *
 * This is the shape that breaks, and it breaks at run time on a screen rather
 * than in any test:
 *
 *     const { Icon } = AGREEMENT_PRESENTATION[status];   // a glyph from a map
 *     <Icon size={16} />                                  // throws once it is a token
 *
 * A design-system container resolves its `icon` prop through `glyphComponent`,
 * so `<PageState icon={AlertTriangle} />` is fine. Local code that renders the
 * value directly is not, and the two are indistinguishable at the call site —
 * the difference is in the receiver. So look at the receiver: a tag whose name
 * this file neither imported nor declared can only be a local binding, whatever
 * route the value took to get there.
 *
 * Found three sites on its first run — `PreservedApplicationView`,
 * `SubmissionRecordNotice` and `PortalStatusScreens` — and each one would have
 * been a white screen.
 */
function localRenderedTags(source) {
    const known = new Set();
    for (const spec of source.matchAll(/^import\s+([^;]+?)\s+from\s+['"][^'"]+['"];/gm)) {
        for (const name of spec[1].matchAll(/[A-Za-z_$][\w$]*/g)) known.add(name[0]);
    }
    /*
     * A DECLARATION, not any capitalised binding. `let Icon;` filled in by a
     * three-branch `if` and then rendered is exactly the shape this is looking
     * for, and the first version counted it as a component and stayed silent —
     * `SubmissionRecordNotice.jsx` is that file, and it would have thrown.
     * So a name is only "declared here" if it is declared as something
     * callable: a function, a class, or an arrow / function expression / `memo`
     * / `forwardRef` assignment.
     */
    for (const decl of source.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:function|class)\s+([A-Z][\w$]*)/g)) {
        known.add(decl[1]);
    }
    const CALLABLE = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:\([^)]*\)\s*=>|[\w$]+\s*=>|function\b|(?:React\.)?(?:memo|forwardRef|lazy)\s*\()/g;
    for (const decl of source.matchAll(CALLABLE)) known.add(decl[1]);
    const rendered = new Set();
    for (const tag of source.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)) {
        if (!known.has(tag[1])) rendered.add(tag[1]);
    }
    return [...rendered];
}

/** The line number a character offset falls on, for a legible flag. */
function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

/**
 * Decide the size step for one open tag.
 *
 * Returns `{ step, tag }` when the answer is provable, or `{ flag }` when it is
 * a design decision. `tag` comes back with the attributes the transform consumed
 * already removed, so the caller never has to strip them twice.
 */
function resolveSize(tag) {
    const pixels = tag.match(/\s+size=\{(\d+)\}/);
    if (pixels) {
        const value = Number(pixels[1]);
        const step = STEP_FOR_PIXELS.get(value);
        if (!step) {
            return {
                flag: `size={${value}} is not a step on the scale `
                    + `(${[...STEP_FOR_PIXELS.keys()].join('/')}). Snapping it changes what `
                    + 'is on screen — decide whether the glyph belongs in a container that '
                    + 'owns this size (StatusMedallion, PageState) or whether the nearest '
                    + 'step is right.',
            };
        }
        return { step, tag: tag.replace(pixels[0], '') };
    }

    const geometry = tag.match(/\s+className="([^"]*)"/);
    if (geometry) {
        const height = geometry[1].match(/(?:^|\s)h-(\d+(?:\.5)?)(?=\s|$)/);
        const width = geometry[1].match(/(?:^|\s)w-(\d+(?:\.5)?)(?=\s|$)/);
        if (height && width) {
            if (height[1] !== width[1]) {
                return { flag: `h-${height[1]} and w-${width[1]} disagree — a glyph is square.` };
            }
            const value = PIXELS_FOR_TAILWIND_STEP.get(Number(height[1]));
            const step = value && STEP_FOR_PIXELS.get(value);
            if (!step) {
                return {
                    flag: `h-${height[1]} w-${width[1]} is not a step on the scale. Same `
                        + 'decision as an off-scale pixel size.',
                };
            }
            const stripped = geometry[1]
                .replace(/(?:^|\s)[hw]-\d+(?:\.5)?(?=\s|$)/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const attribute = stripped ? ` className="${stripped}"` : '';
            // The whole run of whitespace was consumed with the attribute, so a
            // surviving className brings its own single space back.

            return { step, tag: tag.replace(geometry[0], attribute) };
        }
    }

    return {
        flag: 'no size at all. lucide renders 24px by default and the contract renders 16 — '
            + 'so this is size="2xl" if the glyph stands alone, and no size at all if a '
            + 'container already sizes it'
            + (SIZING_CONTAINERS.test(tag) ? ' (a sizing container is on this very tag)' : '')
            + '. The two look identical here.',
    };
}

/**
 * Attributes the contract now supplies, which a call site should stop stating.
 *
 * `\s+` and not `\s`, because a tag written across several lines puts a newline
 * and an indent in front of each attribute. Consuming one space left the rest
 * behind, and a four-line tag came out with two whitespace-only lines in the
 * middle of it:
 *
 *     <Icon icon={FileSignature} size="lg"
 *
 *
 *         className={…} />
 *
 * Lint passes on that and a reviewer should not have to. Taking the whole run
 * closes the gap the attribute leaves, so a one-line tag stays on one line and a
 * multi-line tag keeps its shape with one fewer line.
 */
function dropDefaults(tag) {
    return tag
        .replace(/\s+aria-hidden=(?:"true"|\{true\})/g, '')
        .replace(/\s+strokeWidth=\{2\}/g, '')
        .replace(/\s+focusable="false"/g, '');
}

/** Rewrite one file. Returns `{ source, rewritten, flags, names, needsIcon }`. */
export function migrate(source, { path = '<source>' } = {}) {
    const flags = [];
    const notes = [];
    const importMatch = source.match(LUCIDE_IMPORT);
    if (!importMatch) {
        return {
            source, rewritten: 0, flags, notes, names: [], needsIcon: false, skipped: true,
        };
    }

    const specifiers = importSpecifiers(importMatch[1]);
    const names = specifiers.map((specifier) => specifier.local);
    let out = source;
    let rewritten = 0;
    let needsIcon = false;

    /*
     * A name used as a VALUE rather than as a tag — scanned HERE, before a
     * single edit, because the transform's own output contains the name as a
     * value: `<Icon icon={Search} />`. Scanning afterwards reported every
     * rewritten site as a value use, which is the check accusing the fix.
     *
     * `<PageState icon={AlertTriangle} />` is fine — every design-system
     * container resolves its `icon` prop through `glyphComponent`, which opens a
     * token. But this application also has LOCAL components taking the same prop
     * and rendering it straight:
     *
     *     function StatusIcon({ icon: Icon }) { return <Icon className="h-9 w-9" />; }
     *
     * After the import moves, `AlertTriangle` is a token, and rendering a token
     * throws by construction — at run time, on a screen, not in this file. The
     * codemod cannot follow the value to its consumer, and a report silent about
     * it would read exactly like a file with no work left.
     *
     * `PortalStatusScreens.jsx` is the site that proved this: five names, zero
     * elements, and a local renderer that would have thrown on the public
     * verification portal.
     */
    const importLine = lineOf(source, source.indexOf(importMatch[0]));

    /* One line, not one per name. See `countValueUses` for why. */
    const valueUses = names.reduce((total, name) => total + countValueUses(source, name), 0);
    if (valueUses > 0) {
        notes.push({
            line: importLine,
            name: 'this file',
            reason: `${valueUses} glyph reference(s) reach code as VALUES rather than tags. A `
                + 'design-system container opens the token for you; follow anything that goes '
                + 'somewhere else.',
        });
    }

    for (const tag of localRenderedTags(source)) {
        const at = source.search(new RegExp(`<${tag}(?=[\\s/>])`));
        flags.push({
            line: at >= 0 ? lineOf(source, at) : importLine,
            name: tag,
            reason: `<${tag}> renders a LOCAL BINDING, not an imported component. If a glyph `
                + 'can reach it, that glyph is rendered directly and a token throws — on a '
                + `screen, not in a test. Either rewrite it as \`<Icon icon={${tag}} />\`, or `
                + 'satisfy yourself no glyph reaches it: a heading level held in a prop has '
                + 'this exact shape and is fine.',
        });
    }

    for (const name of names) {
        /*
         * Right to left: every edit shortens the file, and an index taken before
         * an earlier edit would point into the middle of a tag after it.
         */
        for (const use of elementUses(out, name).reverse()) {
            const size = resolveSize(use.tag);
            if (size.flag) {
                flags.push({ line: lineOf(out, use.index), name, reason: size.flag });
                continue;
            }
            if (!/\saria-hidden=(?:"true"|\{true\})/.test(use.tag)) {
                notes.push({
                    line: lineOf(out, use.index),
                    name,
                    reason: 'the call site never stated `aria-hidden`, so it never said whether '
                        + 'this glyph is decoration beside a word or the only name the control '
                        + 'has. The contract now hides it. Confirm there is a visible or '
                        + 'accessible name beside it — otherwise it needs `label`.',
                });
            }
            const attributes = dropDefaults(size.tag)
                .replace(new RegExp(`^<${name}`), '')
                .replace(/\s*\/?>$/, '');
            const selfClosing = /\/>\s*$/.test(use.tag);
            const replacement = `<Icon icon={${name}}${size.step === 'md' ? '' : ` size="${size.step}"`}`
                + `${attributes}${selfClosing ? ' />' : '>'}`;
            out = out.slice(0, use.index) + replacement + out.slice(use.index + use.tag.length);
            rewritten += 1;
            needsIcon = true;
        }
    }

    /*
     * `Icon` leads the list and the glyph names keep their order. Sorting them
     * would put a rename in every migrated file's diff for no reason.
     */
    const written = specifiers.map(
        ({ imported, local }) => (imported === local ? local : `${imported} as ${local}`),
    );
    out = out.replace(
        LUCIDE_IMPORT,
        `import { ${(needsIcon ? ['Icon', ...written] : written).join(', ')} } from '@design-system/icons';\n`,
    );

    return { source: out, rewritten, flags, notes, names, needsIcon, skipped: false, path };
}

function main(argv) {
    const apply = argv.includes('--apply');
    const paths = argv.filter((arg) => arg !== '--apply');
    if (paths.length === 0) {
        process.stderr.write('usage: lucide-to-icon-contract.mjs [--apply] <file...>\n');
        return 1;
    }

    let flagged = 0;
    let noted = 0;
    for (const path of paths) {
        const before = readFileSync(path, 'utf8');
        const result = migrate(before, { path });
        if (result.skipped) {
            process.stdout.write(`  --  ${path}: no lucide-react import\n`);
            continue;
        }
        const verb = apply ? 'rewrote' : 'would rewrite';
        process.stdout.write(
            `\n${path}\n     ${verb} ${result.rewritten} element(s); `
            + `${result.names.length} glyph name(s) move to @design-system/icons\n`,
        );
        for (const flag of result.flags) {
            flagged += 1;
            process.stdout.write(`     FLAG ${path}:${flag.line} <${flag.name}> — ${flag.reason}\n`);
        }
        for (const note of result.notes) {
            noted += 1;
            process.stdout.write(`     NOTE ${path}:${note.line} <${note.name}> — ${note.reason}\n`);
        }
        if (apply && result.source !== before) writeFileSync(path, result.source);
    }

    process.stdout.write(
        `\n${flagged} site(s) flagged — a size decision, and nothing flagged was changed.`
        + `\n${noted} site(s) noted — rewritten, and the accessible reading needs confirming.\n`,
    );
    return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    process.exit(main(process.argv.slice(2)));
}
