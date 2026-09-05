#!/usr/bin/env node
/**
 * check:icon-contract — no file outside `src/design-system/icons/` may name
 * `lucide-react`, and the list of the ones that still do only shrinks.
 *
 * ## Why this is a campaign file and not an allowlist rule
 *
 * `check:ui-contract` records an exception as a hand-written reason of at least
 * twenty characters naming the roadmap row it rests on. That is right for a
 * decision — a hex baked into a sealed PDF, a watermark that has to sit behind
 * its text. It is wrong for 178 identical entries whose reason is "not migrated
 * yet": 178 boilerplate reasons is the `debt` escape hatch this repository
 * already deleted once, renamed.
 *
 * So this borrows `source-size`'s shape instead, including the part that matters
 * most: **the direction is measured against git, not against the branch.** A
 * pull request that adds a 12-glyph file together with `{"src/new.jsx": 12}`
 * would otherwise pass its own check. `checkBacklogDirection` reads the previous
 * version out of the newest validated ancestor and refuses any entry added or
 * any count raised — a gate must not take its scope from the branch it is
 * gating.
 *
 * `SOURCE_SIZE_BASE` is shared with `source-size` deliberately: both guards ask
 * the same question of the same history, and a second environment variable would
 * be a second thing to get wrong in the same dispatch dialog.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBacklogDirection } from './source-size-baseline.mjs';
import { resolveValidatedBaseline } from './source-size-validated.mjs';
import {
    BACKLOG_PATH, CONTRACT_ROOT, countLucideImports, hasUncountableImport, isGoverned,
} from './icon-contract/scope.mjs';
import { evaluate } from './icon-contract/evaluate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `git ls-files -z`, kept NUL-delimited.
 *
 * Not a directory walk: a file cannot escape the scan by being moved, and
 * gitignored build output is structurally unreachable rather than excluded by a
 * pattern somebody could widen. The NUL matters — a tracked path may contain a
 * newline, and splitting on newlines turns one such path into two, hiding the
 * real file behind a fragment.
 */
function trackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
}

function measure() {
    const files = [];
    for (const path of trackedFiles()) {
        if (!isGoverned(path)) continue;
        const full = resolve(repoRoot, path);
        if (!existsSync(full)) continue;
        const source = readFileSync(full, 'utf8');
        files.push({
            path,
            imports: countLucideImports(source),
            uncountable: hasUncountableImport(source),
        });
    }
    return files;
}

async function main() {
    const args = process.argv.slice(2);
    const requireBaseline = args.includes('--require-baseline');

    const files = measure();
    const backlogFile = resolve(repoRoot, BACKLOG_PATH);
    const backlog = existsSync(backlogFile)
        ? JSON.parse(readFileSync(backlogFile, 'utf8')).files || {}
        : {};

    const verdict = evaluate(files, backlog);

    const headSha = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const {
        lastValidatedBase, overrideValidated, automaticLookupComplete, error: lookupError,
    } = await resolveValidatedBaseline({ headSha, cwd: repoRoot, log: console.log });

    const direction = checkBacklogDirection({
        current: backlog,
        measured: files.map((file) => ({ path: file.path, lines: file.imports })),
        countLines: countLucideImports,
        path: BACKLOG_PATH,
        requireBaseline,
        unit: 'glyph import(s)',
        lastValidatedBase,
        overrideValidated,
        automaticLookupComplete,
    });

    const importing = files.filter((file) => file.imports > 0);
    const remaining = importing.reduce((total, file) => total + file.imports, 0);

    console.log(`Scanned ${files.length} source file(s) outside ${CONTRACT_ROOT}.`);
    console.log(`${importing.length} still import lucide-react directly `
        + `(${remaining} glyph import(s)); ${Object.keys(backlog).length} recorded.`);
    console.log(`backlog    : ${direction.describe}`);

    const problems = [...verdict.problems, ...direction.problems];
    if (problems.length > 0 && lookupError) {
        problems.push(`the baseline lookup could not complete: ${lookupError}. That is why nothing `
            + 'came back validated — it is not evidence that nothing is.');
    }
    if (problems.length > 0) {
        console.error(`\nicon-contract REFUSED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }

    if (Object.keys(backlog).length === 0 && existsSync(backlogFile)) {
        console.error(`\nicon-contract REFUSED:\n  - ${BACKLOG_PATH} is empty. The campaign is `
            + 'finished, so delete the file — an empty list is an invitation to add to it.');
        process.exit(1);
    }

    console.log('\nicon-contract OK.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`icon-contract REFUSED\n\n${error?.stack || error}`);
        process.exit(1);
    });
}
