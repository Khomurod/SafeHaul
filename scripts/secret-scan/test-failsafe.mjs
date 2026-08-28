/**
 * A base that cannot be trusted is refused, never widened.
 *
 * This is the section that guards the property the whole gate rests on: there is
 * no input — a missing base, an unknown event, an abbreviated SHA, an override
 * naming an unvalidated commit, a `.gitleaksignore`, a scanner that died — for
 * which this job reports success. Each case here failed open at some point during
 * the change that introduced it, which is why each is stated as a refusal rather
 * than as a message.
 */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    FAKE_GCP_KEY, assert, getBinary, makeRepo, scan, scratch, throws,
} from './test-support.mjs';
import { performScans, runGitleaksScan } from './gitleaks.mjs';
import { resolveScanPlan } from './range.mjs';

const binary = getBinary();

/* ========================================================================== */
console.log('\nC. Failing safe — a base that cannot be trusted is never widened');
/* ========================================================================== */

{
    const repo = makeRepo();
    repo.write('a.txt', 'a');
    const first = repo.commit('first');
    repo.write('a.txt', 'b');
    const second = repo.commit('second');
    const git = repo.gitOps();

    // 10. Malformed / missing base information.
    throws('C1 (req 10). a pull_request with no base.sha refuses',
        () => resolveScanPlan({ eventName: 'pull_request', payload: { pull_request: {} }, headSha: second, git }));
    throws('C2 (req 10). a pull_request whose base is not in the clone refuses',
        () => resolveScanPlan({
            eventName: 'pull_request',
            payload: { pull_request: { base: { sha: 'f'.repeat(40) } } },
            headSha: second,
            git,
        }));
    throws('C3 (req 10). a push with no before and nothing validated refuses',
        () => resolveScanPlan({
            eventName: 'push',
            payload: { before: '0'.repeat(40) },
            headSha: second,
            lastValidatedBase: () => null,
            git,
        }));
    throws('C4 (req 10). an unknown event refuses rather than guessing',
        () => resolveScanPlan({ eventName: 'issue_comment', headSha: second, git }));
    throws('C5 (req 10). a head that is not a full SHA refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'HEAD', git }));
    throws('C6 (req 10). a head that is not in the clone refuses',
        () => resolveScanPlan({ eventName: 'workflow_dispatch', headSha: 'a'.repeat(40), git }));
    throws('C6b (req 10). a validated base that is the head itself refuses (empty range)',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, lastValidatedBase: () => second, git,
        }),
        'an empty range compares nothing, which must never read as clean');

    // The override is an escape hatch, not a bypass.
    throws('C7. SECRET_SCAN_BASE that is not an ancestor of head refuses',
        () => {
            repo.checkoutNew('unrelated', first);
            repo.write('b.txt', 'b');
            const off = repo.commit('off to one side');
            repo.checkout('main');
            resolveScanPlan({
                eventName: 'workflow_dispatch', headSha: second, baseOverride: off,
                isValidatedRelease: () => true, git,
            });
        });
    throws('C8. SECRET_SCAN_BASE that is not a SHA at all refuses',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, baseOverride: 'main~3',
            isValidatedRelease: () => true, git,
        }));
    const overridden = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: second, baseOverride: first,
        isValidatedRelease: () => true, git,
    });
    assert('C9. a valid SECRET_SCAN_BASE is honoured and recorded as the source',
        overridden.base === first && overridden.source === 'explicit-base-override',
        `${overridden.source}: ${String(overridden.base).slice(0, 8)}`);

    /*
     * Found in review on 2026-08-26 (P1).
     *
     * An abbreviated SHA of the head is a different STRING and the same COMMIT.
     * Every check but one is a string comparison, and `merge-base --is-ancestor`
     * says yes because a commit is its own ancestor — so `SECRET_SCAN_BASE` set
     * to the head's short form produced a 0-commit range that passed. The base is
     * resolved to its full SHA before anything compares it now.
     */
    throws('C11 (req 10). an ABBREVIATED SHA of the head refuses, like the full one',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: second, baseOverride: second.slice(0, 8),
            isValidatedRelease: () => true, git,
        }),
        'short and long names of one commit must both be recognised as the head');
    const abbreviated = resolveScanPlan({
        eventName: 'workflow_dispatch', headSha: second, baseOverride: first.slice(0, 10),
        isValidatedRelease: () => true, git,
    });
    assert('C12. an abbreviated base that IS an ancestor is honoured, and canonicalised',
        abbreviated.base === first && abbreviated.logOpts === `-m ${first}..${second}`,
        `${abbreviated.logOpts} — the range must name commits in full, not as typed`);

    /*
     * A scanner that did not run has proven nothing, and must never read as
     * clean. gitleaks exits 1 both for "leaks found" and for "something went
     * wrong", so the two are told apart by whether a parseable report exists —
     * and both fail the job.
     */
    if (binary) {
        const work = mkdtempSync(join(tmpdir(), 'safehaul-secret-scan-err-'));
        scratch.push(work);
        const brokenConfig = runGitleaksScan({
            binary,
            mode: 'git',
            target: repo.dir,
            logOpts: `-m ${first}..${second}`,
            config: join(work, 'this-config-does-not-exist.toml'),
            reportPath: join(work, 'a.json'),
        });
        assert('C13 (req 21). a scanner that could not run reports an ERROR, never "clean"',
            brokenConfig.errored && !brokenConfig.ok && brokenConfig.findings.length === 0,
            `ok=${brokenConfig.ok} errored=${brokenConfig.errored} — 0 findings and exit 1 must not `
            + 'be read as "nothing found"');

        const brokenTarget = runGitleaksScan({
            binary,
            mode: 'git',
            target: join(work, 'not-a-repository'),
            logOpts: `-m ${first}..${second}`,
            reportPath: join(work, 'b.json'),
        });
        assert('C14 (req 21). and so does one pointed at something that is not a repository',
            brokenTarget.errored && !brokenTarget.ok,
            `ok=${brokenTarget.ok} errored=${brokenTarget.errored}`);

        const scanned = performScans({
            binary,
            cwd: repo.dir,
            plan: {
                base: first, head: second, source: 'test', logOpts: `-m ${first}..${second}`,
            },
            config: join(work, 'this-config-does-not-exist.toml'),
            workDir: join(work, 'run'),
        });
        assert('C15 (req 21). and the two-part scan refuses the job when either half errored',
            !scanned.ok && scanned.problems.some((problem) => /did not complete/.test(problem)),
            scanned.problems.join('; '));
    }

    /*
     * A `.gitleaksignore` suppresses findings by fingerprint, gitleaks reads it
     * from the scan root by default, and pointing `--gitleaks-ignore-path`
     * elsewhere does not undo that (measured). So the job refuses when one is
     * present rather than scanning around it.
     */
    if (binary) {
        const repo2 = makeRepo().useRepoConfig();
        repo2.write('src/app.js', 'export const answer = 42;');
        const b2 = repo2.commit('clean base');
        repo2.write('src/leak.js', `export const k = '${FAKE_GCP_KEY}';`);
        const h2 = repo2.commit('adds a secret');
        // The fingerprints that would be suppressed are irrelevant: the file's
        // presence is the refusal, so its contents are never consulted.
        repo2.write('.gitleaksignore', 'whatever\n');
        repo2.commit('and an ignore file to hide it');
        const h3 = repo2.head();
        const withIgnore = scan(repo2, {
            base: b2, head: h3, source: 'test', logOpts: `-m ${b2}..${h3}`,
        }, binary);
        assert('C21 (req 12). a .gitleaksignore in the tree refuses the job',
            !withIgnore.ok && withIgnore.problems.some((p) => /gitleaksignore/.test(p)),
            withIgnore.problems.join('; ') || 'no problem was recorded');
        void h2;
    }

    /*
     * Found in review on 2026-08-26 (P1).
     *
     * The override used to clear only the structural bar — a real SHA, an
     * ancestor, not the head — while the refusal above *tells an operator to set
     * it*. So the natural repair for "nothing is validated" was to paste in the
     * tip that had just failed: the one commit whose broken scanner reported
     * success while its own tests did not. It has to clear the same bar as an
     * inferred base.
     */
    throws('C18 (req 10). an override that is not a validated release refuses',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch',
            headSha: second,
            baseOverride: first,
            isValidatedRelease: () => false,
            git,
        }),
        'an override names a release known to be good; it does not invent one');
    assert('C19. the same override IS honoured once it carries a validated release',
        resolveScanPlan({
            eventName: 'workflow_dispatch',
            headSha: second,
            baseOverride: first,
            isValidatedRelease: (sha) => sha === first,
            git,
        }).base === first,
        'and the predicate is asked about the RESOLVED commit, not the string typed');

    /*
     * The same guarantee one step further, found in review on 2026-08-26 (P1).
     *
     * A readable report is not proof that the scan finished: a nonzero exit that
     * still wrote a parseable EMPTY report used to set `errored` false with no
     * findings, so `performScans` recorded no problem and the gate passed over a
     * scanner that had failed. Driven here with a stub scanner, because gitleaks
     * 8.30.1 does not do it — which is exactly why the branch must not depend on
     * that staying true.
     */
    {
        const stubDir = mkdtempSync(join(tmpdir(), 'safehaul-stub-scanner-'));
        scratch.push(stubDir);
        const stub = join(stubDir, 'gitleaks-stub');
        writeFileSync(stub, [
            '#!/usr/bin/env node',
            '// Writes an empty, perfectly parseable report and then fails.',
            "const { writeFileSync } = require('node:fs');",
            "const at = process.argv.indexOf('--report-path');",
            "if (at !== -1) writeFileSync(process.argv[at + 1], '[]');",
            'process.exit(7);',
        ].join('\n'));
        chmodSync(stub, 0o755);

        const failed = runGitleaksScan({
            binary: stub,
            mode: 'git',
            target: repo.dir,
            logOpts: `-m ${first}..${second}`,
            reportPath: join(stubDir, 'empty.json'),
        });
        assert('C16 (req 21). a nonzero exit with an EMPTY report is an incomplete scan, not a clean one',
            failed.errored && !failed.ok,
            `ok=${failed.ok} errored=${failed.errored} detail=${failed.detail}`);

        // The work directory has to exist before the call, or the stub cannot
        // write its report and the case degrades into C13's (no report at all)
        // — which passes for the wrong reason.
        const runDir = join(stubDir, 'run');
        mkdirSync(runDir, { recursive: true });
        const scanned = performScans({
            binary: stub,
            cwd: repo.dir,
            plan: {
                base: first, head: second, source: 'test', logOpts: `-m ${first}..${second}`,
            },
            workDir: runDir,
        });
        assert('C17 (req 21). and the job refuses rather than deploying on it',
            !scanned.ok && scanned.problems.length > 0,
            scanned.problems.join('; ') || 'no problem was recorded, so the release gate saw success');
    }

    // A repository whose single commit has never been validated has no baseline,
    // and says so rather than inventing one.
    const fresh = makeRepo();
    fresh.write('only.txt', 'x');
    const root = fresh.commit('root');
    throws('C10 (req 10). a commit with no validated ancestor refuses, whatever its position',
        () => resolveScanPlan({
            eventName: 'workflow_dispatch', headSha: root, lastValidatedBase: () => null, git: fresh.gitOps(),
        }),
        'including a root commit — "nothing to compare against" is a refusal, not a full scan');
}
