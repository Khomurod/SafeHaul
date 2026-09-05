/**
 * What the icon campaign measures, and where it is allowed not to look.
 *
 * The campaign has one rule — **no file outside `src/design-system/icons/` names
 * `lucide-react`** — and one recorded list of the files that still do. Everything
 * here is the scope of that claim, kept in one module so a later split of the
 * checker cannot quietly narrow it.
 */

export const BACKLOG_PATH = 'src/design-system/icons/lucide-import.backlog.json';

/**
 * The one directory allowed to name the package.
 *
 * `icons/glyphs.js` exists in order to be the only importer, and
 * `icons/Icon.test.jsx` imports a raw component ON PURPOSE — it proves the
 * migration passthrough still accepts one, which is the thing that lets 178
 * unmigrated files keep working. Exempting the DIRECTORY rather than those two
 * paths means splitting the registry later cannot silently widen the exemption,
 * and moving a file out of it cannot silently keep one.
 */
export const CONTRACT_ROOT = 'src/design-system/icons/';

/** Where a JSX/TS glyph import can live. */
export const SOURCE_FILE_PATTERN = /\.(?:[jt]sx?|mjs|cjs)$/;

/**
 * Roots the scan must always find files under, asserted on every run.
 *
 * A size or import checker fails silently by covering less than it used to, and
 * a report that has stopped looking at a directory reads exactly like progress.
 * `source-size` records that lesson; this is the same assertion for the same
 * reason.
 */
export const REQUIRED_ROOTS = ['src/features', 'src/shared', 'src/design-system'];

/**
 * How many glyph names a file takes straight from `lucide-react`.
 *
 * A COUNT rather than a yes/no, and for the same reason `source-size` records
 * lines rather than "too big": it makes the backlog a ratchet a file can be
 * drained into. A screen holding sixteen glyphs can move twelve of them this
 * week, and the check still refuses the thirteenth coming back.
 *
 * Only the import statement is read, never the file's prose: `Icon.jsx` explains
 * the contract in a docstring that names the package, and a substring search
 * would have counted the explanation as the offence. That is the
 * "a check that fires on its own documentation gets switched off" case, one step
 * over.
 *
 * Namespace and default imports (`import * as icons`, `import icons from`) have
 * no name list to count, so they are refused outright by `namespaceImportPaths`
 * rather than being silently scored zero. Neither form exists in this repository
 * today; the refusal is there so the first one cannot arrive as a 0.
 */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g;
const ANY_IMPORT = /(?:^|[\s;])import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s*['"]lucide-react['"]/;

export function countLucideImports(source) {
    let total = 0;
    for (const match of source.matchAll(NAMED_IMPORT)) {
        total += match[1].split(',').filter((name) => name.trim() !== '').length;
    }
    return total;
}

/** True when the file imports the package in a form with no countable name list. */
export function hasUncountableImport(source) {
    if (!ANY_IMPORT.test(source)) return false;
    return countLucideImports(source) === 0;
}

/** A path the contract governs: a source file outside the icons directory. */
export function isGoverned(path) {
    return SOURCE_FILE_PATTERN.test(path) && !path.startsWith(CONTRACT_ROOT);
}
