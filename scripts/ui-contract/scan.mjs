/**
 * Walking the tree, and reading the allowlist it is checked against.
 *
 * Keys are **repo-relative** as of allowlist version 2 (`./allowlist.mjs`),
 * because the scan now reaches `index.html` at the repository root and there is
 * no honest `src/`-relative name for it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, repoRoot, scanTargets, sourceFiles } from './paths.mjs';
import { rulesFor } from './source-text.mjs';
import { countViolations } from './counting.mjs';
import { normaliseAllowlist } from './allowlist.mjs';

export function scan() {
    const measured = {};
    const root = repoRoot();
    for (const target of scanTargets()) {
        for (const file of sourceFiles(target)) {
            const relative = path.relative(root, file).split(path.sep).join('/');
            const only = rulesFor(relative);
            if (Array.isArray(only) && only.length === 0) continue;
            const counts = countViolations(readFileSync(file, 'utf8'), only,
                { html: relative.endsWith('.html') });
            if (Object.keys(counts).length > 0) measured[relative] = counts;
        }
    }
    return measured;
}

/**
 * The allowlist as the checker should read it: repo-relative, whatever version
 * is on disk. The returned document keeps its other fields so `--update` can
 * write them back.
 */
export function loadAllowlist() {
    try {
        const document = JSON.parse(readFileSync(allowlistPath(), 'utf8'));
        return { ...document, files: normaliseAllowlist(document) };
    } catch {
        return { files: {} };
    }
}
