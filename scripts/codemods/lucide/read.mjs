/**
 * What the file SAYS — the reading half of the lucide codemod.
 *
 * Nothing here decides anything. It answers questions about a source file: which
 * specifiers its lucide import brings in, where each glyph is used as a tag,
 * which of its tags render a local binding, and where the text is prose rather
 * than code. `decide.mjs` turns those answers into a size, and
 * `../lucide-to-icon-contract.mjs` rewrites and reports.
 *
 * Split out of that file on 2026-09-06 when the comment mask took it past the
 * 500-line maximum. By responsibility, not by line count: reading a file and
 * deciding what its glyphs should measure are different jobs, and the second one
 * is the one that changes when the design system does.
 */

/**
 * Containers that size the glyph they are handed, so a bare glyph inside one
 * was never 24px and must not gain a size. Used only to sharpen a flag's
 * wording — the flag is raised either way, because an ancestor is not something
 * a line-oriented scan can prove.
 */
export const SIZING_CONTAINERS = /<(?:Button|IconButton|Tab|Tabs|Badge|Chip|SegmentedControl)\b/;

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
export const LUCIDE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(['"])lucide-react\2;[ \t]*\r?\n/m;

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
export function importSpecifiers(block) {
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
export function openTag(source, from) {
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

/**
 * A same-length copy of the source with the CONTENTS of comments and string
 * literals blanked to spaces.
 *
 * Only the search for an opening tag reads this; every edit still slices the
 * real source at the same offsets, which is why the mask has to preserve length
 * and line structure rather than delete anything.
 *
 * It exists because this codebase documents its own markup:
 *
 *     //  *  children were a decorative `<Bell>`/`<Phone>` and a bare number.
 *     //  * name at all — an icon-only button whose only child was a decorative `<X>`.
 *
 * Both were reported as call sites needing a size decision. Neither is a call
 * site. Those two were only FLAGGED, so nothing was rewritten — but a comment
 * that happened to quote `<Bell size={16} />` would have had its prose rewritten
 * into `<Icon icon={Bell} />`, and the diff would have looked deliberate.
 *
 * Strings are masked for the same reason and by the same walk. A `//` inside a
 * URL in a string would otherwise start a comment; masking strings first stops
 * that, and the failure mode if this walk is ever wrong is loud rather than
 * silent — a missed element leaves the file importing `lucide-react`, which
 * `check:icon-contract` refuses.
 */
export function maskCommentsAndStrings(source) {
    const out = source.split('');
    let i = 0;
    const blank = (from, to) => {
        for (let k = from; k < to && k < out.length; k += 1) {
            if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
        }
    };
    while (i < source.length) {
        const two = source.slice(i, i + 2);
        if (two === '//') {
            const end = source.indexOf('\n', i);
            blank(i, end === -1 ? source.length : end);
            i = end === -1 ? source.length : end;
            continue;
        }
        if (two === '/*') {
            const end = source.indexOf('*/', i + 2);
            blank(i, end === -1 ? source.length : end + 2);
            i = end === -1 ? source.length : end + 2;
            continue;
        }
        const ch = source[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            /*
             * An apostrophe BETWEEN LETTERS is prose, not a string opener.
             *
             * `<p>We couldn't find any numbers</p>` is JSX text, and reading its
             * apostrophe as a quote opened a string that ran to the next one and
             * blanked everything between — which is to say, the rest of the file
             * whenever the count is odd. Measured on
             * `NumberAssignmentManager.jsx` on 2026-09-06: three contractions,
             * `elementUses` reported ONE of four `<Phone>`/`<Beaker>`/`<Save>`
             * tags, and the three it could not see survived the migration as raw
             * glyph renders that throw `TypeError: Phone is an icon token`.
             *
             * A string literal never opens after a letter with a letter next:
             * `x = 'abc'` has a space or `=` before it. `return'abc'` would be
             * missed by this rule, and that is the safe direction — a `<Name` seen
             * inside a string is a false FLAG somebody reads, while a `<Name` the
             * scan cannot see is a silent miss that reaches a screen.
             *
             * The post-condition in `migrate()` is what actually closes the class:
             * whatever the mask gets wrong, a glyph tag left in the output that no
             * flag accounts for is reported and fails the run.
             */
            const isInWordApostrophe = ch === "'"
                && i > 0 && /[A-Za-z0-9]/.test(source[i - 1])
                && /[A-Za-z]/.test(source[i + 1] || '');
            if (isInWordApostrophe) {
                i += 1;
                continue;
            }
            let k = i + 1;
            while (k < source.length && source[k] !== ch) {
                if (source[k] === '\\') k += 1;
                k += 1;
            }
            blank(i, Math.min(k + 1, source.length));
            i = k + 1;
            continue;
        }
        i += 1;
    }
    return out.join('');
}

/**
 * Comments blanked, strings LEFT ALONE — a deliberately more conservative read
 * than `maskCommentsAndStrings`, for the post-condition that checks the scan.
 *
 * The point is that it does not share the string masker's blindness. A quote is
 * ambiguous in JSX (`couldn't` is prose, `"x"` is an attribute) and getting it
 * wrong hides code; `//` and `/* *\/` are not ambiguous. So a self-check built on
 * comments alone can see a tag the scan missed, which a self-check built on the
 * same mask never can — that one only ever agrees with itself.
 *
 * It over-reports by design: a glyph tag written inside a STRING (documentation
 * prose quoting `<Trash2 />`, say) counts here and does not count for the scan.
 * That is a loud false alarm somebody reads, against a silent miss that reaches
 * a screen.
 */
export function maskCommentsOnly(source) {
    const out = source.split('');
    let i = 0;
    const blank = (from, to) => {
        for (let k = from; k < to && k < out.length; k += 1) {
            if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
        }
    };
    while (i < source.length) {
        const two = source.slice(i, i + 2);
        if (two === '//') {
            const end = source.indexOf('\n', i);
            blank(i, end === -1 ? source.length : end);
            i = end === -1 ? source.length : end;
            continue;
        }
        if (two === '/*') {
            const end = source.indexOf('*/', i + 2);
            blank(i, end === -1 ? source.length : end + 2);
            i = end === -1 ? source.length : end + 2;
            continue;
        }
        i += 1;
    }
    return out.join('');
}

/** `<Name` openings outside comments — the post-condition's count. */
export function tagOccurrencesOutsideComments(source, name) {
    const lines = [];
    const opener = new RegExp(`<${name}(?=[\\s/>])`, 'g');
    const masked = maskCommentsOnly(source);
    let match = opener.exec(masked);
    while (match) {
        lines.push(lineOf(source, match.index));
        match = opener.exec(masked);
    }
    return lines;
}

/** Every `<Name …>` open tag in the file, outermost first. */
export function elementUses(source, name) {
    const uses = [];
    const opener = new RegExp(`<${name}(?=[\\s/>])`, 'g');
    const masked = maskCommentsAndStrings(source);
    let match = opener.exec(masked);
    while (match) {
        const tag = openTag(source, match.index);
        if (tag) uses.push({ index: match.index, tag });
        match = opener.exec(masked);
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
export function countValueUses(source, name) {
    const body = source.replace(LUCIDE_IMPORT, '');
    const all = body.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'))?.length ?? 0;
    const tags = body.match(new RegExp(`</?${name}(?=[\\s/>])`, 'g'))?.length ?? 0;
    return Math.max(0, all - tags);
}

/**
 * React API property names that a glyph can never be. Everything else spelled as
 * `<a.b …>` is reported, because a member expression is exactly the shape this
 * tool cannot rewrite: it scans for `<Name`, and `<item.icon` has no name to
 * match — so it neither converts the site nor says anything about it.
 */
const REACT_MEMBER_TAGS = new Set(['Provider', 'Consumer', 'Fragment', 'StrictMode', 'Suspense', 'Profiler']);

/**
 * `<a.b …>` tags, which are invisible to every other scan in this file.
 *
 * Found on 2026-09-06 in `CompanySidebar.jsx`, which renders
 * `<item.icon size={20} />` where `item.icon` comes from a lookup of glyph
 * names. After the import moves, that is a token, and rendering a token throws —
 * on the company navigation, on every page. The codemod had rewritten the file,
 * reported no flags for it, and left it broken; three tests caught it.
 *
 * The `localRenderedTags` scan could not see it either, because that one also
 * matches a bare capitalised name. This is a different SHAPE, not a different
 * spelling, which is why it needs its own reader rather than a wider regex.
 */
export function memberExpressionTags(source) {
    const found = new Map();
    const masked = maskCommentsAndStrings(source);
    for (const match of masked.matchAll(/<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?=[\s/>])/g)) {
        const tag = match[1];
        if (REACT_MEMBER_TAGS.has(tag.split('.').pop())) continue;
        if (!found.has(tag)) found.set(tag, lineOf(source, match.index));
    }
    return [...found].map(([tag, line]) => ({ tag, line }));
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
export function localRenderedTags(source) {
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
    for (const tag of maskCommentsAndStrings(source).matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)) {
        if (!known.has(tag[1])) rendered.add(tag[1]);
    }
    return [...rendered];
}

/** The line number a character offset falls on, for a legible flag. */
export function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}
