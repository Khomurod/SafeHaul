/**
 * The pinned scanner, and the two protections it is run as.
 *
 * ## Two scans, and why one is not enough
 *
 * - **Range scan** — every commit in `base..head`, patches diffed against each
 *   parent (`-m`). Catches a secret that was committed and then deleted again
 *   inside the same change, which no scan of the final tree can see.
 * - **Tree scan** — the tracked tree at `head`, exported with `git archive` so
 *   it is exactly the committed content and not whatever else is lying around a
 *   runner. Catches a secret that is present now but does not appear as an added
 *   line in this range: a pre-existing value in a file the change merely touched,
 *   or a merge resolution.
 *
 * Either one failing fails the job. `git archive` is used rather than scanning
 * the workspace because `gitleaks dir` does **not** honour `.gitignore`: run
 * against a working copy that happens to hold `dist/` or `storybook-static/`, it
 * reports build output as a finding. Measured, again, before relying on it.
 *
 * ## The version is pinned by content, not just by name
 *
 * `gitleaks/gitleaks-action@v2` resolves its scanner by asking the GitHub API for
 * the LATEST release at run time. A security gate whose scanner version changes
 * underneath it is neither reproducible nor reviewable, and `v2` runs on Node 20,
 * which GitHub stops running after 2026-09-16. Pinning the CLI by version *and*
 * SHA-256 fixes all of it and removes the Node runtime from the picture.
 *
 * ## A failed scan never reads as a clean one
 *
 * gitleaks exits 1 both for "leaks found" and for "something went wrong", so the
 * two are told apart by whether a parseable report was produced — and both fail
 * the job. Every refusal below says which it was.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { short } from './git.mjs';

/**
 * Pinned deliberately, and pinned by content as well as by name.
 *
 * A tag can be moved; a digest cannot. Both are checked, so a compromised or
 * re-cut release fails the job instead of scanning with something nobody
 * reviewed. Bumping this means: change both values, re-run
 * `npm run audit:secret-history` (the finding count in
 * `.github/secret-history-baseline.json` is version-sensitive), and re-verify
 * the two value exemptions in `.gitleaks.toml`.
 */
export const GITLEAKS_VERSION = '8.30.1';

/** SHA-256 of `gitleaks_<version>_linux_x64.tar.gz` from the upstream release. */
export const GITLEAKS_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';

const GITLEAKS_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`
    + `/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`;

/**
 * Fetch the pinned scanner, or use the one the caller supplies.
 *
 * `GITLEAKS_BIN` lets the test suite and a developer run the real binary without
 * a download per case. The download path verifies the digest before the archive
 * is ever unpacked.
 */
export function ensureGitleaks({ cacheDir = join(tmpdir(), 'safehaul-gitleaks') } = {}) {
    const supplied = process.env.GITLEAKS_BIN;
    if (supplied) {
        if (!existsSync(supplied)) throw new Error(`GITLEAKS_BIN does not exist: ${supplied}`);
        return supplied;
    }

    const binary = join(cacheDir, `gitleaks-${GITLEAKS_VERSION}`);
    if (existsSync(binary)) return binary;

    // The pinned digest belongs to one asset: the linux x64 build CI runs. Say
    // so plainly rather than downloading something the digest cannot match, or
    // (worse) relaxing the check to make another platform work.
    if (process.platform !== 'linux' || process.arch !== 'x64') {
        throw new Error(
            `no pinned gitleaks build for ${process.platform}/${process.arch}. `
            + 'CI runs linux x64; elsewhere, install gitleaks '
            + `${GITLEAKS_VERSION} yourself and point GITLEAKS_BIN at it.`,
        );
    }

    mkdirSync(cacheDir, { recursive: true });
    const archive = join(cacheDir, `gitleaks-${GITLEAKS_VERSION}.tar.gz`);
    execFileSync('curl', ['-sSL', '--retry', '3', '--max-time', '180', '-o', archive, GITLEAKS_URL], {
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (actual !== GITLEAKS_SHA256) {
        rmSync(archive, { force: true });
        throw new Error(
            `gitleaks ${GITLEAKS_VERSION} failed its digest check.\n`
            + `  expected ${GITLEAKS_SHA256}\n  received ${actual}\n`
            + 'Refusing to run an unverified scanner.',
        );
    }

    execFileSync('tar', ['xzf', archive, '-C', cacheDir, 'gitleaks'], { stdio: 'inherit' });
    renameSync(join(cacheDir, 'gitleaks'), binary);
    chmodSync(binary, 0o755);
    return binary;
}

/**
 * One gitleaks invocation, reported as data.
 *
 * `--redact` is not optional: findings are printed in CI logs, attached as
 * artifacts and quoted in summaries, and none of those may carry a value.
 *
 * gitleaks exits 1 both for "leaks found" and for "something went wrong", so the
 * two are told apart by whether a parseable report was produced — and both fail
 * the job. A scanner that errored has proven nothing, which must never read as
 * "clean".
 */
export function runGitleaksScan({ binary, mode, target, logOpts, config, reportPath }) {
    const args = mode === 'git'
        ? ['git', '--log-opts', logOpts, target]
        : ['dir', target];
    args.push(
        '--redact', '--no-banner', '--no-color',
        /*
         * `gitleaks:allow` in a source comment silences a finding, and gitleaks
         * honours it by DEFAULT. Measured on 8.30.1: the same synthetic key is
         * reported in a plain file and not reported in one carrying that comment,
         * in both the commit-range and the tree scan; with this flag both are
         * reported. Anyone able to write a line of code could otherwise exempt
         * their own credential without touching a config file, which is not a
         * decision this gate leaves to the change under test. SafeHaul's
         * exemptions live in `.gitleaks.toml`, where `check:ci-plan` pins them.
         */
        '--ignore-gitleaks-allow',
        '--report-format', 'json', '--report-path', reportPath,
    );
    if (config) args.push('--config', config);

    const result = spawnSync(binary, args, { encoding: 'utf8' });
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    let findings = null;
    if (existsSync(reportPath)) {
        try {
            const parsed = JSON.parse(readFileSync(reportPath, 'utf8') || '[]');
            if (Array.isArray(parsed)) findings = parsed;
        } catch {
            findings = null;
        }
    }

    if (findings === null) {
        return {
            ok: false,
            errored: true,
            findings: [],
            output,
            detail: `gitleaks (${mode}) produced no readable report; exit=${result.status}`,
        };
    }
    /*
     * A readable report is not by itself proof that the scan finished.
     *
     * Review on 2026-08-26 (P1): a nonzero exit that still left a parseable
     * EMPTY report set `ok` false and `errored` false, and `performScans` only
     * looked at `errored` and the finding count — so it recorded no problem and
     * the release gate reported success over a scan that had failed. Nonzero
     * with nothing to show for it is an incomplete scan, and it is reported as
     * one. (I could not make gitleaks 8.30.1 do this: every failure mode probed
     * either exits 0 or writes no report at all. That is not a reason to leave
     * the branch open — the guarantee is "a scanner failure never reads as
     * success", and it should not rest on one version's exit-code habits.)
     */
    if (result.status !== 0 && findings.length === 0) {
        return {
            ok: false,
            errored: true,
            findings,
            output,
            detail: `gitleaks (${mode}) exited ${result.status} with no findings — an incomplete `
                + 'scan, not a clean one',
        };
    }
    return {
        ok: result.status === 0 && findings.length === 0,
        errored: false,
        findings,
        output,
        detail: `${findings.length} finding(s)`,
    };
}

/**
 * Both protections, in one place, so `scripts/secret-scan/test-detection.mjs` exercises
 * the code the gate actually runs rather than a reimplementation of it.
 *
 * @returns {{ok: boolean, range: object, tree: object, problems: string[]}}
 */
export function performScans({ binary, cwd, plan: scanPlan, config, workDir }) {
    /*
     * `.gitleaksignore` lists fingerprints to suppress, and gitleaks reads it
     * from the scan root by default (`--gitleaks-ignore-path .`). Measured on
     * 8.30.1: adding a finding's fingerprint to it removes that finding, and
     * pointing the flag at a directory without one does NOT restore it — so the
     * file cannot be neutralised from the command line. It is refused instead.
     * There is no such file in this repository, and its only purpose would be to
     * hide what this job exists to report.
     */
    const strayIgnores = [['the checkout', cwd]]
        .filter(([, dir]) => existsSync(join(dir, '.gitleaksignore')));
    if (strayIgnores.length > 0) {
        return {
            ok: false,
            range: { ok: false, errored: true, findings: [], output: '', detail: 'not run' },
            tree: { ok: false, errored: true, findings: [], output: '', detail: 'not run' },
            problems: strayIgnores.map(([where]) => `a .gitleaksignore is present in ${where}; `
                + 'it suppresses findings by fingerprint and this gate will not scan around one'),
        };
    }

    const range = runGitleaksScan({
        binary,
        mode: 'git',
        target: cwd,
        logOpts: scanPlan.logOpts,
        config,
        reportPath: join(workDir, 'range.json'),
    });

    // The tracked tree at `head`, exported rather than read off the workspace:
    // `gitleaks dir` does not honour `.gitignore`, so scanning a working copy
    // makes `dist/` and `storybook-static/` into findings.
    const treeDir = join(workDir, 'tree');
    mkdirSync(treeDir, { recursive: true });
    // Written to a file and extracted separately rather than piped through a
    // shell: no quoting to get wrong, and a failure in either half is visible
    // instead of being swallowed by the pipe's exit status.
    const tarball = join(workDir, 'tree.tar');
    const archived = spawnSync(
        'git',
        ['archive', '--format=tar', `--output=${tarball}`, scanPlan.head],
        { cwd, encoding: 'utf8' },
    );
    if (archived.status === 0) {
        const extracted = spawnSync('tar', ['-xf', tarball, '-C', treeDir], { encoding: 'utf8' });
        if (extracted.status !== 0) {
            return {
                ok: false,
                range,
                tree: {
                    ok: false, errored: true, findings: [], output: extracted.stderr || '', detail: 'tar extract failed',
                },
                problems: [`could not unpack the tree at ${short(scanPlan.head)}: ${extracted.stderr || 'unknown error'}`],
            };
        }
    }
    if (archived.status !== 0) {
        return {
            ok: false,
            range,
            tree: { ok: false, errored: true, findings: [], output: archived.stderr || '', detail: 'git archive failed' },
            problems: [`could not export the tree at ${short(scanPlan.head)}: ${archived.stderr || 'unknown error'}`],
        };
    }
    if (existsSync(join(treeDir, '.gitleaksignore'))) {
        return {
            ok: false,
            range,
            tree: { ok: false, errored: true, findings: [], output: '', detail: 'not run' },
            problems: [`a .gitleaksignore is tracked at ${short(scanPlan.head)}; it suppresses `
                + 'findings by fingerprint and this gate will not scan around one'],
        };
    }
    const tree = runGitleaksScan({
        binary,
        mode: 'dir',
        target: treeDir,
        config,
        reportPath: join(workDir, 'tree.json'),
    });
    // The tree was exported to a temp directory; report the paths a reader can
    // actually open, not the scratch location they were scanned in.
    for (const finding of tree.findings) {
        if (typeof finding.File === 'string' && finding.File.startsWith(treeDir)) {
            finding.File = finding.File.slice(treeDir.length).replace(/^[/\\]/, '');
        }
    }

    const problems = [];
    for (const [label, scan] of [['commit range', range], ['source tree', tree]]) {
        if (scan.errored) problems.push(`the ${label} scan did not complete: ${scan.detail}`);
        else if (scan.findings.length > 0) problems.push(`${scan.findings.length} finding(s) in the ${label}`);
        // Belt and braces for the same P1: whatever produced `ok === false`,
        // this refuses. Nothing may reach the deploy on a scan that did not
        // say, unambiguously, that it found nothing.
        else if (!scan.ok) problems.push(`the ${label} scan did not report success: ${scan.detail}`);
    }
    return { ok: problems.length === 0, range, tree, problems };
}

/** Findings, described without ever quoting what was found. */
export function describeFindings(findings) {
    return findings.map((f) => {
        const where = f.Commit ? `${short(f.Commit)}:${f.File}` : f.File;
        return `  ${f.RuleID} — ${where}:${f.StartLine}`;
    });
}
