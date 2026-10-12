#!/usr/bin/env node
/**
 * Repository guard: no SafeHaul feature may call an AI provider directly.
 *
 * The shared AI platform is only worth having if it cannot be bypassed. This
 * script fails CI when vendor endpoints, vendor SDK imports or provider
 * authorization patterns appear anywhere except inside the provider-adapter
 * folder, which is the one place permitted to know a vendor's wire format.
 *
 * Run: `node scripts/check-ai-provider-boundary.mjs`
 * CI:  `npm run check:ai-boundary`
 *
 * Adding a provider means adding an adapter under `functions/ai/providers/`.
 * It never means adding a fetch somewhere convenient.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The only paths allowed to contain vendor specifics.
 *
 * `functions/ai/providers/` holds the adapters. The registry is allowed to
 * name base URLs because declaring them is its entire job. Tests are allowed
 * to assert against vendor shapes — that is how we know the adapters are right
 * — and documentation is allowed to describe them.
 */
const ALLOWED_PATH_PREFIXES = ['functions/ai/providers/', 'functions/ai/registry/'];

/** Test and documentation files may reference vendors anywhere. */
const ALLOWED_PATTERNS = [
    /\.test\.[cm]?jsx?$/,
    /\.spec\.[cm]?jsx?$/,
    /[\\/]test[\\/]/,
    /[\\/]__mocks__[\\/]/,
    /\.md$/,
];

const SCANNED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.html']);

/**
 * Each rule is a vendor fingerprint plus a human explanation. Hostnames are
 * matched rather than brand names so that merely *mentioning* Groq in a
 * comment is fine while *calling* it is not.
 */
const RULES = [
    { id: 'groq-endpoint', pattern: /api\.groq\.com/i, label: 'Groq API endpoint' },
    { id: 'gemini-endpoint', pattern: /generativelanguage\.googleapis\.com/i, label: 'Gemini API endpoint' },
    { id: 'vertex-endpoint', pattern: /aiplatform\.googleapis\.com/i, label: 'Vertex AI endpoint' },
    { id: 'cloudflare-ai-endpoint', pattern: /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]*\/ai/i, label: 'Cloudflare Workers AI endpoint' },
    { id: 'github-models-endpoint', pattern: /models\.(github|inference)\.ai/i, label: 'GitHub Models endpoint' },
    { id: 'mistral-endpoint', pattern: /api\.mistral\.ai/i, label: 'Mistral API endpoint' },
    { id: 'cerebras-endpoint', pattern: /api\.cerebras\.ai/i, label: 'Cerebras API endpoint' },
    { id: 'sambanova-endpoint', pattern: /api\.sambanova\.ai/i, label: 'SambaNova API endpoint' },
    { id: 'openrouter-endpoint', pattern: /openrouter\.ai\/api/i, label: 'OpenRouter API endpoint' },
    { id: 'huggingface-endpoint', pattern: /(router|api-inference)\.huggingface\.co/i, label: 'Hugging Face inference endpoint' },
    { id: 'openai-endpoint', pattern: /api\.openai\.com/i, label: 'OpenAI API endpoint' },
    { id: 'anthropic-endpoint', pattern: /api\.anthropic\.com/i, label: 'Anthropic API endpoint' },
    {
        id: 'vendor-sdk',
        pattern: /require\(\s*['"](groq-sdk|openai|@anthropic-ai\/[^'"]+|@google\/generative-ai|@google\/genai|@mistralai\/[^'"]+|cohere-ai|@huggingface\/inference)['"]\s*\)|from\s+['"](groq-sdk|openai|@anthropic-ai\/[^'"]+|@google\/generative-ai|@google\/genai|@mistralai\/[^'"]+|cohere-ai|@huggingface\/inference)['"]/,
        label: 'direct AI vendor SDK import',
    },
];

function isAllowed(relPath) {
    if (ALLOWED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return true;
    return ALLOWED_PATTERNS.some((pattern) => pattern.test(relPath));
}

/**
 * Every source file git tracks, or would (new files not yet added, minus the
 * ignored), not a list of folders. A listed folder that no longer existed was
 * skipped without a word, and a folder nobody listed was never read: the
 * public site, `index.html` and the catalog's configuration all sat outside
 * the scan.
 */
export function scannedFiles(repoRoot) {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).split('\0').filter(Boolean);
    if (listed.length === 0) throw new Error('git ls-files listed nothing, so nothing would be checked');
    return [...new Set(listed)].filter((relPath) => SCANNED_EXTENSIONS.has(extname(relPath)));
}

/** The vendor fingerprints in one file, unless the file is allowed to carry them. */
export function violationsIn(relPath, contents) {
    if (isAllowed(relPath)) return [];
    const found = [];
    const lines = contents.split('\n');
    for (const rule of RULES) {
        lines.forEach((line, index) => {
            if (rule.pattern.test(line)) found.push({ file: relPath, line: index + 1, rule: rule.id, label: rule.label });
        });
    }
    return found;
}

function main() {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const files = scannedFiles(repoRoot);
    // A tracked file deleted in this working copy has nothing left to read.
    const present = files.filter((relPath) => existsSync(join(repoRoot, relPath)));
    const violations = present.flatMap((relPath) => violationsIn(relPath, readFileSync(join(repoRoot, relPath), 'utf8')));

    if (violations.length > 0) {
        console.error('\nAI provider boundary violated.\n');
        console.error('Only functions/ai/providers/ may contain AI vendor endpoints or SDKs.');
        console.error('Features must call a task interface from functions/ai/tasks/ instead.\n');
        for (const violation of violations) {
            console.error(`  ${violation.file}:${violation.line}  ${violation.label} (${violation.rule})`);
        }
        console.error(`\n${violations.length} violation(s).\n`);
        return 1;
    }

    console.log(`AI provider boundary intact: ${present.length} source files, no direct vendor calls outside functions/ai/providers/.`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.exit(main());
    } catch (error) {
        console.error(`AI provider boundary not checked: ${error.message}`);
        process.exit(1);
    }
}
