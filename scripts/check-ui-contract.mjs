#!/usr/bin/env node
/**
 * Repository guard: new UI code cannot casually reintroduce the inconsistencies
 * this design system exists to remove.
 *
 * Run:    `npm run check:ui-contract`
 * Update: `npm run check:ui-contract -- --update`   (after a migration shrinks it)
 * Verify: `npm run test:ui-contract`                (the guard's own tests)
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
 *
 * ## This file is the CLI; the decisions live beside it
 *
 * Split on 2026-09-04. `./ui-contract/` holds the parts that can be tested
 * without a filesystem — `verdict.mjs` (what the tree and the allowlist say
 * about each other), `tether.mjs` (the native-table AST check), `update.mjs`
 * (regeneration) and `report.mjs` (the wording) — so the guard's own failure
 * modes are drivable on fixtures. **Nothing under `src/` may import this
 * module**: `src/tests/uiContract.ratchet.test.js` imports the library modules
 * directly, because Vitest rewrites `import.meta.url` and anything evaluated at
 * this file's module scope would run inside that rewrite. `test-ui-contract.mjs`
 * pins that rule.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, sourceFiles, srcRoot } from './ui-contract/paths.mjs';
import { loadAllowlist, scan } from './ui-contract/scan.mjs';
import { evaluate } from './ui-contract/verdict.mjs';
import { untetheredTables } from './ui-contract/tether.mjs';
import { regenerate, serialise } from './ui-contract/update.mjs';
import {
    reportBrokenScan, reportIntact, reportProblems, reportStale,
    reportUnexplained, reportUntethered, reportUpdated,
} from './ui-contract/report.mjs';

/**
 * The walker must reach the tree it claims to guard.
 *
 * A guard that cannot fail on a broken input is not a guard. If the walker
 * finds nothing at all, something is wrong with the walker.
 * Raised from 200 when stylesheets joined the walk on 2026-08-25.
 */
export const MINIMUM_SCANNED_FILES = 400;

function main() {
    const update = process.argv.includes('--update');
    const allowlist = loadAllowlist();
    const measured = scan();

    const scanned = sourceFiles(srcRoot()).length;
    if (scanned < MINIMUM_SCANNED_FILES) {
        reportBrokenScan(scanned);
        process.exit(1);
    }

    if (update) {
        const { files, total } = regenerate(measured, allowlist);
        writeFileSync(allowlistPath(), serialise(allowlist, files));
        reportUpdated(Object.keys(files).length, total);
        return;
    }

    const { problems, toleratedTotal, unexplained, stale } = evaluate(measured, allowlist);
    const untethered = untetheredTables(
        allowlist,
        (file) => readFileSync(path.join(srcRoot(), file), 'utf8'),
    );

    if (problems.length > 0) {
        reportProblems(problems);
        process.exit(1);
    }

    if (unexplained.length > 0) {
        reportUnexplained(unexplained);
        process.exit(1);
    }

    if (untethered.length > 0) {
        reportUntethered(untethered);
        process.exit(1);
    }

    if (stale.length > 0) {
        reportStale(stale);
        process.exit(1);
    }

    reportIntact(scanned, toleratedTotal, Object.keys(measured).length);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main();
}
