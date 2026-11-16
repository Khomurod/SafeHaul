/**
 * The GitHub REST calls the release scripts make, written once: the
 * repository's API base, the headers GitHub asks for with the API version
 * pinned, a JSON body for a write, and an error that names the call and quotes
 * the start of GitHub's answer when it refuses.
 *
 * Used by the planner (`ci-plan.mjs`), the release record and its readiness
 * (`record-release.mjs`, `mark-release-ready.mjs`), the deploy base
 * (`resolve-deploy-base.mjs`) and the health check and its issue
 * (`check-release-health.mjs`, `report-release-health.mjs`). The promotion's
 * resolver (`resolve-testing-release.mjs`) runs the server's own reader
 * (`functions/releaseManagement/eligibility.js`, deployed with the functions)
 * end to end, and the secret scan keeps its own request: its source is pinned.
 * Which deployments are confirmed releases is `confirmedReleases.mjs`.
 */

export const GITHUB_API_VERSION = '2022-11-28';

/**
 * A call to GitHub's REST API for one repository: `api(path)` reads,
 * `api(path, { method, body, accept })` writes `body` as JSON. Resolves to the
 * answer's JSON (null for an empty one); rejects on any answer but a 2xx.
 *
 * @param {{ token: string, repository: string, fetchImpl?: typeof fetch }} options
 * @returns {(path: string, init?: { method?: string, body?: unknown, accept?: string }) => Promise<any>}
 */
export function createGithubApi({ token, repository, fetchImpl = fetch }) {
    return async (path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) => {
        const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
            method,
            headers: {
                Accept: accept,
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`GitHub API ${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
        }
        return text ? JSON.parse(text) : null;
    };
}
