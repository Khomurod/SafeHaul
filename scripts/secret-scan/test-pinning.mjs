/**
 * The pinned scanner, and the separate history audit.
 *
 * Two subjects that are really one: this gate scans what a change introduces,
 * and the audit inventories everything that was ever committed. Keeping them
 * apart is what stops eight known 2025-2026 legacy values failing every
 * unrelated release — and the audit is therefore asserted to gate nothing, while
 * the scanner is asserted to be pinned by an exact version rather than resolved
 * at run time.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { assert, repoRoot } from './test-support.mjs';
import { GITLEAKS_SHA256, GITLEAKS_VERSION } from './gitleaks.mjs';
import { implementationFiles, implementationSource } from './sources.mjs';
import { evaluateAudit, fingerprintOf } from '../secret-history-audit.mjs';

/* ========================================================================== */
console.log('\nD. The pinned scanner, and the separate history audit');
/* ========================================================================== */

assert('D1 (req 14). the gitleaks version is pinned to an exact release',
    /^\d+\.\d+\.\d+$/.test(GITLEAKS_VERSION) && !/latest/i.test(GITLEAKS_VERSION),
    `version is ${GITLEAKS_VERSION} — a security gate must not track "latest"`);
assert('D2 (req 14). and pinned by content as well as by tag',
    /^[0-9a-f]{64}$/.test(GITLEAKS_SHA256),
    'a tag can be moved; the digest is what makes the scanner reproducible');

const FP = (n) => `${'a'.repeat(39)}${n}:legacy/.env:gcp-api-key:1`;
const legacy = { findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2)] };

assert('D3 (req 10). the audit refuses to enforce without a recorded baseline',
    evaluateAudit(null, { findings: 3, gitleaksVersion: GITLEAKS_VERSION, fingerprints: [] }).ok === false,
    'no baseline means nothing to compare against, which is not the same as "clean"');
assert('D4 (req 10). a baseline with a count but no identities is refused',
    evaluateAudit(
        { findings: 2, gitleaksVersion: '8.30.1' },
        { findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2)] },
    ).verdict === 'no-identities',
    'counting alone cannot tell a replaced finding from an unchanged one');
assert('D5. an unchanged history passes and says so',
    evaluateAudit(legacy, { ...legacy }).verdict === 'unchanged',
    'the known legacy findings are recorded, not re-litigated on every run');
assert('D6 (req 10). a NEW finding fails the audit',
    evaluateAudit(legacy, {
        findings: 3, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(2), FP(3)],
    }).verdict === 'regressed',
    'something entered history that the inventory does not know about');

/*
 * The case counting missed, found in review on 2026-08-26 (P2).
 *
 * One legacy finding disappears — a stale branch deleted — and a new secret
 * appears on another unmerged branch. The total is identical, and a count
 * comparison calls that `unchanged`. It matters because the blocking gate only
 * runs for `main` and pull requests targeting it, so an unmerged branch is this
 * audit's to catch.
 */
{
    const swapped = evaluateAudit(legacy, {
        findings: 2, gitleaksVersion: '8.30.1', fingerprints: [FP(1), FP(9)],
    });
    assert('D7 (req 10). a new finding that REPLACES a vanished one still fails',
        swapped.ok === false && swapped.verdict === 'regressed',
        `verdict was ${swapped.verdict} — the totals match, so only identities can see this`);
    assert('D8. and it names what appeared and what went, by location only',
        swapped.added.length === 1 && swapped.added[0] === FP(9)
        && swapped.removed.length === 1 && swapped.removed[0] === FP(2),
        JSON.stringify({ added: swapped.added, removed: swapped.removed }));
}

assert('D9. a cleaned history passes, and asks for the baseline to be updated',
    evaluateAudit(legacy, { findings: 1, gitleaksVersion: '8.30.1', fingerprints: [FP(1)] }).verdict === 'improved',
    'fewer findings must not read as a failure');
assert('D10. a scanner upgrade reports instead of failing',
    evaluateAudit(
        { ...legacy, gitleaksVersion: '8.24.3' },
        { findings: 90, gitleaksVersion: '8.30.1', fingerprints: [FP(5)] },
    ).verdict === 'version-changed',
    'rule sets differ between versions; a bump is not a breach');

assert('D11. a fingerprint is a location, and carries no part of a value',
    fingerprintOf({ Commit: 'abc', File: 'x/.env', RuleID: 'gcp-api-key', StartLine: 3, Secret: 'AIzaTOPSECRET' })
        === 'abc:x/.env:gcp-api-key:3',
    'the baseline records these, so they must never be able to leak the finding');

/*
 * The recorded inventory is what the audit enforces against, so its shape is
 * asserted here rather than trusted.
 */
{
    const recorded = JSON.parse(readFileSync(resolvePath(repoRoot, '.github/secret-history-baseline.json'), 'utf8'));
    assert('D12. the recorded baseline lists an identity for every finding it counts',
        Array.isArray(recorded.fingerprints) && recorded.fingerprints.length === recorded.findings,
        `${recorded.fingerprints?.length} identities for ${recorded.findings} findings`);
    assert('D13. and no recorded identity contains anything that looks like a secret',
        recorded.fingerprints.every((id) => /^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/.test(id)),
        'a fingerprint is commit:file:rule:line and nothing else');
}

/* ========================================================================== */
console.log('\nL. The scanner is ours, pinned by content, and cannot be exempted');
/* ========================================================================== */

/*
 * Moved here from `scripts/test-ci-plan.mjs` §L on 2026-08-27, when the scanner
 * stopped being one file.
 *
 * These are regexes over the scanner's own source, and they lived in the CI-plan
 * suite only because that is where the run #159 post-mortem was written. Reading
 * a directory's worth of implementation from there would have meant either a
 * stale path or a second copy of the closure logic, and the assertions belong
 * beside the thing they describe regardless.
 *
 * The L numbers are kept deliberately. `AGENTS.md` cites L24a, L25 and L26 by
 * name, and the commit that measured each of these refers to them; renaming them
 * to fit this file's D-series would break that trail for nothing. What each one
 * asserts is unchanged — only the source it reads is wider, because
 * `implementationSource()` follows the entry's imports rather than trusting one
 * path.
 *
 * The wiring half of §L stays in `test-ci-plan.mjs`: that the job exists, runs
 * this repository's scanner, cannot be conditioned away, is in
 * ALWAYS_REQUIRED_JOBS, fails the release when it fails or is skipped, and that
 * the full-history audit can never gate a deploy.
 */
{
    const workflow = readFileSync(resolvePath(repoRoot, '.github/workflows/main.yml'), 'utf8');
    const secretScanJob = workflow.slice(
        workflow.indexOf('  secret-scan:'),
        workflow.indexOf('  callable-contract:'),
    );
    const scanner = implementationSource();
    assert('L8. the gitleaks version is pinned to an exact release, not "latest"',
        /GITLEAKS_VERSION\s*=\s*'\d+\.\d+\.\d+'/.test(scanner)
        // Asserted on the download URL, not on the prose: the docblock explains
        // that the action resolved "latest", and that explanation must be allowed
        // to say so.
        && /releases\/download\/v\$\{GITLEAKS_VERSION\}/.test(scanner)
        && !/releases\/latest/.test(scanner),
        'the action resolved "latest" at run time, so the gate\'s scanner changed underneath it');
    assert('L9. and pinned by digest as well as by tag',
        /GITLEAKS_SHA256\s*=\s*'[0-9a-f]{64}'/.test(scanner),
        'a tag can be moved; the digest is what makes a security gate reproducible');
    assert('L10. the scanner scans both the commit range and the resulting tree',
        /mode:\s*'git'/.test(scanner) && /mode:\s*'dir'/.test(scanner),
        'the range catches add-then-delete; the tree catches what is present now');
    /*
     * The manual/force-push baseline is "the newest ancestor whose own
     * secret-scan passed", which the scanner asks GitHub for by check NAME. A
     * rename would mean "nothing was ever validated" — a refusal, so it fails
     * closed, but for a reason nobody would guess from the message.
     */
    assert('L17. the scanner asks about the same check name the workflow declares',
        /^ {2}secret-scan:$/m.test(workflow)
        && /SECRET_SCAN_CHECK_NAME = 'secret-scan'/.test(scanner),
        'the job name in main.yml and SECRET_SCAN_CHECK_NAME must be the same string');
    assert('L18. and the job can read checks in order to ask',
        /checks:\s*read/.test(secretScanJob),
        'without checks:read the lookup returns nothing and every manual run refuses');
    assert('L19. an unusable baseline is never widened to a full scan',
        !/--all/.test(scanner),
        'the full sweep belongs to the audit workflow; this one refuses instead');
    /*
     * A push's own `before` is the tip of the PREVIOUS push, whose scan may have
     * failed — trusting it puts that failed increment behind the range, and a
     * credential added and deleted inside it then passes and deploys (reproduced,
     * 2026-08-26). Every event but a pull request anchors at a validated commit.
     */
    assert('L20. a push never anchors at its own `before`',
        !/'push-before'/.test(scanner),
        'that baseline is only as trustworthy as a scan that may have failed');
    /*
     * A baseline also needs the run's own `release-validation` to have passed,
     * because that is what proves `callable-contract` — the scanner's own tests —
     * passed with it. A commit that BREAKS the scanner is exactly the commit
     * whose `secret-scan` goes green while those tests do not.
     */
    assert('L21. a baseline needs a validated release, not just a green scan',
        /RELEASE_VALIDATION_CHECK_NAME = 'Verify the release is fully validated'/.test(scanner)
        && /name: Verify the release is fully validated/.test(workflow),
        'the constant and the release-validation job name in main.yml must be the same string');

    /*
     * The escape hatch is not a bypass: the refusal messages tell an operator to
     * set SECRET_SCAN_BASE, so the obvious wrong move is to paste in the tip that
     * just failed — the one commit whose broken scanner reported success. An
     * override has to carry a validated release like any inferred base.
     */
    assert('L24. SECRET_SCAN_BASE is checked as hard as an inferred base',
        /does not carry a fully validated release/.test(scanner)
        && /isValidatedRelease/.test(scanner),
        'an override names a release known to be good; it does not invent one');

    const gitleaksConfig = readFileSync(resolvePath(repoRoot, '.gitleaks.toml'), 'utf8');
    assert('L15. the default rule set is still extended, not replaced',
        /useDefault\s*=\s*true/.test(gitleaksConfig),
        'switching rules off is the widest exemption there is');
    assert('L16. no path is exempted from scanning',
        !/^\s*paths\s*=/m.test(gitleaksConfig),
        'a path exemption would ignore a real credential pasted into that file; '
        + 'the two `.env.example` entries were measured to be unnecessary and deleted');

    /*
     * L16 stops the widest exemption; this stops the same move made with a
     * regex instead of a path. `regexes` is unbounded — one entry of `.*` would
     * make both scans pass over anything — so the exemptions are pinned by
     * value. Adding one is then a visible, reviewable edit to this list rather
     * than a line in a config nobody re-reads, which is the whole point.
     *
     * Both entries are documented in `.gitleaks.toml` with what they are, why
     * they cannot be a credential, and how that was verified.
     */
    const EXPECTED_VALUE_EXEMPTIONS = [
        String.raw`AIzaSyE2EPlaceholderKey1234567890123`,
        String.raw`^\d{4}-\d{2}-\d{2}_[a-z][a-z0-9-]*$`,
    ];
    const declared = [...gitleaksConfig.matchAll(/^\s*'''(.*)'''\s*,?\s*$/gm)].map((m) => m[1]);
    assert('L22. the value exemptions are exactly the two that were reviewed',
        declared.length === EXPECTED_VALUE_EXEMPTIONS.length
        && declared.every((value, index) => value === EXPECTED_VALUE_EXEMPTIONS[index]),
        `found ${JSON.stringify(declared)} — a new exemption has to be added here too, `
        + 'with the measurement that justifies it');
    assert('L23. and none of them can match an arbitrary value',
        declared.every((value) => !/^\^?\.[*+]\$?$/.test(value) && value.length > 8),
        'a catch-all regex in the allowlist is a rule exemption wearing a value exemption\'s clothes');

    /*
     * L22 pins the VALUES; this pins the whole file, because neither listing
     * forbidden keys nor pattern-matching the allowed ones survives contact with
     * TOML. Measured against gitleaks 8.30.1, every one of these reaches the
     * scanner and hides the same synthetic key:
     *
     *   [extend] disabledRules = [...]                 range 0, tree 0
     *   [allowlist] stopwords  = [...]                 range 0, tree 0
     *   [[allowlists]] (the plural form)               range 0, tree 0
     *   [allowlist] paths      = [...]                 range 0, tree 0
     *   [allowlist] commits    = [...]                 range 0 (tree still saw it)
     *   "disabledRules" = [...]   (a quoted key)       range 0
     *   'disabledRules' = [...]   (single-quoted)      range 0
     *   extend = { disabledRules = [...] }  (inline)   range 0
     *
     * A key whitelist matched on bare identifiers missed the last three, which is
     * exactly the sort of near-miss this file must not have. So the config's
     * non-comment content is pinned line for line: any edit at all — a new key in
     * any syntax, a new table, a reopened string — fails here until this list is
     * updated with the measurement that justifies it. Comments stay free, because
     * gitleaks ignores them and the reasoning belongs next to the values.
     */
    const CONFIG_CONTENT = [
        'title = "SafeHaul"',
        '[extend]',
        'useDefault = true',
        '[allowlist]',
        'description = "Two value exemptions. No path is exempt, and no rule is switched off."',
        'regexes = [',
        String.raw`  '''AIzaSyE2EPlaceholderKey1234567890123''',`,
        String.raw`  '''^\d{4}-\d{2}-\d{2}_[a-z][a-z0-9-]*$''',`,
        ']',
    ];
    const configContent = gitleaksConfig
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    assert('L24a. the scanner config is exactly the file that was reviewed',
        JSON.stringify(configContent) === JSON.stringify(CONFIG_CONTENT),
        `the non-comment content differs:\n  expected ${JSON.stringify(CONFIG_CONTENT)}\n  `
        + `found    ${JSON.stringify(configContent)}`);

    /*
     * Two exemptions that need no config change at all, both measured:
     * `gitleaks:allow` in a source comment is honoured by DEFAULT, and a
     * `.gitleaksignore` suppresses findings by fingerprint and cannot be
     * neutralised by pointing `--gitleaks-ignore-path` elsewhere.
     */
    assert('L25. a `gitleaks:allow` comment cannot silence a finding',
        /--ignore-gitleaks-allow/.test(scanner),
        'without that flag, any change could exempt its own credential with one comment');
    assert('L26. and no .gitleaksignore is tracked, nor scanned around',
        !existsSync(resolvePath(repoRoot, '.gitleaksignore'))
        && /\.gitleaksignore/.test(scanner),
        'the scanner refuses when one is present; there must also not be one here');

    /*
     * The assertions above are only as wide as what they read, and what they read
     * is now derived rather than written down. Both directions are checked here,
     * because a closure that had silently collapsed to the entry would make
     * "`--all` never appears" true by reading almost nothing — the exact shape of
     * failure the guard exists to prevent.
     *
     * In practice a collapse also fails L9, L10 and L25 outright, since the
     * digest, the two scan modes and `--ignore-gitleaks-allow` all live in
     * modules rather than in the entry. These two say so directly, so the reason
     * is in the output instead of being inferred from three unrelated failures.
     */
    const files = implementationFiles().map((file) => file.replace(/^.*\/scripts\//, ''));
    assert('L27. the source these checks read is the whole scanner, not just its entry',
        ['secret-scan.mjs', 'secret-scan/git.mjs', 'secret-scan/gitleaks.mjs',
            'secret-scan/range.mjs', 'secret-scan/validated.mjs'].every((f) => files.includes(f)),
        files.join(', '));
    assert('L28. and it stops at the implementation, so the tests\' own fixtures cannot skew it',
        !files.some((file) => /(^|\/)test-/.test(file)),
        `${files.join(', ')} — test-failsafe.mjs runs a scan with --all on purpose, to prove `
        + 'such a range is refused; sweeping it in would fail L19 on its own fixture');
}
