#!/usr/bin/env node
/**
 * Fails when an instruction file for AI agents outgrows its limit.
 *
 * The limits live in `agent-docs-limits.mjs`. The files are what git tracks
 * (`git ls-files -z`, as the source-size guard reads them), so a renamed file
 * is still measured and a file a pattern requires cannot disappear quietly.
 *
 * Two more refusals keep the lock honest. Limits are compared with the base
 * commit and may only move down (`agent-docs-baseline.mjs`), and every
 * repository path the instructions name in backticks must exist, so a topic
 * file cannot be deleted or renamed while the rules still send agents to it.
 *
 *   npm run check:agent-docs [-- --require-baseline]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DOC_LIMITS, ALWAYS_LOADED, ALWAYS_LOADED_MAX_BYTES } from './agent-docs-limits.mjs';
import { checkLimitsDirection } from './agent-docs-baseline.mjs';
import { countLines } from './source-size.mjs';

/** Glob over repository paths: `**` crosses directories (and may match none), `*` and `?` do not. */
export function globToRegExp(glob) {
    if (/[{}[\]]/.test(glob)) throw new Error(`unsupported glob syntax in ${glob}: use plain ** and * patterns`);
    let source = '';
    for (let i = 0; i < glob.length; i += 1) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            const slash = glob[i + 2] === '/';
            source += slash ? '(?:.*/)?' : '.*';
            i += slash ? 2 : 1;
        } else if (c === '*') {
            source += '[^/]*';
        } else if (c === '?') {
            source += '[^/]';
        } else {
            source += c.replace(/[.+^$()|\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`);
}

/** A rule scoped with `paths:` frontmatter loads only when Claude opens a matching file. */
export function hasPathsFrontmatter(text) {
    if (!text.startsWith('---\n')) return false;
    const end = text.indexOf('\n---', 4);
    return end !== -1 && /^paths\s*:/m.test(text.slice(4, end));
}

/**
 * @param {{ path: string, text: string }[]} files tracked files, contents read
 * @returns {string[]} one sentence per problem; empty when every file fits
 */
export function checkAgentDocs(files, {
    limits = AGENT_DOC_LIMITS, alwaysLoaded = ALWAYS_LOADED, alwaysLoadedMaxBytes = ALWAYS_LOADED_MAX_BYTES,
} = {}) {
    const problems = [];
    const shorten = 'Shorten it, and move any history to docs/archive/.';
    for (const limit of limits) {
        const pattern = globToRegExp(limit.pattern);
        const matched = files.filter((file) => pattern.test(file.path));
        if (limit.mustExist && matched.length === 0) {
            problems.push(`${limit.pattern}: no tracked file matches, so this limit measures nothing. Was it renamed or deleted?`);
        }
        for (const file of matched) {
            const lines = countLines(file.text);
            const bytes = Buffer.byteLength(file.text, 'utf8');
            if (lines > limit.maxLines) {
                problems.push(`${file.path}: ${lines} lines, over its limit of ${limit.maxLines} (${limit.why}). ${shorten}`);
            }
            if (limit.maxBytes && bytes > limit.maxBytes) {
                problems.push(`${file.path}: ${bytes} bytes, over its limit of ${limit.maxBytes} (${limit.why}). ${shorten}`);
            }
            if (limit.requirePaths && !hasPathsFrontmatter(file.text)) {
                problems.push(`${file.path}: no \`paths:\` frontmatter, so it would load in every session. Scope it, or move the rule into AGENTS.md.`);
            }
        }
    }
    const together = alwaysLoaded.reduce((sum, path) => {
        const file = files.find((candidate) => candidate.path === path);
        return sum + (file ? Buffer.byteLength(file.text, 'utf8') : 0);
    }, 0);
    if (together > alwaysLoadedMaxBytes) {
        problems.push(`${alwaysLoaded.join(' + ')}: ${together} bytes together, over the ${alwaysLoadedMaxBytes} every session can afford. ${shorten}`);
    }
    return problems;
}

/** Files whose named paths must exist: the instructions every agent follows. */
const REFERENCE_CHECKED = ['AGENTS.md', 'CLAUDE.md', '**/AGENTS.md', '**/CLAUDE.md', '.claude/rules/**/*.md'].map(globToRegExp);

/** Repository paths a text names in backticks, such as `docs/APP_BRIEF.md` or `.claude/rules/`. */
export function namedPaths(text) {
    const paths = new Set();
    for (const [, token] of text.matchAll(/`([^`\n]+)`/g)) {
        // A path has a slash, is relative, and holds no command, glob, placeholder or URL.
        if (!token.includes('/') || token.startsWith('/') || /[\s*{}<>=$…]|:\/\//.test(token)) continue;
        paths.add(token);
    }
    return [...paths];
}

/** One sentence per named path that is not in the repository. */
export function missingPaths(files, tracked) {
    const known = new Set(tracked);
    const problems = [];
    for (const file of files.filter((candidate) => REFERENCE_CHECKED.some((re) => re.test(candidate.path)))) {
        for (const path of namedPaths(file.text)) {
            const dir = path.endsWith('/') ? path : `${path}/`;
            if (known.has(path) || tracked.some((candidate) => candidate.startsWith(dir))) continue;
            problems.push(`${file.path}: names \`${path}\`, which is not in the repository. Fix the reference or restore the file.`);
        }
    }
    return problems;
}

/** Every tracked path, as git lists it. */
export function trackedPaths(cwd = process.cwd()) {
    return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\0')
        .filter(Boolean);
}

/** Every tracked file at least one limit applies to, read from disk. */
export function readAgentDocs({ cwd = process.cwd(), limits = AGENT_DOC_LIMITS } = {}) {
    const patterns = limits.map((limit) => globToRegExp(limit.pattern));
    return trackedPaths(cwd)
        .filter((path) => patterns.some((pattern) => pattern.test(path)))
        // Tracked but absent from the working tree (a staged deletion): nothing to read.
        .filter((path) => existsSync(resolve(cwd, path)))
        .map((path) => ({ path, text: readFileSync(resolve(cwd, path), 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const files = readAgentDocs();
    const direction = await checkLimitsDirection({
        current: { limits: AGENT_DOC_LIMITS, alwaysLoaded: ALWAYS_LOADED, alwaysLoadedMaxBytes: ALWAYS_LOADED_MAX_BYTES },
        cwd: process.cwd(),
        requireBaseline: process.argv.includes('--require-baseline'),
    });
    const problems = [...checkAgentDocs(files), ...missingPaths(files, trackedPaths()), ...direction.problems];
    for (const file of files) console.log(`  ${String(countLines(file.text)).padStart(5)} lines  ${file.path}`);
    console.log(`\nbaseline: ${direction.describe}`);
    if (problems.length > 0) {
        console.error(`\nAgent instruction files over their limits:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }
    console.log(`\nagent-docs OK: ${files.length} instruction files within their limits.`);
}
