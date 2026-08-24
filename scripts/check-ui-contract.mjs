#!/usr/bin/env node
/**
 * Repository guard: new UI code cannot casually reintroduce the inconsistencies
 * this design system exists to remove.
 *
 * Run:    `npm run check:ui-contract`
 * Update: `npm run check:ui-contract -- --update`   (after a migration shrinks it)
 *
 * ## Why this exists
 *
 * The design system was substantial and largely adopted, and the application was
 * still visibly inconsistent, because *nothing checked*. A 2026-08 audit of the
 * tree found 364 raw Tailwind palette classes across 49 files, 142 raw type
 * classes competing with the `--ds-*` scale, and 26 pieces of text below the
 * 12px floor the roadmap had forbidden in writing since the beginning. Every one
 * of those passed review, lint, 234 test files and CI.
 *
 * A rule that lives only in a document is a rule that is followed until someone
 * is in a hurry.
 *
 * ## How it ratchets
 *
 * Zero-tolerance on day one would have been unmergeable, so this measures
 * against a committed inventory — `src/design-system/ui-contract.baseline.json`
 * — and enforces that the numbers only ever go **down**:
 *
 *   - a violation in a file that is not in the inventory  -> fail
 *   - more violations in a file than the inventory records -> fail
 *   - fewer                                                -> fail, "run --update"
 *
 * Failing on a *decrease* is deliberate. It keeps the inventory honest, so it
 * can never quietly describe a tree that no longer exists, and it makes every
 * migration's shrinkage visible in its own diff. `--update` rewrites the file.
 *
 * Each entry carries either a `reason` (a permanent, roadmap-referenced
 * exception — the VOE export document, brand artwork) or a `debt` note naming
 * the slice that will clear it. When the last `debt` entry goes, this check
 * becomes zero-tolerance and the inventory is deleted.
 *
 * ## What it deliberately does not flag
 *
 * Semantic HTML. A `<button>` is not a violation; a `<button>` wearing
 * hand-written padding and a background colour is. A `<table>` is not a
 * violation; the roadmap approves the native-table pattern for editable
 * matrices, and those are listed by path. A brittle check that fires on correct
 * markup gets switched off, which is worse than no check.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Resolved lazily, not at module scope. `countViolations` and `stripComments`
 * are imported by `src/tests/uiContract.ratchet.test.js` to prove this guard can
 * fail, and Vitest rewrites `import.meta.url` to a non-file URL — computing
 * paths on import made the whole module throw before a single rule could run.
 */
function repoRoot() {
    return fileURLToPath(new URL('..', import.meta.url));
}
function srcRoot() {
    return path.join(repoRoot(), 'src');
}
function baselinePath() {
    return path.join(srcRoot(), 'design-system/ui-contract.baseline.json');
}

/* ------------------------------------------------------------------ *
 * Source scanning
 * ------------------------------------------------------------------ */

const isTestFile = (name) => /\.(test|spec)\.[jt]sx?$/.test(name);
const isStory = (name) => /\.stories\.[jt]sx?$/.test(name);

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        if (!/\.[jt]sx?$/.test(entry.name)) return [];
        // Tests assert on the very strings these rules forbid, and stories are
        // catalog furniture already covered by `test:stories` and the a11y lane.
        if (isTestFile(entry.name) || isStory(entry.name)) return [];
        return [target];
    });
}

/**
 * Strips comments while **keeping string literals**.
 *
 * The opposite of what `noBlockingBrowserDialogs.test.js` needs, and for the
 * opposite reason: a class name lives *inside* a string, so stripping strings
 * would blind every rule here. Comments must still go, because this repository
 * documents the defects it fixed in prose — several files explain the exact
 * `bg-blue-600` they removed, and matching that would report a fix as a
 * violation.
 */
export function stripComments(source) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';

    while (i < source.length) {
        const two = source.slice(i, i + 2);

        if (state === 'code') {
            if (two === '/*') { state = 'block'; i += 2; continue; }
            if (two === '//') { state = 'line'; i += 2; continue; }
            if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
                state = 'string'; quote = source[i]; out += source[i]; i += 1; continue;
            }
            out += source[i]; i += 1; continue;
        }

        if (state === 'block') {
            if (two === '*/') { state = 'code'; i += 2; continue; }
            if (source[i] === '\n') out += '\n';
            i += 1; continue;
        }

        if (state === 'line') {
            if (source[i] === '\n') { state = 'code'; out += '\n'; }
            i += 1; continue;
        }

        // state === 'string' — kept verbatim, including escapes.
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === quote) { state = 'code'; }
        out += source[i]; i += 1;
    }

    return out;
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

const TAILWIND_PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_PREFIX = 'bg|text|border|ring|from|to|via|divide|placeholder|decoration|outline|accent|caret|fill|stroke|shadow';

/**
 * A rule is a name, a global regex, and the sentence a developer needs to read
 * when it fires. The message is the whole point: a guard that says only "failed"
 * teaches nothing and gets an exemption added instead of a fix.
 */
const RULES = [
    {
        name: 'raw-palette-class',
        pattern: new RegExp(`\\b(?:${COLOR_PREFIX})-(?:${TAILWIND_PALETTE})-\\d{2,3}\\b`, 'g'),
        remedy: 'Use a `--ds-*` semantic role (`bg-ds-surface`, `text-ds-content-secondary`, '
            + '`border-ds-border`). If no role fits, add one to `tokens/semantic.css` with '
            + 'contrast evidence — do not reach past the contract.',
    },
    {
        name: 'raw-hex-colour',
        // In a className or a style value. `#` in a URL or an id selector is not a colour.
        pattern: /(?:bg|text|border|ring|fill|stroke|shadow)-\[#[0-9a-fA-F]{3,8}\]|(?:color|background|border|fill|stroke)\s*:\s*['"]?#[0-9a-fA-F]{3,8}\b/g,
        remedy: 'Use a `--ds-*` semantic role. An exported document or a brand asset that '
            + 'genuinely cannot resolve a custom property is an exception — record it.',
    },
    {
        name: 'sub-12px-type',
        pattern: /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g,
        remedy: 'The interface floor is 12px (`text-ds-xs`). This has been the written rule '
            + 'since the beginning and was never enforced, which is why 26 of them exist.',
    },
    {
        name: 'off-scale-type',
        // Tailwind's own scale (12/14/18/20…) is not the `--ds-*` scale
        // (12/13/14/15/16/18/20/24), so mixing them *is* the inconsistent typography.
        pattern: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/g,
        remedy: 'Use the `--ds-*` type scale (`text-ds-xs|sm|body|body-lg|heading-sm|'
            + 'heading-md|heading-lg|heading-xl`). Tailwind\'s scale is a different set of '
            + 'sizes, so a screen mixing both has two type systems on it.',
    },
    {
        name: 'arbitrary-type-size',
        pattern: /text-\[[0-9.]+(?:rem|em)\]|text-\[(?:1[2-9]|[2-9]\d)(?:\.\d+)?px\]/g,
        remedy: 'Add the size to the type scale if it is genuinely needed, or use the nearest '
            + 'scale step. An arbitrary size is a new type scale of one.',
    },
    {
        name: 'hand-built-overlay',
        pattern: /fixed inset-0/g,
        /*
         * Passing `overlayClassName` to `Modal` is the approved way to position a
         * dialog, and those values legitimately contain `fixed inset-0` — the
         * roadmap says a scan should return `Modal` itself *and* its
         * `overlayClassName` callers. Counting them would have made this rule fire
         * on 20 correct call sites, and a check that flags correct code gets
         * switched off. `prepare` removes those attribute values before matching,
         * so what is left is a genuinely hand-built overlay.
         */
        prepare: (code) => code.replace(/overlayClassName\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\}|\{[^}]*\})/g, 'overlayClassName={…}'),
        remedy: 'Every overlay goes through `Modal` from `@design-system/patterns`. Passing it '
            + 'an `overlayClassName` is fine; building the backdrop yourself is not — that is '
            + 'how a dialog ends up with no role, no focus trap and no Escape.',
    },
    {
        name: 'raw-table',
        pattern: /<table\b/g,
        remedy: 'Use `DataTable` for a display table. An editable matrix or a per-row '
            + 'interactive grid may keep a native table — the roadmap approves that pattern '
            + 'by path — but it must still use the `--ds-table-*` roles.',
    },
];

/**
 * Styled controls are counted separately, because the regex has to look at the
 * element *and* its class list to tell a semantic `<button>` (fine) from a
 * hand-built one wearing padding and a background (not fine).
 */
const STYLED_CONTROL_RULES = [
    {
        name: 'hand-styled-button',
        element: 'button',
        remedy: 'Use `Button` or `IconButton`. A `<button>` with no styling of its own is fine '
            + '— a tab, a disclosure trigger, a cell affordance. One carrying its own padding, '
            + 'background or border is a second button contract.',
    },
    {
        name: 'hand-styled-field',
        element: 'input|select|textarea',
        remedy: 'Use `Input`, `Select`, `Textarea` or `FileInput`, wrapped in `FormField`. '
            + 'A hand-styled control will not match the shared control height, so it will not '
            + 'line up with the button beside it.',
    },
    {
        name: 'hand-styled-anchor',
        element: 'a',
        remedy: 'Use `Link`, `ButtonLink` or `IconButtonLink`. Pass `external` rather than '
            + 'writing `target="_blank"` — that is how the new tab gets announced.',
    },
];

/** A class list that decides geometry or colour, rather than just layout. */
const STYLING_SIGNAL = /\b(?:p|px|py|pt|pb|pl|pr)-\d|\bbg-|\bborder(?:-|\b)|\brounded|\btext-(?:xs|sm|base|lg|xl)|\bh-\d|\bmin-h-/;

function countStyledControls(code, rule) {
    const tag = new RegExp(`<(${rule.element})\\b([^>]*)>`, 'gs');
    let count = 0;
    for (const match of code.matchAll(tag)) {
        const attributes = match[2];
        if (!/className\s*=/.test(attributes)) continue;
        if (!STYLING_SIGNAL.test(attributes)) continue;
        count += 1;
    }
    return count;
}

export function countViolations(source) {
    const code = stripComments(source);
    const counts = {};
    for (const rule of RULES) {
        const subject = rule.prepare ? rule.prepare(code) : code;
        const found = subject.match(rule.pattern);
        if (found?.length) counts[rule.name] = found.length;
    }
    for (const rule of STYLED_CONTROL_RULES) {
        const found = countStyledControls(code, rule);
        if (found) counts[rule.name] = found;
    }
    return counts;
}

const REMEDIES = Object.fromEntries(
    [...RULES, ...STYLED_CONTROL_RULES].map((rule) => [rule.name, rule.remedy]),
);

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

function scan() {
    const measured = {};
    for (const file of sourceFiles(srcRoot())) {
        const relative = path.relative(srcRoot(), file).split(path.sep).join('/');
        const counts = countViolations(readFileSync(file, 'utf8'));
        if (Object.keys(counts).length > 0) measured[relative] = counts;
    }
    return measured;
}

function loadBaseline() {
    try {
        return JSON.parse(readFileSync(baselinePath(), 'utf8'));
    } catch {
        return { files: {} };
    }
}

function main() {
    const update = process.argv.includes('--update');
    const baseline = loadBaseline();
    const measured = scan();

    // A guard that cannot fail on a broken input is not a guard. If the walker
    // finds nothing at all, something is wrong with the walker.
    const scanned = sourceFiles(srcRoot()).length;
    if (scanned < 200) {
        console.error(`\nThe UI contract scan reached only ${scanned} files. That is a broken check, not a clean result.\n`);
        process.exit(1);
    }

    if (update) {
        const files = {};
        for (const [file, counts] of Object.entries(measured).sort()) {
            const previous = baseline.files?.[file] ?? {};
            files[file] = { ...counts };
            // Annotations survive a regeneration; only the numbers are recomputed.
            // A `reasons` entry for a rule the file no longer breaks is dropped
            // with it, so a retired exception cannot linger as cover for a
            // future one.
            if (previous.reasons) {
                const live = Object.fromEntries(
                    Object.entries(previous.reasons).filter(([rule]) => rule in counts),
                );
                if (Object.keys(live).length > 0) files[file].reasons = live;
            }
            /*
             * `debt` means "a migration slice still owes work here". Once every
             * rule the file breaks has a documented reason, it owes nothing, and
             * leaving the tag would make the "no debt left" check at the end of
             * the campaign meaningless.
             */
            const stillOwed = Object.keys(counts)
                .some((rule) => !(files[file].reasons?.[rule]));
            if (previous.debt && stillOwed) files[file].debt = previous.debt;
        }
        writeFileSync(baselinePath(), `${JSON.stringify({
            $comment: baseline.$comment,
            files,
        }, null, 2)}\n`);
        const total = Object.values(measured).reduce(
            (sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0,
        );
        console.log(`Inventory updated: ${Object.keys(files).length} files, ${total} tolerated violations.`);
        return;
    }

    const problems = [];
    let toleratedTotal = 0;

    for (const [file, counts] of Object.entries(measured)) {
        const allowed = baseline.files?.[file] ?? {};
        for (const [rule, count] of Object.entries(counts)) {
            const permitted = typeof allowed[rule] === 'number' ? allowed[rule] : 0;
            toleratedTotal += Math.min(count, permitted);
            if (count > permitted) {
                problems.push({
                    kind: 'new',
                    file,
                    rule,
                    detail: permitted === 0
                        ? `${count} new`
                        : `${count}, inventory allows ${permitted}`,
                });
            }
        }
    }

    // Shrinkage: the inventory describes a tree that no longer exists.
    const stale = [];
    for (const [file, allowed] of Object.entries(baseline.files ?? {})) {
        const counts = measured[file] ?? {};
        for (const [rule, permitted] of Object.entries(allowed)) {
            if (rule === 'reasons' || rule === 'debt') continue;
            const count = counts[rule] ?? 0;
            if (count < permitted) stale.push(`${file} → ${rule}: ${permitted} → ${count}`);
        }
    }

    if (problems.length > 0) {
        console.error('\nUI contract violations that the inventory does not cover:\n');
        const byRule = new Map();
        for (const problem of problems) {
            if (!byRule.has(problem.rule)) byRule.set(problem.rule, []);
            byRule.get(problem.rule).push(problem);
        }
        for (const [rule, entries] of byRule) {
            console.error(`  ${rule}`);
            console.error(`    ${REMEDIES[rule]}`);
            for (const entry of entries) console.error(`      ${entry.file}  (${entry.detail})`);
            console.error('');
        }
        console.error('If one of these is a genuine, documented exception, add it to');
        console.error('src/design-system/ui-contract.baseline.json under `reasons`, keyed by rule,');
        console.error('naming the roadmap entry that justifies it. Do not add one without that —');
        console.error('an unexplained entry is how the inventory stops meaning anything.\n');
        process.exit(1);
    }

    if (stale.length > 0) {
        console.error('\nThe UI contract inventory is out of date — these have been fixed:\n');
        for (const line of stale) console.error(`  ${line}`);
        console.error('\nRun `npm run check:ui-contract -- --update` and commit the result, so the');
        console.error('inventory records the shrinkage rather than quietly permitting a regression');
        console.error('back up to the old number.\n');
        process.exit(1);
    }

    console.log(
        `UI contract intact: ${scanned} files scanned, ${toleratedTotal} known violations `
        + `across ${Object.keys(measured).length} files, none new.`,
    );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
