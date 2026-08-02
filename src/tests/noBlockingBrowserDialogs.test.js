/**
 * Permanent ratchet: no reachable production `window.confirm` / `confirm()` /
 * `window.alert` / `alert()`.
 *
 * Added 2026-07-28 when the last of them was replaced. Blocking browser dialogs
 * came back three separate times during the design-system migration, each time
 * because a *bare* `confirm(...)` slipped past a scan that only looked for
 * `window.confirm`. This test looks for both forms so that cannot happen again.
 *
 * A blocking dialog freezes the tab, cannot be styled, cannot be announced
 * consistently, is unreliable on mobile browsers, and on a DOT-compliance surface
 * it can be dismissed by a stray keypress without the operator reading it. Every
 * confirmation in the app now goes through `shared/components/modals/ConfirmDialog`.
 *
 * If this fails: use `ConfirmDialog` for confirmations, and a toast or an inline
 * `FieldMessage` for notifications. Do not add an exemption without a recorded
 * decision in `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tests legitimately stub and assert on these globals. */
const isTestFile = (file) => /\.(test|spec)\.[jt]sx?$/.test(file);

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        if (!/\.[jt]sx?$/.test(entry.name)) return [];
        if (isTestFile(entry.name)) return [];
        return [target];
    });
}

/**
 * Strips block comments, line comments and string/template literals, so a
 * *mention* of `alert()` in prose (there are many, documenting the replacements)
 * is not mistaken for a call.
 */
function stripCommentsAndStrings(source) {
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
                state = 'string'; quote = source[i]; i += 1; continue;
            }
            out += source[i];
            i += 1;
            continue;
        }

        if (state === 'block') {
            if (two === '*/') { state = 'code'; i += 2; continue; }
            i += 1;
            continue;
        }

        if (state === 'line') {
            if (source[i] === '\n') { state = 'code'; out += '\n'; }
            i += 1;
            continue;
        }

        // state === 'string'
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { state = 'code'; i += 1; continue; }
        i += 1;
    }

    return out;
}

/**
 * Matches `confirm(` / `alert(` as a call, with or without a `window.` prefix, but
 * not as a property of something else (`toast.alert(`) and not as part of a longer
 * identifier (`confirmDelete(`, `alertStats(`).
 */
const BLOCKING_CALL = /(?:\bwindow\s*\.\s*)?(?<![\w$.])(confirm|alert)\s*\(/g;

describe('no blocking browser dialogs in production source', () => {
    const files = sourceFiles(srcRoot);

    it('scans a meaningful number of source files', () => {
        // Guards against the walker silently finding nothing and passing vacuously.
        expect(files.length).toBeGreaterThan(200);
    });

    it('contains no reachable window.confirm / confirm() / window.alert / alert()', () => {
        const offenders = [];

        for (const file of files) {
            const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
            for (const match of code.matchAll(BLOCKING_CALL)) {
                const line = code.slice(0, match.index).split('\n').length;
                offenders.push(`${path.relative(srcRoot, file)}:${line} → ${match[0]}`);
            }
        }

        expect(offenders).toEqual([]);
    });
});
