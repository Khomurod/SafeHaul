/**
 * What the guard says when it refuses, and what it says when it passes.
 *
 * Separated from the checks themselves so the wording is reviewable on its own
 * and so `main()` reads as a sequence of decisions rather than a wall of
 * `console.error`. Every one of these messages ends by naming the action that
 * clears it — a refusal that does not tell you what to do next gets worked
 * around rather than fixed.
 *
 * Extracted from `check-ui-contract.mjs` on 2026-09-04, wording unchanged.
 */

import { REMEDIES } from './counting.mjs';

/** Violations no allowlist entry covers, grouped by rule with the remedy. */
export function reportProblems(problems) {
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
}

export function reportUnexplained(unexplained) {
    console.error('\nThese allowlist entries do not say why they are allowed:\n');
    for (const entry of unexplained) console.error(`  ${entry}`);
    console.error('\nEvery entry needs a `reasons` entry for its rule, naming the roadmap');
    console.error('item that justifies it. The `debt` escape hatch was removed once the');
    console.error('migration finished — an exception is now a decision, not a promise.\n');
}

export function reportUntethered(untethered) {
    console.error('\nThese approved native tables do not apply the native-table contract:\n');
    for (const file of untethered) console.error(`  ${file}`);
    console.error('\nAdd `ds-native-table` to every `<table>` in the file. A native table is');
    console.error('approved for an editable matrix or per-row interactive rows — it is not a');
    console.error('licence to style a table by hand, and the class is what makes the header,');
    console.error('divider, density and cell padding come from the same `--ds-table-*` roles');
    console.error('`DataTable` reads. There is no exemption for a hidden table: deciding');
    console.error('whether a class list is hidden at every breakpoint is not decidable, so');
    console.error('the invisible one carries the class too. It costs nothing.\n');
}

export function reportStale(stale) {
    console.error('\nThe UI contract allowlist is out of date — these have been fixed:\n');
    for (const line of stale) console.error(`  ${line}`);
    console.error('\nRun `npm run check:ui-contract -- --update` and commit the result, so the');
    console.error('inventory records the shrinkage rather than quietly permitting a regression');
    console.error('back up to the old number.\n');
}

/** The broken-walker floor. Not a clean result — a broken check. */
export function reportBrokenScan(scanned) {
    console.error(`\nThe UI contract scan reached only ${scanned} files. That is a broken check, not a clean result.\n`);
}

export function reportIntact(scanned, toleratedTotal, fileCount) {
    console.log(
        `UI contract intact: ${scanned} files scanned, ${toleratedTotal} known violations `
        + `across ${fileCount} files, none new.`,
    );
}

export function reportUpdated(fileCount, total) {
    console.log(`Inventory updated: ${fileCount} files, ${total} tolerated violations.`);
}
