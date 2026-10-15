#!/usr/bin/env node
/**
 * What the source-size standard covers, and what it deliberately does not.
 *
 * Declaring the scope is one job; running the check (`scripts/source-size.mjs`)
 * is another. This is the declaration — the limits, the formats measured, the
 * formats deliberately unmeasured, the formats that are not source at all, the
 * single excluded artifact, the roots that may never go unscanned, and how a
 * path is classified. No scanning, no counting, no git.
 *
 * It is worth keeping separate because the half of a coverage claim that goes
 * stale silently is the half about what it does NOT look at. Six JS/TS
 * extensions alone leave stylesheets, HTML pages and Firestore rules invisible
 * while every assertion passes, and a format in no list at all is invisible
 * too. Both are gaps in this file's subject, not in the checker's logic, and
 * they are easier to audit when they are the whole content of one file.
 *
 * `scripts/source-size.mjs` re-exports everything here, because the tests and the
 * baseline modules import from it and a split must not move a published name.
 */


/**
 * Physical lines, hard maximum, for every handwritten source file except a test
 * (an owner ruling: warn past 500, refuse past 700, tests unlimited).
 */
export const HARD_LIMIT = 700;
/** Past this the check warns, and the file is asked to justify its shape. */
export const WARN_LIMIT = 500;

/**
 * The handwritten source languages in this repository.
 *
 * Not only JavaScript: six JS/TS extensions alone leave stylesheets, HTML pages
 * and `src/firestore.rules` unmeasured while every required-root assertion still
 * passes. A stylesheet and a security-rules file are handwritten source that
 * people have to read; measuring only the scripts would make the claim "every
 * handwritten source file" untrue.
 *
 * Several of these have no file in the repository today — `.mts`, `.cts`,
 * `.svelte`, `.vue`. They are here for the same reason `.ts` was before any
 * TypeScript existed: a guard has to hold when the thing it guards changes, and
 * the failure mode of an extension list is a new language arriving unmeasured.
 */
export const SOURCE_EXTENSIONS = Object.freeze([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
  '.css', '.scss', '.html', '.rules', '.svelte', '.vue',
]);

/**
 * Formats deliberately NOT measured, each with the reason it is not source.
 *
 * Stated rather than implied, because "what this does not look at" is the half of
 * a coverage claim that goes stale silently. Adding an entry here needs an
 * argument; adding an extension above needs none.
 */
export const UNMEASURED_FORMATS = Object.freeze([
  {
    extension: '.json',
    reason: 'Data and lockfiles. The largest are generated — package-lock.json is '
      + '19462 lines — and a long handwritten data table is a table, not a module that '
      + 'has outgrown a responsibility.',
  },
  {
    extension: '.md',
    reason: 'Documentation is measured by its own standard instead: the files AI agents '
      + 'read as instructions have per-file limits in scripts/agent-docs-limits.mjs '
      + '(npm run check:agent-docs), and a code metric would count prose as statements.',
  },
  {
    extension: '.yml',
    reason: 'Workflows. .github/ is outside the roots this standard covers, and '
      + '.github/workflows/main.yml (over 1,000 lines) is governed by npm run check:ci-plan, '
      + 'which asserts its structure job by job rather than by length. Recorded as a '
      + 'known limitation in .claude/rules/source-size.md rather than silently omitted.',
  },
  {
    extension: '.yaml',
    reason: 'Workflows, for the same reason as .yml: outside the roots this standard covers, '
      + 'and pinned structurally by check:ci-plan rather than by length.',
  },
  {
    extension: '.toml',
    reason: 'Configuration data. The one tracked file, .gitleaks.toml, is pinned line for '
      + 'line by npm run check:ci-plan (L24a) so that weakening the secret gate is not an '
      + 'alternative to passing it — a stricter guarantee than a length cap, and the same '
      + 'reason .yml is here.',
  },
  {
    extension: '.firebaserc',
    reason: 'Firebase project aliases: JSON data under a dotfile name, so the .json reason '
      + 'applies. A long one would mean many deploy targets, not a module that has outgrown '
      + 'a responsibility.',
  },
  {
    extension: '.mdx',
    reason: 'Documentation with a Storybook wrapper. The one tracked file, '
      + 'src/design-system/stories/Introduction.mdx, is 176 lines of prose around a single '
      + 'import and one <Meta> tag — the .md case, not the .jsx case. Measured as source it '
      + 'would push back on writing the catalog introduction, which is the opposite of what '
      + 'this standard is for. Found missing in review on 2026-08-27, which is why '
      + 'ACCOUNTED_FORMATS now exists: it was in no list at all.',
  },
]);

/**
 * Tracked formats that are not handwritten source in the first place.
 *
 * A format in neither `SOURCE_EXTENSIONS` nor `UNMEASURED_FORMATS` — as `.mdx`
 * would be without its entry above — lets a Storybook page grow to any length
 * while every coverage assertion stays satisfied by unrelated files. The gap is
 * not a wrong reason but no reason, because there is no entry.
 *
 * So the three lists are exhaustive over the WHOLE tracked tree, and a test
 * (`A7`) asserts it: every tracked file's format must be measured, deliberately
 * unmeasured, or named here. A new format cannot arrive unclassified.
 *
 * "Whole tree", not "the required roots": those roots exist to prove the scan
 * has not silently stopped covering a directory, which is a different question,
 * and an inventory scoped to `REQUIRED_ROOTS` leaves `.gitleaks.toml`
 * unclassified and lets a 900-line `build.py` at the repository root pass both
 * the inventory and the size scan (reproduced). The checker reads
 * `git ls-files` over everything, so its coverage claim is about everything,
 * and this list has to be too.
 */
export const NOT_SOURCE_FORMATS = Object.freeze([
  {
    extension: '.png',
    reason: 'Raster images — binary, and the 179 tracked ones are screenshots and visual '
      + 'baselines. A line count of a PNG is a count of accidental newline bytes.',
  },
  {
    extension: '.jpg',
    reason: 'One photo: functions/ai/tasks/verification/cdl-specimen.jpg, the made-up licence '
      + 'the daily AI model check reads. Binary, and its test pins it by hash.',
  },
  {
    extension: '.ico',
    reason: 'The favicon. A binary icon container, and public/favicon.ico is the only one.',
  },
  {
    extension: '.svg',
    reason: 'Vector artwork: three logo and fallback assets, exported from a design tool '
      + 'rather than hand-authored. Length reflects the path data, not a responsibility.',
  },
  {
    extension: '.woff2',
    reason: 'Webfont binaries (Inter, Archivo, Geist Mono). Compressed, so they contain no '
      + 'lines at all in the sense this standard means.',
  },
  {
    extension: '.txt',
    reason: 'Two files: src/design-system/fonts/LICENSE.txt and landing/robots.txt. A licence '
      + 'may not be shortened to pass a code metric, and robots.txt is a wire format.',
  },
  {
    extension: '.example',
    reason: 'functions/.env.example — a template of variable NAMES with no values, which is '
      + 'why it is safe to commit. It grows with the integration count, not with complexity.',
  },
  {
    extension: '.gitignore',
    reason: 'A tooling ignore list. Every line is one independent path pattern, so length '
      + 'measures how much is ignored rather than how much there is to read.',
  },
  {
    extension: '.gcloudignore',
    reason: 'Deploy-time upload exclusions for Cloud Functions — the same shape as '
      + '.gitignore, and shortening it would upload more, not simplify anything.',
  },
]);

/**
 * Every extension the standard has an answer for, measured or not.
 *
 * Kept as one derived set so the exhaustiveness test cannot drift from the three
 * lists it checks, and so adding a format to any of them is enough.
 */
export const ACCOUNTED_FORMATS = Object.freeze([
  ...SOURCE_EXTENSIONS,
  ...UNMEASURED_FORMATS.map((entry) => entry.extension),
  ...NOT_SOURCE_FORMATS.map((entry) => entry.extension),
]);

/**
 * The only paths excluded, each with the reason it is not handwritten source.
 *
 * Build output never reaches this list because the scan reads `git ls-files`,
 * and `dist/`, `storybook-static/`, `coverage/` and `node_modules/` are all
 * gitignored — they cannot be tracked, so they cannot be scanned. What remains
 * is the one vendored artifact that IS committed.
 */
export const EXCLUDED = Object.freeze([
  {
    path: 'public/pdf.worker.min.mjs',
    reason: 'Vendored, minified Mozilla PDF.js worker. Third-party build output, '
      + 'committed because it is served directly; not handwritten and not ours to split.',
  },
]);

/**
 * Directories that must yield source files, or the scan has silently stopped
 * looking somewhere it matters.
 *
 * This is the guard against the failure mode that makes a size checker useless:
 * a glob quietly stops matching, the report gets shorter, and everybody reads
 * the shorter report as progress. Each of these is asserted non-empty on every
 * run.
 */
export const REQUIRED_ROOTS = Object.freeze([
  'src',
  'functions',
  'scripts',
  'e2e',
  // Was `landing` until the marketing site was removed. `web/` replaced it as
  // the public Hosting root and carries the blog's stylesheets and the privacy
  // page, so the assertion still guards a real directory rather than being
  // dropped -- a root that stops yielding files is how a size scan shrinks
  // silently, which is the whole reason this list exists.
  'web',
  '.storybook',
]);

const TEST_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(tests?|__tests__|e2e)\//,
  // The tooling's own suites: `scripts/test-*.mjs` and `scripts/<area>/test-*.mjs`.
  /^scripts\/(?:[^/]+\/)*test-[^/]+\.[cm]?js$/,
];
const TOOLING_PATTERNS = [/^scripts\//, /^\.storybook\//, /^[^/]*\.config\.[cm]?js$/];

/**
 * Runtime, test or tooling.
 *
 * A test has no limit: a long suite is a list of cases, not a module that has
 * outgrown a responsibility. Runtime code and tooling keep it.
 */
export function classify(path) {
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return 'test';
  if (TOOLING_PATTERNS.some((pattern) => pattern.test(path))) return 'tooling';
  return 'runtime';
}

export function isSourcePath(path) {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

const excludedPaths = new Set(EXCLUDED.map((entry) => entry.path));
export function isExcluded(path) {
  return excludedPaths.has(path);
}
