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

import {
    LUCIDE_IMPORT, countValueUses, elementUses, importSpecifiers, lineOf, localRenderedTags,
    tagOccurrencesOutsideComments,
} from './lucide/read.mjs';
import { dropDefaults, resolveSize } from './lucide/decide.mjs';

/*
 * ONE HAZARD THIS TOOL CANNOT CLOSE, AND IT COST A REAL DEFECT.
 *
 * The import written below carries `Icon` only when this tool wrote a tag
 * (`needsIcon`). That is correct for what it wrote and WRONG for what a person
 * adds afterwards: a FLAGGED site is by definition one this tool refused to
 * decide, so repairing it by hand as `<Icon icon={X} …>` renders a component the
 * import does not carry. Three files shipped out of the `shared` slice that way
 * on 2026-09-06 — two crash screens and an App-root offline banner — each
 * throwing `ReferenceError: Icon is not defined` on render.
 *
 * After repairing any flag, CHECK THE IMPORT LINE. `npm run lint:frontend` is
 * what proves it: `react/jsx-no-undef` is `error` for this reason and is pinned
 * by `scripts/test-icon-contract-ci.mjs` X15/X16.
 */

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
                + `screen, not in a test. Either rewrite it as \`<Icon icon={${tag}} />\` `
                + '— AND ADD `Icon` TO THIS FILE\'S IMPORT, which this tool does not do for a '
                + 'flag it refused to decide — or satisfy yourself no glyph reaches it: a '
                + 'heading level held in a prop has this exact shape and is fine.'
                + (tag === 'Icon'
                    ? ' AND THIS ONE IS NAMED `Icon`, which is the contract\'s own component: '
                        + 'the import this codemod adds is shadowed inside whatever declares it, '
                        + 'so rename the LOCAL binding (`icon: Glyph`) rather than writing '
                        + '`<Icon icon={Icon} />`. Thirteen files in the campaign do this.'
                    : ''),
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
     * POST-CONDITION: nothing this tool could not SEE is left behind silently.
     *
     * The scan reads a masked copy of the file, and a mask is a small parser
     * pretending to be a big one — it has now been wrong twice, once about
     * comments and once about the apostrophe in `couldn't`, and the second one
     * hid three tags in a file it reported as finished. So the tool checks its
     * own work: after every edit, a glyph name may still appear as a tag ONLY
     * because a flag says so. Any other survivor is a MISS, and a miss is louder
     * than a flag because nobody asked for it.
     *
     * **The check must not read the file the way the scan does.** Asking the same
     * mask a second time only ever gets the same answer — a region the scan could
     * not see is a region the check cannot see either, so the 2026-09-06 defect
     * would have passed its own post-condition. It counts through
     * `maskCommentsOnly` instead: comments are unambiguous, strings are not, so
     * the conservative reading sees everything the scan sees and more.
     *
     * That over-reports on a glyph tag written inside a string, which is the
     * direction to fail in. Counted rather than matched by line, because an edit
     * that drops `aria-hidden` can remove one. (A local binding sharing a glyph's
     * name would inflate the flag count and soften this by one; no file in the
     * campaign does.)
     */
    const missed = [];
    for (const name of names) {
        const remaining = tagOccurrencesOutsideComments(out, name);
        const flagged = flags.filter((flag) => flag.name === name).length;
        if (remaining.length > flagged) {
            missed.push({ name, count: remaining.length - flagged, lines: remaining });
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

    return { source: out, rewritten, flags, notes, names, needsIcon, missed, skipped: false, path };
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
    let missed = 0;
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
        for (const miss of result.missed) {
            missed += 1;
            process.stdout.write(
                `     MISS ${path}:${miss.lines.join(',')} <${miss.name}> — ${miss.count} tag(s) `
                + 'left unrewritten that no flag accounts for. The scan could not SEE them, so '
                + 'they would survive as raw glyph renders and throw. Do not hand-patch the file '
                + 'and move on: find out what the mask got wrong.\n',
            );
        }
        if (apply && result.source !== before) writeFileSync(path, result.source);
    }

    process.stdout.write(
        `\n${flagged} site(s) flagged — a size decision, and nothing flagged was changed.`
        + `\n${noted} site(s) noted — rewritten, and the accessible reading needs confirming.`
        + `\n${missed} site(s) MISSED — the scan went blind; the run fails.\n`,
    );
    return missed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    process.exit(main(process.argv.slice(2)));
}
