#!/usr/bin/env node
/**
 * Tests for the AI provider boundary guard (`check-ai-provider-boundary.mjs`):
 * which files it reads, and what it reports in them.
 *
 * Plain assertions, no external runner. Exit 0 = all pass.
 * Run with `npm run test:ai-boundary`.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scannedFiles, violationsIn } from './check-ai-provider-boundary.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('AI provider boundary guard');

// What it reads: every tracked source file, so a new folder is covered the
// day it is created and a deleted one cannot leave the scan reading nothing.
const read = scannedFiles(repoRoot);
const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((path) => /\.(?:[cm]?jsx?|tsx?|html)$/.test(path));
const unread = tracked.filter((path) => !read.includes(path));
assert('1. it reads every tracked source file',
    tracked.length > 1000 && unread.length === 0,
    `${unread.length} of ${tracked.length} unread, e.g. ${unread.slice(0, 5).join(', ')}`);
assert('1b. the public site, the app shell and the catalog configuration among them',
    ['web/privacy.html', 'index.html', '.storybook/main.js'].every((path) => read.includes(path)));

// What it reports. The vendor strings are assembled, so this file is not
// itself a violation.
const CALL = `await fetch('https://${['api', 'openai', 'com'].join('.')}/v1/chat/completions', options);`;
assert('2. a vendor call in a page is reported', violationsIn('web/news.html', CALL).length === 1);
assert('2b. and in feature code', violationsIn('src/features/leads/score.js', CALL).length === 1);
assert('2c. a vendor SDK import is reported',
    violationsIn('functions/leads/score.js', `const Groq = require('${'groq'}-sdk');`).length === 1);
assert('3. the adapters and the registry may name vendors',
    violationsIn('functions/ai/providers/openai.js', CALL).length === 0
        && violationsIn('functions/ai/registry/providers.js', CALL).length === 0);
assert('3b. so may tests and documents',
    violationsIn('src/features/leads/score.test.js', CALL).length === 0
        && violationsIn('docs/AI.md', CALL).length === 0);
assert('3c. naming a vendor is not calling it',
    violationsIn('src/features/leads/score.js', '// Groq answers in under a second.').length === 0);

console.log(failures === 0 ? '\nAll AI provider boundary checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
