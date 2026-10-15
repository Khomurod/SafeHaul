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
import { parse } from '@babel/parser';
import { indexParts } from './deploy-functions-index.mjs';
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

const onDisk = (repoRelPath) => existsSync(join(repoRoot, repoRelPath));

/**
 * Resolve a relative `require()` specifier (./foo, ../foo/bar, ./foo.js) from
 * `fromFile` (a repo-relative path like 'functions/companyAdmin.js') to a
 * repo-relative path of the actual file: on disk, or wherever `exists` says.
 *
 * Returns null if:
 *   - the specifier escapes the `functions/` tree
 *   - none of the files Node would try exists: the named `.js`/`.json` file, or
 *     else `<resolved>.js`, `.json`, `/index.js`, `/index.json`, in that order
 */
export function resolveRelativeRequire(fromFile, rel, exists = onDisk) {
  const baseDir = dirname(fromFile);
  const targetNoExt = normalize(join(baseDir, rel)).replace(/\\/g, '/');

  // Hard guard: never let a relative path walk us out of functions/.
  if (!targetNoExt.startsWith('functions/')) return null;

  // A required .json file is code too: `shared/applicationSections.json` is the
  // application's definition on the server.
  if (/\.(js|json)$/.test(targetNoExt)) {
    return exists(targetNoExt) ? targetNoExt : null;
  }

  const candidates = ['.js', '.json', '/index.js', '/index.json'].map((suffix) => `${targetNoExt}${suffix}`);
  return candidates.find((candidate) => exists(candidate)) || null;
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

/** The strings a source file holds (string literals and template text), or its whole text when it does not parse. */
const fileStringsCache = new Map();
function stringsIn(repoRelPath) {
  if (!fileStringsCache.has(repoRelPath)) {
    const src = readFileCached(repoRelPath);
    let strings = [];
    const visit = (node) => {
      if (node.type === 'StringLiteral') strings.push(node.value);
      if (node.type === 'TemplateElement') strings.push(node.value.cooked ?? node.value.raw);
      for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
        for (const child of Array.isArray(value) ? value : [value]) if (child && typeof child.type === 'string') visit(child);
      }
    };
    try {
      visit(parse(src, { sourceType: 'unambiguous', allowReturnOutsideFunction: true }).program);
    } catch {
      strings = [src];
    }
    fileStringsCache.set(repoRelPath, strings);
  }
  return fileStringsCache.get(repoRelPath);
}

/** The relative specifiers a file passes to require(): ./foo or ../foo/bar (with optional whitespace inside parens). */
export function requireSpecifiers(repoRelPath) {
  return [...readFileCached(repoRelPath).matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)].map((match) => match[1]);
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

  for (const specifier of requireSpecifiers(entryFile)) {
    const resolved = resolveRelativeRequire(entryFile, specifier);
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

/** The files under functions/ at a commit, as a set of repo-relative paths, or null when git cannot list them. */
export function filesAt(commit, cwd = repoRoot) {
  const r = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', commit, '--', 'functions/'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split('\0').filter(Boolean));
}

export function gitShow(commitColonPath) {
  const r = spawnSync('git', ['show', commitColonPath], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout;
}

/**
 * What a change to functions/index.js redeploys, between its base and head
 * sources: each export whose module or own wiring changed (another member of the
 * same module, another condition), and `loaderChanged` when the loader around
 * them changed, since every function starts on it (`deploy-functions-index.mjs`).
 * Formatting and comments are neither. Returns null when either side cannot be
 * parsed.
 */
export function diffIndexSources(oldSrc, newSrc) {
  const oldParsed = buildExportToFileFromSource(oldSrc);
  const newParsed = buildExportToFileFromSource(newSrc);
  if (!oldParsed.parseOk || !newParsed.parseOk) return null;

  let oldParts;
  let newParts;
  try {
    [oldParts, newParts] = [indexParts(oldSrc), indexParts(newSrc)];
  } catch {
    return null;
  }
  const changed = new Set();
  for (const [name, file] of newParsed.exportToFile) {
    if (oldParsed.exportToFile.get(name) !== file || oldParts.exports.get(name) !== newParts.exports.get(name)) changed.add(name);
  }
  return { changed, loaderChanged: oldParts.loader !== newParts.loader };
}

/** `diffIndexSources` for the base commit's index.js and the working tree's. */
export function diffExportsFromIndexChange(baseSha) {
  const oldSrc = gitShow(`${baseSha}:functions/index.js`);
  if (oldSrc === null) {
    console.warn('[incremental] Cannot read functions/index.js at base commit.');
    return null;
  }
  const diff = diffIndexSources(oldSrc, readFileSync(indexPath, 'utf8'));
  if (diff === null) console.warn('[incremental] index.js could not be parsed, or not every export mapped (base or head).');
  return diff;
}

/**
 * The functions a set of changed files redeploys: every function that loads one
 * of them. A file counts for its own module's exports, for those of the directory
 * module it sits in (`bulkActions/…` → `bulkActions/index.js`), and for those of
 * every entrypoint whose require() closure reaches it (JSON included), all at
 * once. A file the code reads from disk instead (an image, a JSON file it does
 * not require) counts for the entrypoints of the code that names it in a string,
 * not in a comment. With `existedAtBase`, which says what the base commit held,
 * a file also counts for the code whose require() found it there: a deleted file
 * is in no closure of the tree being deployed, and that code now loads whatever
 * its require() finds instead. functions/index.js is left to
 * `diffIndexSources`, and the always-include list to `main()`.
 */
export function planChangedFiles(changedFiles, { exportToFile, fileToEntries, existedAtBase }) {
  const fileToExports = new Map();
  for (const [name, file] of exportToFile) {
    if (!fileToExports.has(file)) fileToExports.set(file, []);
    fileToExports.get(file).push(name);
  }
  const runtimeChanges = filterProductionFunctionPaths(changedFiles);
  const loadersAtBase = new Map();
  if (existedAtBase) {
    const changed = new Set(runtimeChanges);
    for (const [source, entries] of fileToEntries) {
      for (const specifier of requireSpecifiers(source)) {
        const target = resolveRelativeRequire(source, specifier, existedAtBase);
        if (!changed.has(target)) continue;
        if (!loadersAtBase.has(target)) loadersAtBase.set(target, new Set());
        entries.forEach((entry) => loadersAtBase.get(target).add(entry));
      }
    }
  }
  const exports = new Set();
  const notes = [];
  const skippedOrphans = [];
  for (const file of runtimeChanges) {
    if (file === 'functions/index.js') continue;
    const owners = [...ownersOf(file, fileToExports, fileToEntries, loadersAtBase)].sort();
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

function ownersOf(file, fileToExports, fileToEntries, loadersAtBase) {
  const owners = new Set([...(fileToEntries.get(file) || []), ...(loadersAtBase.get(file) || [])]);
  for (const module of fileToExports.keys()) {
    if (module === file) owners.add(module);
    if (module.endsWith('/index.js') && file.startsWith(module.slice(0, -'index.js'.length))) owners.add(module);
  }
  if (!file.endsWith('.js')) {
    const name = basename(file);
    for (const [source, entries] of fileToEntries) {
      if (source.endsWith('.js') && stringsIn(source).some((text) => text.includes(name))) entries.forEach((e) => owners.add(e));
    }
  }
  return owners;
}

/**
 * The files under functions/ that differ between two commits. A renamed file is
 * listed under both names (`--no-renames`): its old path is a deleted dependency.
 */
export function getChangedFunctionFiles(base, head, cwd = repoRoot) {
  const r = spawnSync(
    'git',
    ['diff', '--name-only', '--no-renames', `${base}..${head}`, '--', 'functions/'],
    { cwd, encoding: 'utf8' }
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
