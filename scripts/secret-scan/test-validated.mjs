/**
 * Finding the last validated commit — the baseline every event but a pull
 * request compares against.
 *
 * "Validated" is two checks succeeding in ONE workflow run, and both halves of
 * that are load-bearing: a commit whose `secret-scan` passed while its own
 * scanner tests failed is exactly the commit a later push must not anchor to. The
 * cases here drive the real lookup against stubbed check-runs responses, because
 * the question is about what GitHub's answers mean, not about HTTP.
 */

import { assert, makeRepo } from './test-support.mjs';
import {
    RELEASE_VALIDATION_CHECK_NAME, SECRET_SCAN_CHECK_NAME,
    findLastValidatedAncestor, isValidatedRelease,
} from './validated.mjs';

/* ========================================================================== */
console.log('\nE. Finding the last validated commit');
/* ========================================================================== */

{
    /*
     * The baseline is "the newest ancestor carrying a fully validated release":
     * one workflow run in which BOTH `secret-scan` and `Verify the release is
     * fully validated` succeeded. Git cannot answer that, so GitHub is asked —
     * and the answers that are NOT "yes" all have to fail closed, distinguishably.
     *
     * The second check is there because of a review finding on 2026-08-26: a
     * commit could break this scanner so `secret-scan` passes wrongly while
     * `callable-contract` (which runs these very tests) fails. `release-validation`
     * refuses unless both of those succeeded, so requiring it means a baseline was
     * scanned by a scanner that had passed its own tests.
     */
    const repo = makeRepo();
    repo.write('f.txt', '1');
    const first = repo.commit('first');
    repo.write('f.txt', '2');
    const second = repo.commit('second');
    repo.write('f.txt', '3');
    const third = repo.commit('third');

    /**
     * A commit's check runs, as GitHub reports them.
     *
     * `byCommit[sha]` is either a conclusion shared by both checks, or an object
     * naming each one's conclusion and, optionally, the suite it belongs to.
     */
    const reply = (byCommit) => async (url) => {
        const sha = url.split('/commits/')[1].split('/')[0];
        const entry = byCommit[sha];
        if (!entry) return { ok: true, json: async () => ({ check_runs: [] }) };
        const spec = typeof entry === 'string'
            ? { scan: entry, validation: entry }
            : entry;
        const runs = [];
        if (spec.scan) {
            runs.push({
                name: SECRET_SCAN_CHECK_NAME,
                status: 'completed',
                conclusion: spec.scan,
                check_suite: { id: spec.scanSuite ?? 1 },
            });
        }
        if (spec.validation) {
            runs.push({
                name: RELEASE_VALIDATION_CHECK_NAME,
                status: 'completed',
                conclusion: spec.validation,
                check_suite: { id: spec.validationSuite ?? 1 },
            });
        }
        return { ok: true, json: async () => ({ check_runs: runs }) };
    };
    const opts = { headSha: third, cwd: repo.dir, repository: 'o/r', token: 't' };

    const found = await findLastValidatedAncestor({
        ...opts, fetchImpl: reply({ [second]: 'success', [first]: 'success' }),
    });
    assert('E1. it returns the NEWEST validated ancestor',
        found.sha === second,
        `${String(found.sha).slice(0, 8)} — walking must stop at the first success`);

    const skipped = await findLastValidatedAncestor({
        ...opts, fetchImpl: reply({ [second]: 'failure', [first]: 'success' }),
    });
    assert('E2 (req 10). an ancestor whose scan FAILED is not a baseline',
        skipped.sha === first,
        'this is the whole point: a failed push must not become the thing we compare against');

    /*
     * Found in review on 2026-08-26 (P1). `secret-scan` green is not enough: the
     * commit that broke the scanner is exactly the commit whose scan passes while
     * `callable-contract` — the scanner's own tests — fails, and
     * `release-validation` is what records that.
     */
    const selfTestsFailed = await findLastValidatedAncestor({
        ...opts,
        fetchImpl: reply({
            [second]: { scan: 'success', validation: 'failure' },
            [first]: 'success',
        }),
    });
    assert('E2b (req 10). nor is one whose scan passed while its release was NOT validated',
        selfTestsFailed.sha === first,
        `${String(selfTestsFailed.sha).slice(0, 8)} — a scanner that passed while its own tests `
        + 'failed has validated nothing');

    const validationOnly = await findLastValidatedAncestor({
        ...opts,
        fetchImpl: reply({
            [second]: { scan: 'failure', validation: 'success' },
            [first]: 'success',
        }),
    });
    assert('E2c (req 10). and neither check alone is enough',
        validationOnly.sha === first,
        `${String(validationOnly.sha).slice(0, 8)}`);

    const differentRuns = await findLastValidatedAncestor({
        ...opts,
        fetchImpl: reply({
            [second]: {
                scan: 'success', validation: 'success', scanSuite: 11, validationSuite: 22,
            },
            [first]: 'success',
        }),
    });
    assert('E2d. two successes from two different runs are not one validated release',
        differentRuns.sha === first,
        `${String(differentRuns.sha).slice(0, 8)} — "some run scanned it" plus "some other run `
        + 'validated it" is a weaker claim than the one being made');

    const none = await findLastValidatedAncestor({ ...opts, fetchImpl: reply({}) });
    assert('E3 (req 10). nothing validated yields no baseline, and the caller refuses',
        none.sha === null && none.error === null && none.checked === 2,
        JSON.stringify(none));

    const broken = await findLastValidatedAncestor({
        ...opts,
        fetchImpl: async () => { throw new Error('network down'); },
    });
    assert('E4 (req 10). a lookup that could not run reports WHY, and still yields no baseline',
        broken.sha === null && /network down/.test(broken.error || ''),
        JSON.stringify(broken));
    assert('E5. "could not ask" is never mistaken for "nothing to find"',
        broken.error !== null && none.error === null,
        'the two fail identically but need different fixes, so they read differently');

    const denied = await findLastValidatedAncestor({
        ...opts, fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    assert('E6 (req 10). a 403 is a refusal, not an empty answer',
        denied.sha === null && /403/.test(denied.error || ''),
        JSON.stringify(denied));

    /*
     * The same question asked about ONE commit, which is what validates a
     * `SECRET_SCAN_BASE` override (C18/C19). Every answer that is not an
     * unambiguous "yes" has to come back false, with a reason where there is one.
     */
    const overrideOk = await isValidatedRelease({
        sha: second, repository: 'o/r', token: 't', fetchImpl: reply({ [second]: 'success' }),
    });
    assert('E8. an override commit carrying a validated release answers yes',
        overrideOk.validated === true && overrideOk.error === null,
        JSON.stringify(overrideOk));

    const overrideHalf = await isValidatedRelease({
        sha: second,
        repository: 'o/r',
        token: 't',
        fetchImpl: reply({ [second]: { scan: 'success', validation: 'failure' } }),
    });
    assert('E9 (req 10). one whose release was not validated answers no',
        overrideHalf.validated === false,
        'this is the commit an operator would reach for after a failed run, and the one '
        + 'that must not be accepted');

    const overrideBroken = await isValidatedRelease({
        sha: second,
        repository: 'o/r',
        token: 't',
        fetchImpl: async () => { throw new Error('network down'); },
    });
    assert('E10 (req 10). and a lookup that could not run answers no, with the reason',
        overrideBroken.validated === false && /network down/.test(overrideBroken.error || ''),
        JSON.stringify(overrideBroken));

    const overrideUntokened = await isValidatedRelease({ sha: second, repository: 'o/r', token: '' });
    assert('E11. with no token it does not pretend to know that either',
        overrideUntokened.validated === false && /GITHUB_TOKEN/.test(overrideUntokened.error || ''),
        JSON.stringify(overrideUntokened));

    const untokened = await findLastValidatedAncestor({ ...opts, token: '', fetchImpl: reply({}) });
    assert('E7. with no token it does not pretend to know',
        untokened.sha === null && /GITHUB_TOKEN/.test(untokened.error || ''),
        JSON.stringify(untokened));
}
