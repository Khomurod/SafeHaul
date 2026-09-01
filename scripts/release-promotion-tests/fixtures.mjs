/**
 * Shared fixtures for the promotion-gate tests, extracted verbatim from
 * `test-release-promotion.mjs`.
 */
import { createRequire } from 'node:module';
import { REQUIRED_RELEASE_CHECKS } from '../resolve-testing-release.mjs';

const require = createRequire(import.meta.url);
export const { readReleaseStatus } = require('../../functions/releaseManagement/eligibility.js');


/**
 * The one required check that vouches for every test lane. Individual test jobs
 * are skippable when a pull request already validated the identical source tree,
 * so this is what must be present and green instead of each of them.
 */
export const GATE_CHECK = 'Verify the release is fully validated';

export const SHA_TESTED = 'a'.repeat(40);
export const SHA_NEWER = 'b'.repeat(40);
export const SHA_FAILED = 'c'.repeat(40);
export const SHA_PREVIOUS = 'd'.repeat(40);

/** Every required check, completed and green. The default healthy commit. */
export const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
}));

/**
 * Builds a fake GitHub REST surface. `deployments` is keyed by environment.
 * Anything not listed simply does not exist, which is what the real API returns.
 */
export function fakeApi({ deployments = {}, statuses = {}, checkRuns = allRequiredGreen } = {}) {
    return async (path) => {
        const statusMatch = path.match(/^\/deployments\/(\d+)\/statuses/);
        if (statusMatch) {
            return (statuses[statusMatch[1]] || []).map((state) => ({ state }));
        }
        if (path.startsWith('/commits/')) {
            return { check_runs: checkRuns };
        }
        const envMatch = path.match(/environment=([a-z]+)/);
        const shaMatch = path.match(/sha=([0-9a-f]+)/);
        const pool = deployments[envMatch?.[1]] || [];
        return shaMatch ? pool.filter((d) => d.sha === shaMatch[1]) : pool;
    };
}

export const goodTestingDeployment = {
    id: 101,
    sha: SHA_TESTED,
    created_at: '2026-08-07T11:00:49Z',
    payload: { appVersionId: 'ver-app-101', landingVersionId: 'ver-landing-101' },
};

export const healthy = fakeApi({
    deployments: { testing: [goodTestingDeployment], production: [] },
    statuses: { 101: ['success'] },
});

