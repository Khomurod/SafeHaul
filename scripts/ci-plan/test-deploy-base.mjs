/**
 * F — the incremental Cloud Functions deploy base.
 *
 * A failed deploy must WIDEN the next window, not silently drop the functions it
 * changed. That is the defect this section exists for: a function can otherwise
 * fail to deploy for two merges running while every run reports success.
 */

import { chooseDeployBase, readLastDeployedSha } from '../resolve-deploy-base.mjs';
import { createGithubApi, GITHUB_API_VERSION } from '../lib/githubApi.mjs';
import { assert, workflow } from './test-support.mjs';

console.log('\nF. Incremental deploy base');
/* ========================================================================== */

// The window the Cloud Functions deploy measures "changed" against. Using the
// previous PUSH silently orphans a failed deploy's work — see
// `scripts/resolve-deploy-base.mjs` for the incident this prevents.

const SHA_DEPLOYED = '1'.repeat(40);
const SHA_PREV_PUSH = '2'.repeat(40);
const ancestorOf = (...shas) => (sha) => shas.includes(sha);

{
    const decision = chooseDeployBase({
        lastDeployedSha: SHA_DEPLOYED,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_DEPLOYED, SHA_PREV_PUSH),
    });
    assert('F1. prefers the last release confirmed deployed over the previous push',
        decision.base === SHA_DEPLOYED && decision.source === 'last-successful-deploy',
        JSON.stringify(decision));
}

// THE regression test: replay the incident.
//
// A commit ships a new function. Its deploy fails. A later commit lands and
// deploys fine. Measuring from the previous push would start AFTER the failed
// commit and never deploy its function. Measuring from the last CONFIRMED
// deploy keeps it inside the window.
{
    const lastConfirmed = SHA_DEPLOYED;   // deployed fine
    const failedDeploy = '3'.repeat(40);  // added the function; deploy died
    const decision = chooseDeployBase({
        lastDeployedSha: lastConfirmed,
        pushBefore: failedDeploy,
        isAncestor: ancestorOf(lastConfirmed, failedDeploy),
    });
    assert('F2. a failed deploy WIDENS the next window instead of dropping it',
        decision.base === lastConfirmed,
        'the commit whose deploy failed must stay inside the next diff range');
}

{
    const decision = chooseDeployBase({
        lastDeployedSha: null,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_PREV_PUSH),
    });
    assert('F3. with no confirmed release, falls back to the previous push',
        decision.base === SHA_PREV_PUSH && decision.source === 'push-before',
        JSON.stringify(decision));
}

{
    // A force push, a rewritten history, or re-running an older workflow. A base
    // that is not behind HEAD produces a meaningless diff.
    const decision = chooseDeployBase({
        lastDeployedSha: SHA_DEPLOYED,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_PREV_PUSH),
    });
    assert('F4. a recorded sha that is not an ancestor of HEAD is not used',
        decision.base === SHA_PREV_PUSH && decision.source === 'push-before',
        JSON.stringify(decision));
}

for (const [label, pushBefore] of [
    ['all-zero (a new branch)', '0'.repeat(40)],
    ['absent', null],
    ['a short sha', SHA_PREV_PUSH.slice(0, 7)],
]) {
    const decision = chooseDeployBase({
        lastDeployedSha: null,
        pushBefore,
        isAncestor: () => true,
    });
    assert(`F5. no range when the previous push is ${label}`,
        decision.base === null && decision.source === 'none',
        JSON.stringify(decision));
}

{
    const decision = chooseDeployBase({
        lastDeployedSha: null, pushBefore: null, isAncestor: () => true,
    });
    assert('F6. reports no base rather than inventing one',
        decision.base === null,
        'the deploy planner must be the one that decides what "no range" means');
}

/* -- reading the confirmed release ----------------------------------------- */

const deploymentApi = (deployments, statuses) => async (path) => {
    const match = path.match(/^\/deployments\/(\d+)\/statuses/);
    if (match) return (statuses[match[1]] || []).map((state) => ({ state }));
    return deployments;
};

{
    const sha = await readLastDeployedSha(deploymentApi(
        [
            { id: 3, sha: 'c'.repeat(40), payload: { appVersionId: 'v3' } },
            { id: 2, sha: 'b'.repeat(40), payload: { appVersionId: 'v2' } },
        ],
        { 3: ['in_progress'], 2: ['success'] },
    ));
    assert('F7. skips a release whose backend rollout was never confirmed',
        sha === 'b'.repeat(40),
        `got ${sha} — an in_progress record is not a deployed one`);
}

{
    const sha = await readLastDeployedSha(deploymentApi(
        [
            { id: 9, sha: 'd'.repeat(40), payload: {} },            // foreign (Vercel)
            { id: 8, sha: 'e'.repeat(40), payload: { appVersionId: 'v8' } },
        ],
        { 9: ['success'], 8: ['success'] },
    ));
    assert('F8. ignores foreign deployment records sharing the environment',
        sha === 'e'.repeat(40), `got ${sha}`);
}

{
    const sha = await readLastDeployedSha(deploymentApi([], {}));
    assert('F9. reports nothing when no release was ever confirmed', sha === null);
}

/* -- the one GitHub client every release script uses ---------------------- */
// `scripts/lib/githubApi.mjs`. A fake `fetch` records each request; nothing is
// sent to GitHub.
{
    const sent = [];
    const answer = (status, text) => async (url, init) => {
        sent.push({ url, ...init });
        return { ok: status >= 200 && status < 300, status, text: async () => text };
    };
    const repo = { token: 'artificial-token', repository: 'owner/repo' };

    const read = await createGithubApi({ ...repo, fetchImpl: answer(200, '[{"id":1}]') })('/deployments?environment=testing');
    const get = sent[0];
    assert('F12. a read names the repository, pins the API version and sends no body',
        get.url === 'https://api.github.com/repos/owner/repo/deployments?environment=testing'
            && get.method === 'GET' && get.body === undefined
            && get.headers.Authorization === 'Bearer artificial-token'
            && get.headers.Accept === 'application/vnd.github+json'
            && get.headers['X-GitHub-Api-Version'] === GITHUB_API_VERSION && GITHUB_API_VERSION === '2022-11-28'
            && !('Content-Type' in get.headers)
            && Array.isArray(read) && read[0].id === 1,
        JSON.stringify(get));

    sent.length = 0;
    const written = await createGithubApi({ ...repo, fetchImpl: answer(201, '') })('/deployments/7/statuses', {
        method: 'POST', body: { state: 'success', log_url: undefined }, accept: 'application/vnd.github.flash-preview+json',
    });
    const post = sent[0];
    assert('F13. a write sends its body as JSON, with the Accept it asks for',
        post.method === 'POST' && post.body === '{"state":"success"}'
            && post.headers['Content-Type'] === 'application/json'
            && post.headers.Accept === 'application/vnd.github.flash-preview+json'
            && written === null,
        JSON.stringify(post));

    let refusal = null;
    try {
        await createGithubApi({ ...repo, fetchImpl: answer(422, `{"message":"Validation Failed"}${'x'.repeat(500)}`) })(
            '/deployments', { method: 'POST', body: {} });
    } catch (error) {
        refusal = error.message;
    }
    assert('F14. a refusal names the call and quotes the start of the answer',
        typeof refusal === 'string'
            && refusal.startsWith('GitHub API POST /deployments -> 422: {"message":"Validation Failed"}')
            && refusal.length < 460 && !refusal.includes('artificial-token'),
        refusal);
}

/* -- and the workflow has to actually use it ------------------------------- */
{
    const deploy = workflow.slice(workflow.indexOf('\n  deploy-functions:'));
    const resolveAt = deploy.indexOf('scripts/resolve-deploy-base.mjs');
    const deployAt = deploy.indexOf('scripts/deploy-functions-incremental.mjs');

    assert('F10. deploy-functions resolves the base before deploying',
        resolveAt !== -1 && deployAt !== -1 && resolveAt < deployAt,
        'the base must be resolved before the planner reads DEPLOY_GIT_BASE');

    assert('F11. deploy-functions may read the deployment records',
        /deployments:\s*read/.test(deploy.slice(0, deploy.indexOf('\n    steps:'))),
        'without deployments: read the base resolver silently falls back');
}

/* ========================================================================== */
