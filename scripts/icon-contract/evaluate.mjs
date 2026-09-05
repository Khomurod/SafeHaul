/**
 * The four rules, and the shape check that has to pass before any of them run.
 *
 * Deliberately pure: it takes measurements and a backlog and returns problems, so
 * `test-icon-contract.mjs` can drive every branch on fixtures instead of on the
 * repository's own 178 entries.
 */

import { BACKLOG_PATH, REQUIRED_ROOTS } from './scope.mjs';

/**
 * A recorded count that is not a number makes every comparison below FALSE
 * rather than failing — `"unbounded" > 3` is false, and so is `3 > "unbounded"`.
 * `source-size` was found doing exactly that with `{"src/big.js": "unbounded"}`,
 * which exempted a 9000-line file from every rule at once, silently. Nothing is
 * compared until the shape is sound.
 */
export function backlogShapeProblems(backlog) {
    const problems = [];
    if (backlog === null || typeof backlog !== 'object' || Array.isArray(backlog)) {
        return [`${BACKLOG_PATH} must hold an object of path -> count under "files".`];
    }
    for (const [path, count] of Object.entries(backlog)) {
        if (!Number.isInteger(count) || count < 0) {
            problems.push(`${BACKLOG_PATH} records ${JSON.stringify(count)} for ${path}. `
                + 'A count must be a non-negative integer — anything else makes every comparison '
                + 'against it false rather than failing, which is an exemption nobody wrote.');
        }
    }
    return problems;
}

/**
 * @param {{path: string, imports: number, uncountable: boolean}[]} files
 * @param {Record<string, number>} backlog
 */
export function evaluate(files, backlog = {}) {
    const problems = backlogShapeProblems(backlog);
    if (problems.length > 0) return { ok: false, problems };

    const measured = new Map(files.map((file) => [file.path, file.imports]));

    for (const file of files) {
        if (file.uncountable) {
            problems.push(`${file.path} imports lucide-react without a name list `
                + '(a namespace or default import). There is nothing to count, so it can neither '
                + 'be recorded nor drained. Import the names, or move to @design-system/icons.');
            continue;
        }
        const recorded = backlog[file.path];
        if (recorded === undefined) {
            if (file.imports > 0) {
                problems.push(`${file.path} imports ${file.imports} glyph(s) from lucide-react and `
                    + `is not in ${BACKLOG_PATH}. Import them from @design-system/icons instead — `
                    + 'a file not on the list may not name the package at all.');
            }
            continue;
        }
        if (file.imports > recorded) {
            problems.push(`${file.path} imports ${file.imports} glyph(s) from lucide-react, up from `
                + `the ${recorded} recorded in ${BACKLOG_PATH}. A file on the list may not grow.`);
        }
        if (file.imports === 0) {
            problems.push(`${file.path} no longer imports lucide-react and does not need a backlog `
                + `entry. Remove it from ${BACKLOG_PATH} — the list only shrinks.`);
        }
    }

    for (const path of Object.keys(backlog)) {
        if (!measured.has(path)) {
            problems.push(`${BACKLOG_PATH} lists ${path}, which is not a scanned source file. `
                + 'A renamed or deleted file does not carry its exemption with it.');
        }
    }

    const missingRoots = REQUIRED_ROOTS.filter(
        (root) => !files.some((file) => file.path === root || file.path.startsWith(`${root}/`)),
    );
    if (missingRoots.length > 0) {
        problems.push(`the scan found no files under ${missingRoots.join(', ')}. A checker that has `
            + 'stopped covering a directory reports the same clean result as one that found nothing '
            + 'wrong there, so it refuses instead.');
    }

    return { ok: problems.length === 0, problems };
}
