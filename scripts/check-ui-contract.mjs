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
 * ## The inventory is judged against git, not taken on trust
 *
 * Added 2026-09-04, after an audit reproduced two ways through the gate from
 * inside a pull request: raise a recorded count and run `--update`, or add a
 * brand-new file with an entry whose reason is a twenty-character sentence
 * naming nothing. Neither is a bug in a rule — both are the *inventory* being
 * writable by the change it is measuring, which is the lesson
 * `scripts/secret-scan.mjs` and `scripts/source-size-baseline.mjs` were each
 * built on: **a gate must not take its scope from the branch it is gating.**
 *
 * So `--update` may now only shrink (`./ui-contract/update.mjs`), and every
 * addition is compared against the base commit's own content
 * (`./ui-contract/baseline.mjs` and `./ui-contract/direction.mjs`). The base is
 * resolved by the size guard's own five-times-corrected resolver, and
 * `SOURCE_SIZE_BASE` is shared rather than duplicated.
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

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, repoRoot, scanTargets, sourceFiles } from './ui-contract/paths.mjs';
import { loadAllowlist, scan } from './ui-contract/scan.mjs';
import { evaluate } from './ui-contract/verdict.mjs';
import { untetheredTables } from './ui-contract/tether.mjs';
import { additions, serialise } from './ui-contract/update.mjs';
import { checkAllowlistDirection } from './ui-contract/baseline.mjs';
import { resolveValidatedBaseline } from './source-size-validated.mjs';
import {
    reportBrokenScan, reportIntact, reportProblems, reportRefusedUpdate, reportStale,
    reportTampered, reportUnexplained, reportUntethered, reportUpdated,
} from './ui-contract/report.mjs';

/**
 * The walker must reach the tree it claims to guard.
 *
 * A guard that cannot fail on a broken input is not a guard. If the walker
 * finds nothing at all, something is wrong with the walker.
 * Raised from 200 when stylesheets joined the walk on 2026-08-25.
 */
export const MINIMUM_SCANNED_FILES = 400;

async function main() {
    const update = process.argv.includes('--update');
    /*
     * CI passes this, and it is what makes the allowlist a record rather than a
     * self-serve exemption: every rule in `verdict.mjs` is enforced against the
     * allowlist IN THE BRANCH UNDER TEST, which that branch may edit.
     * `--require-baseline` refuses unless the previous version can be read out of
     * git and every addition shown to have been there already.
     */
    const requireBaseline = process.argv.includes('--require-baseline');
    const allowlist = loadAllowlist();
    const measured = scan();

    const scanned = scanTargets().flatMap(sourceFiles).length;
    if (scanned < MINIMUM_SCANNED_FILES) {
        reportBrokenScan(scanned);
        process.exit(1);
    }

    if (update) {
        const { files, total, problems, growth } = additions(measured, allowlist);
        if (problems.length > 0 || growth.length > 0) {
            reportRefusedUpdate(problems, growth);
            process.exit(1);
        }
        writeFileSync(allowlistPath(), serialise(allowlist, files));
        reportUpdated(Object.keys(files).length, total);
        // Fall through rather than return: a regeneration that leaves the tree
        // failing — an entry with no reason, an addition the base did not carry —
        // should say so now, not on the next run.
        allowlist.files = files;
    }

    const cwd = repoRoot();
    /*
     * A checkout with no git at all (a tarball, a vendored copy) must still be
     * able to run the checker: an empty head resolves to no baseline, which is a
     * skip locally and a refusal under `--require-baseline`. Crashing here would
     * make the local command unusable, and an unusable command gets removed.
     */
    let headSha = '';
    try {
        headSha = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], { cwd, encoding: 'utf8' }).trim();
    } catch { /* no git, or no commits yet */ }
    const {
        lastValidatedBase, overrideValidated, automaticLookupComplete, error: lookupError,
    } = await resolveValidatedBaseline({ headSha, cwd, log: console.log });

    const direction = checkAllowlistDirection({
        current: allowlist.files || {},
        requireBaseline,
        cwd,
        lastValidatedBase,
        overrideValidated,
        automaticLookupComplete,
    });
    console.log(`allowlist  : ${direction.describe}`);

    const tampered = [...direction.problems];
    if (tampered.length > 0 && lookupError) {
        // "Nothing came back validated" and "the lookup could not run" fail the
        // same way and need very different fixes, so the refusal says which.
        tampered.push(`the baseline lookup could not complete: ${lookupError}. That is why nothing `
            + 'came back validated — it is not evidence that nothing is.');
    }
    if (tampered.length > 0) {
        // Reported before the content verdicts on purpose: if the inventory
        // itself cannot be trusted, "none new" is a statement about nothing.
        reportTampered(tampered);
        process.exit(1);
    }

    const { problems, toleratedTotal, unexplained, stale } = evaluate(measured, allowlist);
    const untethered = untetheredTables(
        allowlist,
        // Repo-relative since allowlist v2; it was `srcRoot()` while every key
        // was `src/`-relative.
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

    if (stale.length > 0) {
        reportStale(stale);
        process.exit(1);
    }

    reportIntact(scanned, toleratedTotal, Object.keys(measured).length);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(`ui-contract REFUSED\n\n${error?.stack || error}`);
        process.exit(1);
    });
}
