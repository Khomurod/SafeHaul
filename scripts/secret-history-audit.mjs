#!/usr/bin/env node
/**
 * The full-history secret audit — deliberately NOT a release gate.
 *
 * Two different questions were being asked by one job, and answering both with
 * one verdict is what broke CI:
 *
 *   1. *Does this change introduce a secret?* — a blocking question, answered per
 *      event by `scripts/secret-scan.mjs`, which fails the release.
 *   2. *What is in the repository's history?* — a standing security question with
 *      a fixed, known, already-inventoried answer. Answering it inside the
 *      release gate meant every unrelated release failed on the same eight
 *      values from 2025-12..2026-03 until someone rewrote history.
 *
 * This script answers the second one, on a schedule and on demand, and reports.
 * It is not in `release-validation`'s `needs`, so it cannot block a deploy — and
 * it is not silent either: it fails when the history gets WORSE than the recorded
 * baseline, which is the only signal that actually needs a human.
 *
 * Values are never printed. `--redact` is passed to gitleaks, and this script
 * only ever emits rule, path, line, commit and date.
 *
 * See `docs/SECRET_HISTORY_AUDIT.md` for the classification of the recorded
 * findings and the rotation actions that belong to the owner.
 */

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitleaks, GITLEAKS_VERSION, runGitleaksScan } from './secret-scan.mjs';

export const BASELINE_PATH = '.github/secret-history-baseline.json';

/**
 * Compare an audit against what the repository already knows about itself.
 *
 * Pure, so `scripts/test-secret-scan.mjs` can cover every verdict.
 *
 * The count is only meaningful for the gitleaks version it was recorded with:
 * a version bump changes the default rules, so a mismatch there reports rather
 * than fails. Anything else would make a scanner upgrade look like a breach.
 *
 * @param {{findings: number, gitleaksVersion: string}} baseline
 * @param {{findings: number, gitleaksVersion: string}} observed
 * @returns {{ok: boolean, verdict: string, message: string}}
 */
export function evaluateAudit(baseline, observed) {
    if (!baseline || typeof baseline.findings !== 'number') {
        return {
            ok: false,
            verdict: 'no-baseline',
            message: `${BASELINE_PATH} is missing or has no numeric "findings", so this audit has `
                + 'nothing to compare against. Record the current inventory before relying on it.',
        };
    }
    if (baseline.gitleaksVersion !== observed.gitleaksVersion) {
        return {
            ok: true,
            verdict: 'version-changed',
            message: `the baseline was recorded with gitleaks ${baseline.gitleaksVersion} and this `
                + `audit ran ${observed.gitleaksVersion}. Rule sets differ between versions, so the `
                + `count is reported rather than enforced: ${observed.findings} finding(s) now, `
                + `${baseline.findings} recorded. Re-record the baseline once the new count is reviewed.`,
        };
    }
    if (observed.findings > baseline.findings) {
        return {
            ok: false,
            verdict: 'regressed',
            message: `history now holds ${observed.findings} finding(s) where ${baseline.findings} were `
                + 'recorded. Something was added to history that is not in the inventory — review the '
                + 'attached report before doing anything else.',
        };
    }
    if (observed.findings < baseline.findings) {
        return {
            ok: true,
            verdict: 'improved',
            message: `history now holds ${observed.findings} finding(s), fewer than the ${baseline.findings} `
                + `recorded. If history was cleaned deliberately, update ${BASELINE_PATH} and `
                + 'docs/SECRET_HISTORY_AUDIT.md to match.',
        };
    }
    return {
        ok: true,
        verdict: 'unchanged',
        message: `history holds the ${observed.findings} recorded finding(s) — see `
            + 'docs/SECRET_HISTORY_AUDIT.md for what they are and what remains for the owner.',
    };
}

/** Counts by rule and by file, with no values anywhere. */
export function summarise(findings) {
    const byRule = new Map();
    const byFile = new Map();
    for (const f of findings) {
        byRule.set(f.RuleID, (byRule.get(f.RuleID) || 0) + 1);
        byFile.set(f.File, (byFile.get(f.File) || 0) + 1);
    }
    const sort = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { byRule: sort(byRule), byFile: sort(byFile) };
}

async function main() {
    const cwd = process.cwd();
    const binary = ensureGitleaks();
    const work = mkdtempSync(join(tmpdir(), 'safehaul-history-audit-'));
    const config = existsSync(join(cwd, '.gitleaks.toml')) ? join(cwd, '.gitleaks.toml') : undefined;

    // `--all` so stale branches are inventoried too: a secret parked on a branch
    // nobody merged is still in the repository.
    const scan = runGitleaksScan({
        binary,
        mode: 'git',
        target: cwd,
        logOpts: '--all',
        config,
        reportPath: join(work, 'history.json'),
    });

    if (scan.errored) {
        console.error(scan.output);
        console.error(`\nhistory audit FAILED to run: ${scan.detail}`);
        process.exit(1);
    }

    const baseline = existsSync(BASELINE_PATH)
        ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
        : null;
    const verdict = evaluateAudit(baseline, {
        findings: scan.findings.length,
        gitleaksVersion: GITLEAKS_VERSION,
    });
    const { byRule, byFile } = summarise(scan.findings);

    const lines = [
        '## Secret history audit',
        '',
        `- scanner: gitleaks \`${GITLEAKS_VERSION}\` (pinned by version and digest)`,
        '- scope: **all** commits on **all** refs — this is the deliberate full-history sweep,',
        '  and it gates nothing.',
        `- findings: **${scan.findings.length}** (recorded baseline: ${baseline?.findings ?? 'none'})`,
        `- verdict: \`${verdict.verdict}\``,
        '',
        verdict.message,
        '',
        '### By rule',
        '',
        '| rule | findings |',
        '| --- | --- |',
        ...byRule.map(([rule, n]) => `| \`${rule}\` | ${n} |`),
        '',
        '### By file',
        '',
        '| file | findings |',
        '| --- | --- |',
        ...byFile.map(([file, n]) => `| \`${file}\` | ${n} |`),
        '',
        'Values are redacted. Classification, severity and the owner actions that remain live in',
        '`docs/SECRET_HISTORY_AUDIT.md`.',
    ];
    const report = lines.join('\n');
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

    if (process.env.SECRET_HISTORY_REPORT_DIR) {
        mkdirSync(process.env.SECRET_HISTORY_REPORT_DIR, { recursive: true });
        writeFileSync(
            join(process.env.SECRET_HISTORY_REPORT_DIR, 'secret-history-audit.json'),
            `${JSON.stringify({
                gitleaksVersion: GITLEAKS_VERSION,
                findings: scan.findings.length,
                verdict: verdict.verdict,
                byRule,
                byFile,
                // Redacted: rule, path, line, commit, date. Never a value.
                items: scan.findings.map((f) => ({
                    rule: f.RuleID,
                    file: f.File,
                    line: f.StartLine,
                    commit: f.Commit || null,
                    date: f.Date || null,
                })),
            }, null, 2)}\n`,
        );
    }

    if (!verdict.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error?.stack || String(error));
        process.exit(1);
    });
}
