#!/usr/bin/env node
/**
 * Repository guard: new UI code cannot casually reintroduce the inconsistencies
 * this design system exists to remove.
 *
 * Run:    `npm run check:ui-contract`   (also lowers a fixed entry, outside CI)
 * Verify: `npm run test:ui-contract`    (the guard's own tests)
 *
 * ## Why this exists
 *
 * A design system that nothing checks leaves the application visibly
 * inconsistent: raw Tailwind palette classes, raw type classes competing with
 * the `--ds-*` scale, and text below the roadmap's 12px floor all pass review,
 * lint, the unit tests and CI.
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
 *   - fewer                     -> the entry is lowered (in CI, a warning)
 *   - an allowlist entry with no reason                    -> fail
 *
 * There is no `debt` escape hatch: an entry without a reason is an error, not a
 * promise.
 *
 * A *decrease* costs nothing. Run locally, the check lowers the entry to what the
 * tree still holds and drops it, reason and all, at zero; the change commits the
 * file. CI cannot write, so there it warns, and the next local run lowers it.
 *
 * ## What it deliberately does not flag
 *
 * Semantic HTML. A `<button>` is not a violation; a `<button>` wearing
 * hand-written padding and a background colour is. A `<table>` is not a
 * violation; the roadmap approves the native-table pattern for editable
 * matrices, and those are listed by path. A brittle check that fires on correct
 * markup gets switched off, which is worse than no check.
 *
 * ## Growth is written by hand, where review sees it
 *
 * The check never adds an entry or raises a count: an exception that grows is
 * an edit to the allowlist, with a reason, in the pull request's diff. It does
 * not compare the allowlist with a base commit (an owner ruling), so that diff
 * is where such an edit is judged.
 *
 * ## This file is the CLI; the decisions live beside it
 *
 * `./ui-contract/` holds the parts that can be tested without a filesystem —
 * `verdict.mjs` (what the tree and the allowlist say about each other),
 * `tether.mjs` (the native-table AST check), `update.mjs` (lowering a fixed
 * entry) and `report.mjs` (the wording) — so the guard's own failure modes are
 * drivable on fixtures. **Nothing under `src/` may import this
 * module**: `src/tests/uiContract.ratchet.test.js` imports the library modules
 * directly, because Vitest rewrites `import.meta.url` and anything evaluated at
 * this file's module scope would run inside that rewrite. `test-ui-contract.mjs`
 * pins that rule.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, repoRoot, scanTargets, sourceFiles } from './ui-contract/paths.mjs';
import { loadAllowlist, scan } from './ui-contract/scan.mjs';
import { allowlistShapeProblems } from './ui-contract/allowlist.mjs';
import { evaluate } from './ui-contract/verdict.mjs';
import { untetheredTables } from './ui-contract/tether.mjs';
import { settleShrinkage } from './ui-contract/update.mjs';
import {
    reportBrokenScan, reportIntact, reportMalformed, reportProblems, reportShrinkable, reportShrunk,
    reportUnexplained, reportUntethered,
} from './ui-contract/report.mjs';

/**
 * The walker must reach the tree it claims to guard.
 *
 * A guard that cannot fail on a broken input is not a guard. If the walker
 * finds nothing at all, something is wrong with the walker.
 * Stylesheets are part of the walk, so they count toward this floor.
 */
export const MINIMUM_SCANNED_FILES = 400;

async function main() {
    const allowlist = loadAllowlist();
    const measured = scan();

    const scanned = scanTargets().flatMap(sourceFiles).length;
    if (scanned < MINIMUM_SCANNED_FILES) {
        reportBrokenScan(scanned);
        process.exit(1);
    }

    // Reported first: every verdict below compares counts, and a malformed one
    // compares false either way.
    const malformed = allowlistShapeProblems(allowlist.files);
    if (malformed.length > 0) {
        reportMalformed(malformed);
        process.exit(1);
    }

    const { problems, toleratedTotal, unexplained, stale } = evaluate(measured, allowlist);
    const untethered = untetheredTables(
        allowlist,
        (file) => readFileSync(path.join(repoRoot(), file), 'utf8'),
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

    const shrinkage = settleShrinkage({
        measured, allowlist, stale, write: (text) => writeFileSync(allowlistPath(), text),
    });
    if (shrinkage === 'written') reportShrunk(stale);
    if (shrinkage === 'warned') reportShrinkable(stale);

    reportIntact(scanned, toleratedTotal, Object.keys(measured).length);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(`ui-contract REFUSED\n\n${error?.stack || error}`);
        process.exit(1);
    });
}
