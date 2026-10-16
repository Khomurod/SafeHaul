/**
 * What the design-system lint rules share: the names of their checks, the
 * shape of their options, and which file is being linted.
 *
 * Every rule takes the same `exceptions` option — one map, written once in
 * `./exceptions.mjs` — from a repo-relative file to the checks that file may
 * break, each with the reason roadmap §5 records for it. There are no counts:
 * an exception covers a check in a whole file. ESLint validates the map before
 * it lints anything, so a check that does not exist, or an exception with no
 * reason (fewer than 20 characters), stops the lint run instead of excusing
 * nothing or excusing something silently.
 */

import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Each rule's checks. A check is what a message and an exception name. */
export const CHECKS = {
    'no-raw-values': ['raw-hex-colour', 'sub-12px-type', 'arbitrary-type-size', 'raw-z-index'],
    'native-table': ['raw-table'],
    'use-primitive': [
        'hand-styled-button', 'hand-styled-field', 'hand-styled-anchor', 'raw-file-input',
        'hand-rolled-tablist', 'hand-rolled-toggle', 'hand-rolled-current', 'hand-rolled-disclosure',
        'hand-written-target-blank', 'hand-built-overlay', 'jsx-label-on-throwing-primitive',
    ],
};

/** A reason shorter than this is not one a reviewer can disagree with. */
export const MIN_REASON_LENGTH = 20;

const exceptionsSchema = {
    type: 'object',
    additionalProperties: {
        type: 'object',
        minProperties: 1,
        propertyNames: { enum: Object.values(CHECKS).flat() },
        additionalProperties: { type: 'string', minLength: MIN_REASON_LENGTH },
    },
};

/** The options schema of a rule; `extra` adds that rule's own options. */
export function optionsSchema(extra = {}) {
    return [{
        type: 'object',
        properties: { exceptions: exceptionsSchema, ...extra },
        additionalProperties: false,
    }];
}

/*
 * The repository root, from this file's place in it (`scripts/eslint-rules/`),
 * so an exception's key means the same file whatever directory ESLint runs in.
 * Behind a call rather than at module scope: Vitest rewrites `import.meta.url`.
 */
const repoRoot = () => fileURLToPath(new URL('../../', import.meta.url));

/** The file being linted, repo-relative with forward slashes: an exception's key. */
export function fileKey(context) {
    return relative(repoRoot(), context.physicalFilename ?? context.filename).split(sep).join('/');
}

/** The checks the exception list excuses in the file being linted. */
export function exceptedChecks(context) {
    const [options = {}] = context.options;
    return new Set(Object.keys(options.exceptions?.[fileKey(context)] ?? {}));
}

/**
 * Where `match` sits inside `node`'s source, so two findings in one string are
 * two locations. A string whose source spells the match differently (an escape)
 * is reported at the string itself.
 */
export function locate(sourceCode, node, match, from = 0) {
    const raw = sourceCode.getText(node);
    const at = raw.indexOf(match, from);
    if (at === -1) return { loc: node.loc, next: from };
    const start = node.range[0] + at;
    return {
        loc: { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(start + match.length) },
        next: at + match.length,
    };
}
