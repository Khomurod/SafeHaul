#!/usr/bin/env node
/**
 * Fails when an instruction file for AI agents outgrows its limit.
 *
 * The limits live in `agent-docs-limits.mjs`. The files are what git tracks
 * (`git ls-files -z`, as the source-size guard reads them), so a renamed file
 * is still measured and a file a pattern requires cannot disappear quietly.
 *
 *   npm run check:agent-docs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DOC_LIMITS, ALWAYS_LOADED, ALWAYS_LOADED_MAX_BYTES } from './agent-docs-limits.mjs';
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

/** Every tracked file at least one limit applies to, read from disk. */
export function readAgentDocs({ cwd = process.cwd(), limits = AGENT_DOC_LIMITS } = {}) {
    const patterns = limits.map((limit) => globToRegExp(limit.pattern));
    return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\0')
        .filter((path) => path && patterns.some((pattern) => pattern.test(path)))
        // Tracked but absent from the working tree (a staged deletion): nothing to read.
        .filter((path) => existsSync(resolve(cwd, path)))
        .map((path) => ({ path, text: readFileSync(resolve(cwd, path), 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const files = readAgentDocs();
    const problems = checkAgentDocs(files);
    for (const file of files) console.log(`  ${String(countLines(file.text)).padStart(5)} lines  ${file.path}`);
    if (problems.length > 0) {
        console.error(`\nAgent instruction files over their limits:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }
    console.log(`\nagent-docs OK: ${files.length} instruction files within their limits.`);
}
