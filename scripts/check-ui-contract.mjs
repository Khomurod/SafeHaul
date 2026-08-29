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
 * ## Zero tolerance, with a written allowlist
 *
 * Every violation this finds must appear in
 * `src/design-system/ui-contract.allowlist.json` **with a reason** naming the
 * roadmap entry that justifies it. There is no other way to pass:
 *
 *   - a violation in a file that is not in the allowlist   -> fail
 *   - more violations in a file than the allowlist records -> fail
 *   - fewer                                                -> fail, "run --update"
 *   - an allowlist entry with no reason                    -> fail
 *
 * It began (2026-08-21) as a shrink-only ratchet over an inventory of 660
 * tolerated violations, most tagged with the migration slice that owed the
 * work. The last of that debt cleared on 2026-08-25, so the `debt` escape hatch
 * is gone: an entry without a reason is now an error rather than a promise.
 *
 * Failing on a *decrease* is deliberate too. It keeps the allowlist honest, so
 * it can never quietly describe a tree that no longer exists, and it makes
 * every fix visible in its own diff. `--update` rewrites the file, preserving
 * reasons and dropping the ones whose rule no longer fires.
 *
 * ## What it deliberately does not flag
 *
 * Semantic HTML. A `<button>` is not a violation; a `<button>` wearing
 * hand-written padding and a background colour is. A `<table>` is not a
 * violation; the roadmap approves the native-table pattern for editable
 * matrices, and those are listed by path. A brittle check that fires on correct
 * markup gets switched off, which is worse than no check.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, sourceFiles, srcRoot } from './ui-contract/paths.mjs';
import { REMEDIES } from './ui-contract/counting.mjs';
import { loadAllowlist, scan } from './ui-contract/scan.mjs';
import { tablesOffContract } from './ui-contract/tables.mjs';

/*
 * Re-exported because `src/tests/uiContract.ratchet.test.js` imports them from
 * THIS path to prove the guard can fail. Moving them into `ui-contract/` without
 * re-exporting here would break that test — and a guard whose own failure test is
 * broken is a guard nobody is checking.
 */
export { countViolations } from './ui-contract/counting.mjs';
export { rulesFor, stripBlockComments, stripComments } from './ui-contract/source-text.mjs';

function main() {
    const update = process.argv.includes('--update');
    const allowlist = loadAllowlist();
    const measured = scan();

    // A guard that cannot fail on a broken input is not a guard. If the walker
    // finds nothing at all, something is wrong with the walker.
    // Raised from 200 when stylesheets joined the walk on 2026-08-25.
    const scanned = sourceFiles(srcRoot()).length;
    if (scanned < 400) {
        console.error(`\nThe UI contract scan reached only ${scanned} files. That is a broken check, not a clean result.\n`);
        process.exit(1);
    }

    if (update) {
        const files = {};
        for (const [file, counts] of Object.entries(measured).sort()) {
            const previous = allowlist.files?.[file] ?? {};
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
             * `debt` used to be the other way to pass — "a migration slice still
             * owes work here". It is deliberately not carried forward: since
             * 2026-08-25 every entry needs a reason, and `--update` inventing one
             * would defeat the point. An entry whose rule has no reason fails the
             * check below instead, which is where the author has to write it.
             */
        }
        writeFileSync(allowlistPath(), `${JSON.stringify({
            $comment: allowlist.$comment,
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
        const allowed = allowlist.files?.[file] ?? {};
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

    /*
     * An approved native table must apply the native-table contract.
     *
     * The roadmap has always said both halves of this: a native `<table>` is
     * approved for an editable matrix or per-row interactive rows, AND "a native
     * table is not a licence to style a table by hand". Only the first half was
     * checked. Measured on 2026-08-25: seven of the eleven approved native tables
     * referenced no `--ds-table-*` role at all, and their inline cell padding had
     * drifted to three different values (24px, 20px, 16px) against a contract of
     * 20px. They looked right because `bg-ds-surface-subtle` happens to be what
     * the header role resolves to — a coincidence a re-tuned role would break in
     * silence.
     *
     * `ds-native-table` is that contract, so requiring the class is how the
     * second half of the permission becomes enforceable.
     *
     * ## Per table, not per file
     *
     * The first version of this asked whether the *file* mentioned
     * `ds-native-table` anywhere, which a file with three tables satisfies by
     * putting the class on one of them. `AnalyticsView.jsx` is exactly that
     * shape — three approved `<table>` elements — so the weaker check was one
     * edit away from passing a hand-styled table again, which is the finding
     * this rule was written for. It counts tables now.
     *
     * ## No carve-out for a hidden table, since round eight
     *
     * There used to be one: `AnalyticsView`'s `sr-only` chart-equivalent table was
     * exempt, on the reasoning that something invisible has no appearance to put
     * on contract. The reasoning was fine and the *inference* was not — deciding
     * "is this hidden?" from a class list means deciding it across Tailwind's
     * whole variant space, and `className="sr-only xl:not-sr-only"` is hidden on a
     * phone and visible on a desktop. That pattern is already in this repository
     * (`DossierHeader.jsx`), so it was not hypothetical.
     *
     * Rather than guard an open-ended axis, the axis is gone: **every** approved
     * `<table>` must carry the class, the hidden one included. Measured in a real
     * browser with the built stylesheet before doing it — `sr-only` keeps
     * `position:absolute` and `clip:rect(0,0,0,0)`, so the element stays invisible
     * whatever the contract does to its box (10x20 -> 47x39, `visible: false`
     * both ways). An invisible table carrying a visual contract costs nothing;
     * inferring invisibility from classes cost four rounds of review.
     *
     * ## And it parses, rather than matching text
     *
     * This rule went through four review rounds, each closing a bypass the
     * previous fix left: a `[^>]*` tag match truncating at the `>` in `=>`, an
     * `includes()` class match accepting `ds-native-table-broken`, a whole-slice
     * search accepting a `data-testid` that named the contract, and finally
     * `className={enabled ? 'ds-native-table' : 'other'}` — where the token IS in
     * the text and the rendered table is off-contract half the time.
     *
     * That last one is why it now asks `@babel/parser`. No amount of careful
     * string matching answers it, because the question is not "does this text
     * appear" but "is this true on every branch", which is a question about
     * structure. See `tablesOffContract`.
     */
    const untethered = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        if (typeof allowed['raw-table'] !== 'number') continue;
        // `DataTable` IS the display-table contract; it does not consume the
        // native one.
        if (file.startsWith('design-system/')) continue;
        const source = readFileSync(path.join(srcRoot(), file), 'utf8');
        let result;
        try {
            result = tablesOffContract(source, 'ds-native-table');
        } catch (error) {
            // A parse failure is a failure. Falling back to a text match here is
            // how the four bypasses this rule now parses for would come back.
            untethered.push(`${file} (could not be parsed: ${error.message})`);
            continue;
        }
        if (result.offContract.length > 0) {
            untethered.push(
                `${file} (${result.offContract.length} of ${result.total}, `
                + `line${result.offContract.length > 1 ? 's' : ''} ${result.offContract.join(', ')})`,
            );
        }
    }

    /*
     * Every allowlist entry must say why it is there.
     *
     * This is what makes the file an allowlist rather than a pile of tolerated
     * numbers. Without it, "add it to the allowlist" is a way to make any
     * failure go away, and the next reader has no way to tell a deliberate
     * exception from something someone was in a hurry about.
     */
    const unexplained = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        for (const rule of Object.keys(allowed)) {
            if (rule === 'reasons') continue;
            const reason = allowed.reasons?.[rule];
            if (typeof reason !== 'string' || reason.trim().length < 20) {
                unexplained.push(`${file} → ${rule}`);
            }
        }
    }

    // Shrinkage: the allowlist describes a tree that no longer exists.
    const stale = [];
    for (const [file, allowed] of Object.entries(allowlist.files ?? {})) {
        const counts = measured[file] ?? {};
        for (const [rule, permitted] of Object.entries(allowed)) {
            if (rule === 'reasons') continue;
            const count = counts[rule] ?? 0;
            if (count < permitted) stale.push(`${file} → ${rule}: ${permitted} → ${count}`);
        }
    }

    if (problems.length > 0) {
        console.error('\nUI contract violations that the allowlist does not cover:\n');
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
        console.error('src/design-system/ui-contract.allowlist.json under `reasons`, keyed by rule,');
        console.error('naming the roadmap entry that justifies it. Do not add one without that —');
        console.error('an unexplained entry is how the inventory stops meaning anything.\n');
        process.exit(1);
    }

    if (unexplained.length > 0 && !update) {
        console.error('\nThese allowlist entries do not say why they are allowed:\n');
        for (const entry of unexplained) console.error(`  ${entry}`);
        console.error('\nEvery entry needs a `reasons` entry for its rule, naming the roadmap');
        console.error('item that justifies it. The `debt` escape hatch was removed once the');
        console.error('migration finished — an exception is now a decision, not a promise.\n');
        process.exit(1);
    }

    if (untethered.length > 0) {
        console.error('\nThese approved native tables do not apply the native-table contract:\n');
        for (const file of untethered) console.error(`  ${file}`);
        console.error('\nAdd `ds-native-table` to every `<table>` in the file. A native table is');
        console.error('approved for an editable matrix or per-row interactive rows — it is not a');
        console.error('licence to style a table by hand, and the class is what makes the header,');
        console.error('divider, density and cell padding come from the same `--ds-table-*` roles');
        console.error('`DataTable` reads. There is no exemption for a hidden table: deciding');
        console.error('whether a class list is hidden at every breakpoint is not decidable, so');
        console.error('the invisible one carries the class too. It costs nothing.\n');
        process.exit(1);
    }

    if (stale.length > 0) {
        console.error('\nThe UI contract allowlist is out of date — these have been fixed:\n');
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
