#!/usr/bin/env node
/**
 * The promotion gate, as invoked by `.github/workflows/promote-production.yml`.
 *
 * The rules themselves live in `functions/releaseManagement/eligibility.js` and
 * are imported rather than restated here, because the Super Admin callables
 * enforce the same rules before they will dispatch this workflow at all. Two
 * copies of a production gate eventually disagree, and the way you find out is
 * that the wrong bytes reach app.safehaul.io.
 *
 * Given only a candidate SHA this answers:
 *
 *   - Was this SHA deployed to Testing, and was the whole release — frontend AND
 *     shared backend — confirmed successful?
 *   - Which immutable Hosting version did it produce?
 *   - Is every required check present and green for this commit right now?
 *   - Is production already on it (so a repeated promotion is a no-op)?
 *
 * A SHA typed by a human, or forwarded from a browser, is never trusted: if it
 * has no successful Testing release record, this exits non-zero and the
 * promotion stops before any Google credential is minted.
 *
 * Usage: node scripts/resolve-testing-release.mjs <sha>
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    IneligibleReleaseError,
    REQUIRED_RELEASE_CHECKS,
    createGithubApi,
    resolveTestingRelease,
} = require('../functions/releaseManagement/eligibility.js');

export { IneligibleReleaseError, REQUIRED_RELEASE_CHECKS, createGithubApi, resolveTestingRelease };

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
    const candidateSha = process.argv[2];
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: outputFile } =
        process.env;

    if (!candidateSha || !token || !repository) {
        console.error(
            'Usage: resolve-testing-release.mjs <sha> (needs GITHUB_TOKEN, GITHUB_REPOSITORY)',
        );
        process.exit(1);
    }

    try {
        const resolvedRelease = await resolveTestingRelease({
            candidateSha,
            api: createGithubApi({ token, repository }),
        });

        const outputs = {
            app_version_id: resolvedRelease.appVersionId,
            landing_version_id: resolvedRelease.landingVersionId,
            testing_deployment_id: resolvedRelease.testingDeploymentId,
            already_live: String(resolvedRelease.alreadyLive),
        };

        if (outputFile) {
            appendFileSync(
                outputFile,
                `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
                'utf8',
            );
        }

        console.log(
            `Resolved ${candidateSha} -> Hosting app version ${outputs.app_version_id} ` +
            `(Testing deployment #${outputs.testing_deployment_id}). ` +
            `Production already live on it: ${resolvedRelease.alreadyLive}.`,
        );
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
