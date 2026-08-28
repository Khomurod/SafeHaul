#!/usr/bin/env node
/**
 * The blocking secret scanner: what THIS change introduced, and what the tree
 * holds right now.
 *
 * This file is the CI entry point and nothing else. It reads the event, asks
 * GitHub the one question that needs asking, resolves a range, runs both scans,
 * and writes the report. The parts worth arguing about live next to their own
 * arguments:
 *
 * - `secret-scan/range.mjs` — what this change is compared against, and why the
 *   third-party action's answer was wrong on three counts;
 * - `secret-scan/validated.mjs` — "was that commit's release fully validated?",
 *   which is what a baseline has to be;
 * - `secret-scan/gitleaks.mjs` — the pinned scanner, the two protections, and
 *   why a failed scan never reads as a clean one;
 * - `secret-scan/git.mjs` — the git questions, injectable so the tests drive the
 *   real plumbing.
 *
 * Tests: `npm run test:secret-scan`. Every path that cannot determine a
 * trustworthy base exits non-zero with the reason; there is no fallback that
 * widens the scan. Legacy history is inventoried separately by
 * `.github/workflows/secret-history-audit.yml`.
 */

import { existsSync, appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRunner, run, short } from './secret-scan/git.mjs';
import {
    GITLEAKS_VERSION, describeFindings, ensureGitleaks, performScans,
} from './secret-scan/gitleaks.mjs';
import { REVERIFICATION_EVENTS, resolveScanPlan } from './secret-scan/range.mjs';
import { findLastValidatedAncestor, isValidatedRelease } from './secret-scan/validated.mjs';

async function main() {
    const cwd = process.cwd();
    const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let payload = {};
    if (eventPath && existsSync(eventPath)) {
        try {
            payload = JSON.parse(readFileSync(eventPath, 'utf8'));
        } catch (error) {
            fail(`GITHUB_EVENT_PATH could not be parsed: ${error.message}`);
        }
    }

    const git = gitRunner(cwd);
    const headSha = process.env.GITHUB_SHA && git.exists(process.env.GITHUB_SHA)
        ? process.env.GITHUB_SHA
        : git.resolve('HEAD');
    /*
     * Everything GitHub has to be asked is asked here, before the (synchronous)
     * plan is resolved: whether a named override carries a validated release, or
     * failing that, which ancestor does.
     */
    const repository = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN;
    const override = (process.env.SECRET_SCAN_BASE || '').trim();
    let validatedBase;
    let overrideValidated = false;
    let lookupError = null;

    if (override) {
        // Resolved here too, so the question is asked about the commit the plan
        // will actually use rather than about whatever form was typed.
        const resolved = git.resolve(override) || override;
        const check = await isValidatedRelease({ sha: resolved, repository, token });
        overrideValidated = check.validated;
        lookupError = check.error;
        console.log(`override   : ${short(resolved)} — ${overrideValidated ? 'validated release' : 'NOT a validated release'}`
            + `${check.error ? ` (${check.error})` : ''}`);
    } else if (REVERIFICATION_EVENTS.includes(eventName) || eventName === 'push') {
        // Every event except a pull request compares against a validated commit.
        // A pull request has its merge base, which is what the change proposes
        // and needs nothing from GitHub.
        const lookup = await findLastValidatedAncestor({
            headSha, cwd, repository, token,
        });
        validatedBase = lookup.sha;
        lookupError = lookup.error;
        console.log(`validated  : ${validatedBase ? short(validatedBase) : 'none found'}`
            + ` (asked about ${lookup.checked} ancestor(s)${lookup.error ? `; ${lookup.error}` : ''})`);
    }

    let scanPlan;
    try {
        scanPlan = resolveScanPlan({
            eventName,
            payload,
            headSha,
            baseOverride: override,
            lastValidatedBase: () => validatedBase || null,
            isValidatedRelease: () => overrideValidated,
            git,
        });
    } catch (error) {
        fail(
            `${error.message}\n\n`
            + (lookupError
                ? `The baseline lookup could not complete: ${lookupError}. That is why nothing came `
                  + 'back validated — it is not evidence that nothing is.\n\n'
                : '')
            + 'This job fails closed on purpose. It will not widen to a full-history scan, '
            + 'which is what reported known 2025-2026 legacy findings against unrelated releases. '
            + 'See docs/SECRET_HISTORY_AUDIT.md.',
        );
        return;
    }

    console.log(`event      : ${eventName}`);
    console.log(`head       : ${scanPlan.head}`);
    console.log(`base       : ${scanPlan.base}`);
    console.log(`range      : ${scanPlan.describe}`);
    console.log(`log-opts   : ${scanPlan.logOpts}`);
    console.log(`gitleaks   : ${GITLEAKS_VERSION} (pinned, digest-verified)`);

    const commitCount = run(
        'git', ['rev-list', '--count', `${scanPlan.base}..${scanPlan.head}`], cwd,
    ).stdout.trim();
    console.log(`commits    : ${commitCount}`);

    const binary = ensureGitleaks();
    const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-'));
    const config = existsSync(join(cwd, '.gitleaks.toml')) ? join(cwd, '.gitleaks.toml') : undefined;

    const { range, tree, problems } = performScans({
        binary, cwd, plan: scanPlan, config, workDir: work,
    });

    for (const [label, scan] of [['commit range', range], ['source tree', tree]]) {
        if (scan.errored) {
            console.error(scan.output);
            continue;
        }
        if (scan.findings.length > 0) {
            console.error(`\n${scan.findings.length} finding(s) in the ${label}:`);
            console.error(describeFindings(scan.findings).join('\n'));
        }
    }

    const summary = [
        '## Secret scan',
        '',
        `- event: \`${eventName}\``,
        `- range: \`${scanPlan.describe}\` — ${commitCount} commit(s)`,
        `- scanner: gitleaks \`${GITLEAKS_VERSION}\` (pinned by version and digest)`,
        `- commit-range findings: ${range.errored ? 'scan failed' : range.findings.length}`,
        `- source-tree findings: ${tree.errored ? 'scan failed' : tree.findings.length}`,
        '',
        problems.length === 0
            ? 'No secret was introduced by this change, and none is present in the tracked tree.'
            : `**Refused.** ${problems.join('; ')}. Values are redacted everywhere; see the job log for rule, file and line.`,
        '',
        'Legacy findings in old history are inventoried separately by the'
        + ' `secret-history-audit` workflow and classified in `docs/SECRET_HISTORY_AUDIT.md`.',
    ].join('\n');
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    if (process.env.SECRET_SCAN_REPORT_DIR) {
        mkdirSync(process.env.SECRET_SCAN_REPORT_DIR, { recursive: true });
        writeFileSync(
            join(process.env.SECRET_SCAN_REPORT_DIR, 'secret-scan-report.json'),
            `${JSON.stringify({
                event: eventName,
                base: scanPlan.base,
                head: scanPlan.head,
                source: scanPlan.source,
                logOpts: scanPlan.logOpts,
                gitleaks: GITLEAKS_VERSION,
                commits: Number(commitCount),
                // Redacted findings only: rule, path, line. Never a value.
                rangeFindings: range.findings.map(redactFinding),
                treeFindings: tree.findings.map(redactFinding),
            }, null, 2)}\n`,
        );
    }

    rmSync(work, { recursive: true, force: true });

    if (problems.length > 0) {
        console.error(`\nsecret-scan REFUSED: ${problems.join('; ')}`);
        process.exit(1);
    }
    console.log('\nsecret-scan OK: nothing introduced by this change, nothing in the tree.');
}

const redactFinding = (f) => ({
    rule: f.RuleID,
    file: f.File,
    line: f.StartLine,
    commit: f.Commit || null,
    date: f.Date || null,
});

function fail(message) {
    console.error(`secret-scan REFUSED\n\n${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Secret scan\n\n**Refused.**\n\n\`\`\`\n${message}\n\`\`\`\n`,
        );
    }
    process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => fail(error?.stack || String(error)));
}
