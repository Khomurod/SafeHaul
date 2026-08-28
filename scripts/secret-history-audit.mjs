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
import { ensureGitleaks, GITLEAKS_VERSION, runGitleaksScan } from './secret-scan/gitleaks.mjs';

export const BASELINE_PATH = '.github/secret-history-baseline.json';

/**
 * Compare an audit against what the repository already knows about itself.
 *
 * Pure, so `scripts/secret-scan/test-pinning.mjs` can cover every verdict.
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
            added: [],
            removed: [],
        };
    }
    if (baseline.gitleaksVersion !== observed.gitleaksVersion) {
        return {
            ok: true,
            verdict: 'version-changed',
            message: `the baseline was recorded with gitleaks ${baseline.gitleaksVersion} and this `
                + `audit ran ${observed.gitleaksVersion}. Rule sets differ between versions, so the `
                + `inventory is reported rather than enforced: ${observed.findings} finding(s) now, `
                + `${baseline.findings} recorded. Re-record the baseline once the new set is reviewed.`,
            added: [],
            removed: [],
        };
    }

    /*
     * Identities, not a total.
     *
     * Comparing counts alone was wrong, and review on 2026-08-26 said why: a
     * legacy finding that disappears — a stale branch deleted, say — leaves room
     * for a NEW secret to take its place at the same total, and the audit would
     * call that `unchanged`. It matters most exactly where this audit is the only
     * scanner looking: the blocking gate runs for `main` and for pull requests
     * targeting it, so a secret parked on an unmerged branch is this workflow's
     * to catch.
     *
     * A gitleaks fingerprint is `commit:file:rule:startline` — a location, with
     * no part of the value in it — so recording the set is safe and makes the
     * baseline say WHICH findings are known rather than merely how many.
     */
    const recorded = new Set(Array.isArray(baseline.fingerprints) ? baseline.fingerprints : []);
    const seen = new Set(observed.fingerprints || []);
    if (recorded.size === 0) {
        return {
            ok: false,
            verdict: 'no-identities',
            message: `${BASELINE_PATH} records a count but no "fingerprints", so a new finding could `
                + 'replace a vanished one without changing the total. Re-record the baseline.',
            added: [...seen],
            removed: [],
        };
    }

    const added = [...seen].filter((id) => !recorded.has(id)).sort();
    const removed = [...recorded].filter((id) => !seen.has(id)).sort();

    if (added.length > 0) {
        return {
            ok: false,
            verdict: 'regressed',
            message: `${added.length} finding(s) are in history that the inventory does not know `
                + `about${removed.length ? `, and ${removed.length} recorded one(s) are gone` : ''}. `
                + 'Something was added to history — review the attached report before doing anything '
                + 'else. Values are redacted; the identities below are commit/file/rule/line only.',
            added,
            removed,
        };
    }
    if (removed.length > 0) {
        return {
            ok: true,
            verdict: 'improved',
            message: `${removed.length} recorded finding(s) are no longer in history and nothing new `
                + `appeared. If that was deliberate, update ${BASELINE_PATH} and `
                + 'docs/SECRET_HISTORY_AUDIT.md to match.',
            added,
            removed,
        };
    }
    return {
        ok: true,
        verdict: 'unchanged',
        message: `history holds exactly the ${recorded.size} recorded finding(s) — see `
            + 'docs/SECRET_HISTORY_AUDIT.md for what they are and what remains for the owner.',
        added,
        removed,
    };
}

/**
 * The identity of a finding: where it is, never what it is.
 *
 * gitleaks already computes this as `Fingerprint`; it is recomputed from the
 * parts when absent so the audit never depends on an optional field.
 */
export function fingerprintOf(finding) {
    if (finding.Fingerprint) return finding.Fingerprint;
    return `${finding.Commit || 'worktree'}:${finding.File}:${finding.RuleID}:${finding.StartLine}`;
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
    const fingerprints = scan.findings.map(fingerprintOf).sort();
    const verdict = evaluateAudit(baseline, {
        findings: scan.findings.length,
        gitleaksVersion: GITLEAKS_VERSION,
        fingerprints,
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
        ...(verdict.added?.length
            ? ['### Not in the inventory', '', ...verdict.added.map((id) => `- \`${id}\``), '']
            : []),
        ...(verdict.removed?.length
            ? ['### Recorded, no longer present', '', ...verdict.removed.map((id) => `- \`${id}\``), '']
            : []),
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
                added: verdict.added,
                removed: verdict.removed,
                fingerprints,
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
