/**
 * Walking the tree, and reading the allowlist it is checked against.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { allowlistPath, sourceFiles, srcRoot } from './paths.mjs';
import { rulesFor } from './source-text.mjs';
import { countViolations } from './counting.mjs';

export function scan() {
    const measured = {};
    for (const file of sourceFiles(srcRoot())) {
        const relative = path.relative(srcRoot(), file).split(path.sep).join('/');
        const only = rulesFor(relative);
        if (Array.isArray(only) && only.length === 0) continue;
        const counts = countViolations(readFileSync(file, 'utf8'), only);
        if (Object.keys(counts).length > 0) measured[relative] = counts;
    }
    return measured;
}

export function loadAllowlist() {
    try {
        return JSON.parse(readFileSync(allowlistPath(), 'utf8'));
    } catch {
        return { files: {} };
    }
}
