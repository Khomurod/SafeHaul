#!/usr/bin/env node
/**
 * What the source-size standard covers, and what it deliberately does not.
 *
 * Split out of `scripts/source-size.mjs` on 2026-08-27, when that file crossed
 * 400 lines under its own standard and was plainly doing two jobs: declaring the
 * scope, and running the check. This is the declaration — the limits, the formats
 * measured, the formats deliberately unmeasured, the formats that are not source
 * at all, the single excluded artifact, the roots that may never go unscanned,
 * and how a path is classified. No scanning, no counting, no git.
 *
 * It is worth keeping separate for the reason review kept finding: the half of a
 * coverage claim that goes stale silently is the half about what it does NOT look
 * at. Restricting the measured set to six JS/TS extensions once left a 3447-line
 * stylesheet, a 1682-line page and 693 lines of Firestore rules invisible while
 * every assertion passed; `.mdx` was later found in no list at all. Both were
 * gaps in this file's subject, not in the checker's logic, and they are easier to
 * audit when they are the whole content of one file.
 *
 * `scripts/source-size.mjs` re-exports everything here, because the tests and the
 * baseline modules import from it and a split must not move a published name.
 */


/** Physical lines, hard maximum, for every handwritten source file. */
export const HARD_LIMIT = 500;
/** Above this a file is asked to justify its shape in review. */
export const WARN_LIMIT = 400;

export const BACKLOG_PATH = '.github/source-size-backlog.json';

/**
 * The handwritten source languages in this repository.
 *
 * Not only JavaScript, and that gap was real: review on 2026-08-27 pointed out
 * that six JS/TS extensions left `landing/assets/css/styles.css` at 3447 lines,
 * `landing/index.html` at 1682 and `src/firestore.rules` at 693 unmeasured while
 * every required-root assertion still passed. A stylesheet and a security-rules
 * file are handwritten source that people have to read; measuring only the
 * scripts made the claim "every handwritten source file" untrue.
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
    reason: 'Documentation is meant to be long. docs/APP_BRIEF.md is 1154 lines because '
      + 'it is the orientation document, and shortening it to pass a code metric would '
      + 'be a straight loss.',
  },
  {
    extension: '.yml',
    reason: 'Workflows. .github/ is outside the roots this standard covers, and '
      + '.github/workflows/main.yml (1148 lines) is governed by npm run check:ci-plan, '
      + 'which asserts its structure job by job rather than by length. Recorded as a '
      + 'known limitation in AGENTS.md rather than silently omitted.',
  },
  {
    extension: '.yaml',
    reason: 'Workflows, for the same reason as .yml: outside the roots this standard covers, '
      + 'and pinned structurally by check:ci-plan rather than by length.',
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
 * This list exists because of what review found on 2026-08-27: `.mdx` was in
 * neither `SOURCE_EXTENSIONS` nor `UNMEASURED_FORMATS`, so a Storybook page could
 * have grown to any length while every coverage assertion stayed satisfied by
 * unrelated files. The gap was not that the reason was wrong — there was no
 * reason, because there was no entry.
 *
 * So the three lists are now exhaustive over the roots this standard covers, and
 * a test asserts it: an extension appearing under `src`, `functions`, `scripts`,
 * `e2e`, `landing` or `.storybook` must be measured, deliberately unmeasured, or
 * named here. A new format cannot arrive unclassified.
 */
export const NOT_SOURCE_FORMATS = Object.freeze([
  {
    extension: '.png',
    reason: 'Raster images — binary, and the 179 tracked ones are screenshots and visual '
      + 'baselines. A line count of a PNG is a count of accidental newline bytes.',
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
  'landing',
  '.storybook',
]);

const TEST_PATTERNS = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)(tests?|__tests__|e2e)\//];
const TOOLING_PATTERNS = [/^scripts\//, /^\.storybook\//, /^[^/]*\.config\.[cm]?js$/];

/**
 * Runtime, test or tooling.
 *
 * The category changes what a number MEANS — a 480-line test suite and a
 * 480-line React component are different problems — but not whether the limit
 * applies. Tests and tooling are handwritten code that people have to read.
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
