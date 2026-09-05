/**
 * The harness the secret-scan test sections share: assertions, synthetic
 * secrets, throwaway repositories, and the pinned scanner.
 *
 * Split out on 2026-08-27 when the single test file reached 1246 lines. The
 * sections it served are independent subjects — which range each event picks,
 * what those ranges actually catch, how a base that cannot be trusted is
 * refused, how the last validated commit is found, and what the pinning buys —
 * but they all need the same three things, and duplicating any of them would let
 * two sections drift into testing different fixtures while reading identically.
 *
 * The failure counter lives here for the same reason: one process, one count,
 * and `scripts/test-secret-scan.mjs` reports it once at the end.
 *
 * ## The fixtures contain no real credential, and no literal at all
 *
 * Every synthetic secret is derived at run time from a fixed seed (`synth`
 * below). Two consequences, both deliberate:
 *
 *   - the values are identical on every run, so a failure is reproducible;
 *   - no secret-shaped literal is ever committed to this repository, so this
 *     file does not need an allowlist entry and cannot become the place a real
 *     leak hides. The only literals here are the two values `.gitleaks.toml`
 *     already exempts by name — which is precisely what the detection section's
 *     cases 11 and 12 test.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRunner } from './git.mjs';
import { GITLEAKS_VERSION, ensureGitleaks, performScans } from './gitleaks.mjs';
import { ScanPlanError } from './range.mjs';
import { removeTree } from '../lib/throwaway.mjs';

export const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolvePath(here, '../..');
export const REPO_CONFIG = resolvePath(repoRoot, '.gitleaks.toml');

let failures = 0;

export function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${detail}`);
}

export function throws(label, fn, detail) {
    try {
        fn();
        failures += 1;
        console.log(`  FAIL ${label}`);
        console.log(`       it returned instead of refusing${detail ? ` — ${detail}` : ''}`);
    } catch (error) {
        if (error instanceof ScanPlanError) {
            console.log(`  ok   ${label}`);
            return;
        }
        failures += 1;
        console.log(`  FAIL ${label}`);
        console.log(`       threw ${error?.constructor?.name}: ${error?.message}`);
    }
}

export const failureCount = () => failures;

/* -------------------------------------------------------------------------- */
/* Synthetic secrets, derived rather than written down                          */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, seeded, and identical on every platform. */
export function prng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function synth(seed, length) {
    const random = prng(seed);
    let out = '';
    for (let i = 0; i < length; i += 1) out += ALPHA[Math.floor(random() * ALPHA.length)];
    return out;
}

/**
 * A Google-API-key-shaped value: matches `gcp-api-key` and clears its entropy
 * floor, while saying NOTREAL in the middle of itself. Verified to be detected
 * by the pinned scanner (case B0 below asserts it, so a fixture that stops
 * tripping the rule fails loudly instead of making every other case vacuous).
 */
export const FAKE_GCP_KEY = `AIza${'SyNOTREAL'}${synth(20260826, 26)}`;
export const FAKE_GCP_KEY_2 = `AIza${'SyNOTREAL'}${synth(20260901, 26)}`;

/** The two values `.gitleaks.toml` exempts by name — the real literals. */
export const ALLOWED_PLACEHOLDER_KEY = 'AIzaSyE2EPlaceholderKey1234567890123';
export const ALLOWED_SLOT_KEY = '2026-08-02_safehaul-education';

/* -------------------------------------------------------------------------- */
/* Throwaway repositories                                                      */
/* -------------------------------------------------------------------------- */

export const scratch = [];

export function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'safehaul-secret-test-'));
    scratch.push(dir);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    // No background `git gc --auto` writing into `.git` after cleanup starts.
    git('config', 'gc.auto', '0');
    git('config', 'maintenance.auto', 'false');
    git('config', 'user.email', 'tests@safehaul.invalid');
    git('config', 'user.name', 'SafeHaul tests');
    git('config', 'commit.gpgsign', 'false');

    const api = {
        dir,
        git,
        /** The repository's own gitleaks config, so exemptions under test are the real ones. */
        useRepoConfig() {
            copyFileSync(REPO_CONFIG, join(dir, '.gitleaks.toml'));
            return api;
        },
        write(path, contents) {
            const full = join(dir, path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, `${contents}\n`);
            return api;
        },
        remove(path) {
            execFileSync('rm', ['-f', join(dir, path)]);
            return api;
        },
        commit(message) {
            git('add', '-A');
            git('commit', '-q', '--allow-empty', '-m', message);
            return api.head();
        },
        head: () => git('rev-parse', 'HEAD'),
        rev: (ref) => git('rev-parse', ref),
        checkoutNew(branch, from) {
            git('checkout', '-q', '-b', branch, ...(from ? [from] : []));
            return api;
        },
        checkout(branch) {
            git('checkout', '-q', branch);
            return api;
        },
        merge(branch, message) {
            git('merge', '-q', '--no-ff', '-m', message, branch);
            return api.head();
        },
        // The production plumbing, not a copy of it.
        gitOps: () => gitRunner(dir),
    };
    return api;
}

/** Run the real two-part scan exactly as CI does, and report pass/fail. */
export function scan(repo, plan, binary = getBinary()) {
    const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-test-'));
    scratch.push(work);
    const config = existsSync(join(repo.dir, '.gitleaks.toml'))
        ? join(repo.dir, '.gitleaks.toml')
        : REPO_CONFIG;
    return performScans({ binary, cwd: repo.dir, plan, config, workDir: work });
}

/**
 * The pinned scanner, fetched once for every section that needs it.
 *
 * Two sections run the real binary, and it used to be obtained inside the first
 * of them — which meant the second silently depended on the first having run.
 * Memoised here instead, and a failure to obtain it is an assertion rather than
 * a bare counter bump, so it reads like every other failure in the output.
 */
let binaryOnce;
export function getBinary() {
    if (binaryOnce === undefined) {
        try {
            binaryOnce = ensureGitleaks();
        } catch (error) {
            binaryOnce = null;
            assert('the pinned scanner could be obtained', false, error.message);
        }
    }
    return binaryOnce;
}

export const gitleaksVersion = GITLEAKS_VERSION;

/** Every throwaway directory this run created, removed by the entry point. */
export function cleanup() {
    for (const dir of scratch) removeTree(dir);
}
