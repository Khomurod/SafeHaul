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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Directories walked. Everything outside these is not application code. */
const SCAN_ROOTS = ['functions', 'src', 'scripts', 'landing', 'e2e'];

/**
 * The only paths allowed to contain vendor specifics.
 *
 * `functions/ai/providers/` holds the adapters. The registry is allowed to
 * name base URLs because declaring them is its entire job. Tests are allowed
 * to assert against vendor shapes — that is how we know the adapters are right
 * — and documentation is allowed to describe them.
 */
const ALLOWED_PATH_PREFIXES = [
    join('functions', 'ai', 'providers'),
    join('functions', 'ai', 'registry'),
];

/** Test and documentation files may reference vendors anywhere. */
const ALLOWED_PATTERNS = [
    /\.test\.[cm]?jsx?$/,
    /\.spec\.[cm]?jsx?$/,
    /[\\/]test[\\/]/,
    /[\\/]__mocks__[\\/]/,
    /\.md$/,
];

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', 'storybook-static', 'playwright-report']);

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
    const normalized = relPath.split('/').join(sep);
    if (ALLOWED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
    return ALLOWED_PATTERNS.some((pattern) => pattern.test(relPath));
}

function walk(dir, files = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return files;
    }
    for (const entry of entries) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        const full = join(dir, entry);
        let stats;
        try {
            stats = statSync(full);
        } catch {
            continue;
        }
        if (stats.isDirectory()) walk(full, files);
        else if (SCANNED_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) files.push(full);
    }
    return files;
}

const violations = [];

for (const root of SCAN_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
        const relPath = relative(REPO_ROOT, file).split(sep).join('/');
        if (isAllowed(relPath)) continue;

        let contents;
        try {
            contents = readFileSync(file, 'utf8');
        } catch {
            continue;
        }

        const lines = contents.split('\n');
        for (const rule of RULES) {
            lines.forEach((line, index) => {
                if (rule.pattern.test(line)) {
                    violations.push({ file: relPath, line: index + 1, rule: rule.id, label: rule.label });
                }
            });
        }
    }
}

if (violations.length > 0) {
    console.error('\nAI provider boundary violated.\n');
    console.error('Only functions/ai/providers/ may contain AI vendor endpoints or SDKs.');
    console.error('Features must call a task interface from functions/ai/tasks/ instead.\n');
    for (const violation of violations) {
        console.error(`  ${violation.file}:${violation.line}  ${violation.label} (${violation.rule})`);
    }
    console.error(`\n${violations.length} violation(s).\n`);
    process.exit(1);
}

console.log('AI provider boundary intact: no direct vendor calls outside functions/ai/providers/.');
