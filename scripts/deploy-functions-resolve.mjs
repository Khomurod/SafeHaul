/**
 * The incremental deploy's resolution logic, extracted verbatim from
 * `deploy-functions-incremental.mjs` — see that file's header for the rules.
 * Everything here is the pure mapping/closure half: export→module parsing,
 * the transitive require() walker, changed-file discovery and the git-range
 * resolution. The deploy driver (`main`, the firebase invocation) stays in
 * the entry. This module sits at the same `scripts/` depth as the entry, so
 * `root`/`repoRoot` resolve identically.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { basename, dirname, join, normalize } from 'path';
import { spawnSync } from 'child_process';

export const root = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(root, '..');
export const functionsDir = join(repoRoot, 'functions');
export const indexPath = join(functionsDir, 'index.js');

export function parseAlwaysInclude() {
  const raw = process.env.DEPLOY_FUNCTIONS_ALWAYS_INCLUDE || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize require('./foo') to a repo-relative path under functions/.
 * Prefers foo/index.js when present (Node resolution), else foo.js.
 */
export function modulePathToFile(rel) {
  let n = rel.replace(/^\.\//, '');
  const funcRoot = join(repoRoot, 'functions');

  if (n.endsWith('.js')) {
    return normalize(join('functions', n)).replace(/\\/g, '/');
  }

  const indexFile = join(funcRoot, n, 'index.js');
  const directFile = join(funcRoot, `${n}.js`);

  if (existsSync(indexFile)) {
    return normalize(join('functions', n, 'index.js')).replace(/\\/g, '/');
  }
  if (existsSync(directFile)) {
    return normalize(join('functions', `${n}.js`)).replace(/\\/g, '/');
  }

  return normalize(join('functions', `${n}.js`)).replace(/\\/g, '/');
}

/**
 * Parse index.js source: export name → functions/relative path of top-level module.
 */
export function buildExportToFileFromSource(src) {
  const varToFile = new Map();

  const reRequire = /(?:const|let|var)\s+(\w+)\s*=\s*require\(['"](\.\/[^'"]+)['"]\)/g;
  let m;
  while ((m = reRequire.exec(src))) {
    varToFile.set(m[1], modulePathToFile(m[2]));
  }

  const exportToFile = new Map();

  const reExportVar = /exports\.(\w+)\s*=\s*(\w+)\.(\w+)/g;
  while ((m = reExportVar.exec(src))) {
    const [, expName, modVar] = m;
    const f = varToFile.get(modVar);
    if (f) exportToFile.set(expName, f);
  }

  const reExportReq = /exports\.(\w+)\s*=\s*require\(['"](\.\/[^'"]+)['"]\)\.(\w+)/g;
  while ((m = reExportReq.exec(src))) {
    exportToFile.set(m[1], modulePathToFile(m[2]));
  }

  const rawExportNames = new Set([...src.matchAll(/exports\.(\w+)\s*=/g)].map((x) => x[1]));
  const parseOk = exportToFile.size === rawExportNames.size && [...rawExportNames].every((n) => exportToFile.has(n));

  return { exportToFile, varToFile, parseOk, rawExportNames };
}

export function buildExportToFile() {
  const src = readFileSync(indexPath, 'utf8');
  return buildExportToFileFromSource(src);
}

/**
 * Resolve a relative `require()` specifier (./foo, ../foo/bar, ./foo.js) from
 * `fromFile` (a repo-relative path like 'functions/companyAdmin.js') to a
 * repo-relative path of the actual file on disk.
 *
 * Returns null if:
 *   - the specifier escapes the `functions/` tree
 *   - the named `.js`/`.json` file, or else `<resolved>.js` or `<resolved>/index.js`,
 *     does not exist on disk
 */
export function resolveRelativeRequire(fromFile, rel) {
  const baseDir = dirname(fromFile);
  const targetNoExt = normalize(join(baseDir, rel)).replace(/\\/g, '/');

  // Hard guard: never let a relative path walk us out of functions/.
  if (!targetNoExt.startsWith('functions/')) return null;

  // A required .json file is code too: `shared/applicationSections.json` is the
  // application's definition on the server.
  if (/\.(js|json)$/.test(targetNoExt)) {
    return existsSync(join(repoRoot, targetNoExt)) ? targetNoExt : null;
  }

  const asFile = `${targetNoExt}.js`;
  if (existsSync(join(repoRoot, asFile))) return asFile;
  const asIndex = `${targetNoExt}/index.js`;
  if (existsSync(join(repoRoot, asIndex))) return asIndex;
  return null;
}

/** Tiny cache so the closure walker re-uses file sources across entrypoints. */
const fileSourceCache = new Map();
export function readFileCached(repoRelPath) {
  if (fileSourceCache.has(repoRelPath)) return fileSourceCache.get(repoRelPath);
  const abs = join(repoRoot, repoRelPath);
  const src = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  fileSourceCache.set(repoRelPath, src);
  return src;
}

/**
 * Recursively collect every relative dependency reachable from `entryFile`.
 * Bare specifiers (e.g. `firebase-admin`, `nodemailer`) are intentionally skipped:
 * those are npm deps, not in-repo source, so they cannot be affected by a git diff
 * inside `functions/`.
 *
 * Cycles are handled via the `visited` set.
 * Dynamic requires (template literals, variables) are not analyzable and are skipped;
 * if a changed file is only referenced dynamically it will fall through to the
 * full-deploy escape hatch — that's correct, since static analysis can't prove
 * otherwise.
 */
export function collectClosure(entryFile, visited = new Set()) {
  if (visited.has(entryFile)) return visited;
  visited.add(entryFile);

  const src = readFileCached(entryFile);
  if (!src) return visited;

  // Only relative requires: ./foo or ../foo/bar (with optional whitespace inside parens).
  const reReq = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reReq.exec(src))) {
    const resolved = resolveRelativeRequire(entryFile, m[1]);
    if (resolved && !visited.has(resolved)) {
      collectClosure(resolved, visited);
    }
  }
  return visited;
}

/**
 * Invert per-entrypoint closures into a `file → Set<entrypoint>` map.
 * Lookups in this map answer: "if this file changed, which entrypoint modules
 * (and therefore which Cloud Function exports) need to be redeployed?"
 */
export function buildFileToEntrypoints(knownTopLevelFiles) {
  const fileToEntries = new Map();
  for (const entry of knownTopLevelFiles) {
    const closure = collectClosure(entry);
    for (const dep of closure) {
      if (!fileToEntries.has(dep)) fileToEntries.set(dep, new Set());
      fileToEntries.get(dep).add(entry);
    }
  }
  return fileToEntries;
}

export function gitShow(commitColonPath) {
  const r = spawnSync('git', ['show', commitColonPath], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout;
}

/**
 * What a change to functions/index.js redeploys, between its base and head
 * sources: each export whose module or own line changed (another member of the
 * same module, another condition), and `loaderChanged` when the code around the
 * export lines changed. Every function starts on that code (it picks the module
 * FUNCTION_TARGET names), so a loader change concerns them all. Comments,
 * spacing and blank lines are neither. Returns null when either side cannot be
 * parsed.
 */
export function diffIndexSources(oldSrc, newSrc) {
  const oldParsed = buildExportToFileFromSource(oldSrc);
  const newParsed = buildExportToFileFromSource(newSrc);
  if (!oldParsed.parseOk || !newParsed.parseOk) return null;

  const oldLines = exportLines(oldSrc);
  const newLines = exportLines(newSrc);
  const changed = new Set();
  for (const [name, file] of newParsed.exportToFile) {
    if (oldParsed.exportToFile.get(name) !== file || oldLines.get(name) !== newLines.get(name)) changed.add(name);
  }
  return { changed, loaderChanged: indexLoaderCode(oldSrc) !== indexLoaderCode(newSrc) };
}

const EXPORT_LINE = /\bexports\.(\w+)\s*=/;
const MODULE_VARIABLE = /^(?:const|let|var)\s+\w+\s*=\s*require\(['"]\.\/[^'"]+['"]\);?$/;
const codeLines = (src) => stripComments(src).split('\n').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);

/** Each export's line of index.js, comments and spacing aside. */
function exportLines(src) {
  const lines = new Map();
  for (const line of codeLines(src)) {
    const name = line.match(EXPORT_LINE)?.[1];
    if (name) lines.set(name, [lines.get(name), line].filter(Boolean).join('\n'));
  }
  return lines;
}

/**
 * index.js without comments, blank lines and its wiring: the lines that assign an
 * export and, in its older form, those that require a module into a variable.
 */
export function indexLoaderCode(src) {
  return codeLines(src).filter((line) => !EXPORT_LINE.test(line) && !MODULE_VARIABLE.test(line)).join('\n');
}

/** Drops // and /* *\/ comments, keeping strings (which may hold either) whole. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (two === '/*') {
      const close = src.indexOf('*/', i + 2);
      const stop = close === -1 ? src.length : close + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== src[i]) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** `diffIndexSources` for the base commit's index.js and the working tree's. */
export function diffExportsFromIndexChange(baseSha) {
  const oldSrc = gitShow(`${baseSha}:functions/index.js`);
  if (oldSrc === null) {
    console.warn('[incremental] Cannot read functions/index.js at base commit.');
    return null;
  }
  const diff = diffIndexSources(oldSrc, readFileSync(indexPath, 'utf8'));
  if (diff === null) console.warn('[incremental] index.js export parse incomplete (base or head).');
  return diff;
}

/**
 * The functions a set of changed files redeploys: every function that loads one
 * of them. A file counts for its own module's exports, for those of the directory
 * module it sits in (`bulkActions/…` → `bulkActions/index.js`), and for those of
 * every entrypoint whose require() closure reaches it (JSON included), all at
 * once. A file the code reads from disk instead (an image) counts for the
 * entrypoints of the code that names it. functions/index.js is left to
 * `diffIndexSources`, and the always-include list to `main()`.
 */
export function planChangedFiles(changedFiles, { exportToFile, fileToEntries }) {
  const fileToExports = new Map();
  for (const [name, file] of exportToFile) {
    if (!fileToExports.has(file)) fileToExports.set(file, []);
    fileToExports.get(file).push(name);
  }
  const exports = new Set();
  const notes = [];
  const skippedOrphans = [];
  for (const file of filterProductionFunctionPaths(changedFiles)) {
    if (file === 'functions/index.js') continue;
    const owners = [...ownersOf(file, fileToExports, fileToEntries)].sort();
    if (owners.length === 0) {
      skippedOrphans.push(file);
      continue;
    }
    const names = new Set(owners.flatMap((owner) => fileToExports.get(owner) || []));
    names.forEach((name) => exports.add(name));
    notes.push(`${file} → ${owners.length} module(s) [${owners.join(', ')}] → ${names.size} export(s)`);
  }
  return { exports, skippedOrphans, notes };
}

function ownersOf(file, fileToExports, fileToEntries) {
  const owners = new Set(fileToEntries.get(file) || []);
  for (const module of fileToExports.keys()) {
    if (module === file) owners.add(module);
    if (module.endsWith('/index.js') && file.startsWith(module.slice(0, -'index.js'.length))) owners.add(module);
  }
  if (!/\.(js|json)$/.test(file)) {
    const name = basename(file);
    for (const [source, entries] of fileToEntries) {
      if (source.endsWith('.js') && readFileCached(source).includes(name)) entries.forEach((e) => owners.add(e));
    }
  }
  return owners;
}

export function getChangedFunctionFiles(base, head) {
  const r = spawnSync(
    'git',
    ['diff', '--name-only', `${base}..${head}`, '--', 'functions/'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.warn('[incremental] git diff failed:', r.stderr || r.stdout);
    return null;
  }
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => normalize(p).replace(/\\/g, '/'));
}

/**
 * A file that ships with the functions and can change what they do: code, the
 * JSON it requires, a file it reads. Not the tests, dotfiles, docs, or the
 * package manifest and lockfile: a dependency upgrade reaches a function at its
 * next deploy.
 */
export function isRuntimeFunctionSource(pathLike) {
  const n = String(pathLike || '').replace(/\\/g, '/');
  if (!n.startsWith('functions/') || n.startsWith('functions/test/')) return false;
  if (/^functions\/package(-lock)?\.json$/.test(n)) return false;
  const name = basename(n);
  return !name.startsWith('.') && !name.endsWith('.md');
}

/** Strict mode: only runtime sources participate in deploy targeting. */
export function filterProductionFunctionPaths(changedFiles) {
  return changedFiles.filter((c) => isRuntimeFunctionSource(c));
}

export function resolveGitRange() {
  let base = process.env.DEPLOY_GIT_BASE;
  let head = process.env.DEPLOY_GIT_HEAD || process.env.GITHUB_SHA;
  const before = process.env.GITHUB_PUSH_BEFORE;

  if (!base && before && head && !/^0+$/.test(before)) {
    base = before;
  }
  if (!head) {
    const h = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    if (h.status === 0) head = h.stdout.trim();
  }
  if (!base) {
    const p = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: repoRoot, encoding: 'utf8' });
    if (p.status === 0) base = p.stdout.trim();
  }

  return { base, head };
}
