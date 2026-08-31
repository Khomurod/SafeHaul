/**
 * Super Admin "Release Management" — callable surface.
 *
 * Three narrow callables. Together they are the only way a human can change what
 * app.safehaul.io serves, and every one of them is built on the same rule:
 *
 *   THE BROWSER NEVER NAMES THE RELEASE.
 *
 * A promotion request carries no commit SHA that the server acts on. The server
 * resolves the authoritative candidate itself, from GitHub Deployment records
 * that only GitHub Actions can write, and re-verifies its eligibility from
 * scratch immediately before dispatching. A client that edits its own payload
 * can, at most, cause its own request to be refused.
 *
 * ## Contract shared by all three
 *
 *  - authenticated, and exactly `globalRole === 'super_admin'`;
 *  - company admins and ordinary users are rejected, not degraded;
 *  - the two promoting callables additionally require recent authentication;
 *  - per-caller, fail-closed rate limits;
 *  - no GitHub or Google credential is ever returned, logged or echoed;
 *  - a value-free audit record for every promotion, including denials.
 *
 * ## Why status reads are not audited
 *
 * The Release Management screen polls `getReleaseStatus` while a promotion runs.
 * Recording every poll would bury the records that matter — who promoted what —
 * under thousands of reads of public release identifiers. Denials ARE recorded,
 * by the guards themselves, so an attempt to reach this surface without
 * authority is still visible.
 */

const { onCall } = require('firebase-functions/v2/https');
const { ACTIONS } = require('../environmentVault/audit');
const { assertSuperAdmin, assertWithinRateLimit } = require('../environmentVault/guards');
const {
    readReleaseStatus,
} = require('./eligibility');
const {
    SECRET_NAMES,
    createReleaseApi,
    isCredentialConfigured,
    listPromotionRuns,
    selectRunningPromotion,
} = require('./github');
const {
    safeFailure,
    readLatestPromotion,
    refreshPromotion,
} = require('./promotionStore');
const { startPromotion } = require('./promote');

const releaseOptions = {
    cors: true,
    secrets: SECRET_NAMES,
};

/**
 * 1. The whole release picture the Super Admin screen renders.
 *
 * Everything returned here is a public release identifier: commit SHAs, Firebase
 * Hosting version ids, a GitHub run id and timestamps. There is deliberately no
 * path through this callable that can surface an environment value, a token or
 * anything about the release credential beyond whether one exists.
 */
exports.getReleaseStatus = onCall(releaseOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.RELEASE_STATUS);
    await assertWithinRateLimit(request, 'releaseStatus', ACTIONS.RELEASE_STATUS, {}, 'release');

    if (!isCredentialConfigured()) {
        return {
            configured: false,
            message:
                'Release Management is not connected to the deployment pipeline yet. ' +
                'A release credential must be configured before releases can be promoted from here.',
            testing: null,
            production: null,
            previousProduction: null,
            activePromotion: null,
            latestPromotion: await readLatestPromotion().catch(() => null),
            generatedAt: Date.now(),
        };
    }

    try {
        const api = createReleaseApi();
        const state = await readReleaseStatus({ api });

        // One request answers both "is a release running" and "what became of
        // the last one we started". A transient failure here must not turn a
        // running release into a failed one, so it degrades to "no run
        // information" and leaves the stored record as it was.
        let runs = [];
        try {
            runs = await listPromotionRuns();
        } catch (error) {
            console.warn('[releaseManagement] could not read promotion runs', {
                message: error?.message || 'unknown',
            });
        }

        const latest = await refreshPromotion(await readLatestPromotion(), runs);
        const running = selectRunningPromotion(runs);

        return {
            configured: true,
            ...state,
            // `running` is GitHub's own answer, so a promotion started by any
            // route — this screen, or a manual dispatch during an incident —
            // shows up here and blocks a second one.
            activePromotion: running,
            latestPromotion: latest,
            generatedAt: Date.now(),
        };
    } catch (error) {
        throw safeFailure(error, 'getReleaseStatus');
    }
});

/**
 * 2. Promote the currently eligible tested release to Production.
 *
 * The candidate is whatever `readReleaseStatus` reports as the eligible Testing
 * release — never a SHA from the request.
 */
exports.promoteTestingToProduction = onCall(releaseOptions, (request) => startPromotion(request, {
    kind: 'promote',
    action: ACTIONS.PROMOTE,
    resolveCandidate: (state) => (state.testing?.eligible ? state.testing.sha : null),
}));

/**
 * 3. Roll Production back to the previous release.
 *
 * The candidate is the previous SUCCESSFUL Production release on record, chosen
 * by the server. It goes through exactly the same eligibility gate as a forward
 * promotion, and is delivered the same way: the immutable Hosting version that
 * release originally produced is cloned back onto the production site.
 *
 * What this does NOT do, and what the confirmation dialog says plainly: it does
 * not roll back the shared backend. Cloud Functions, Firestore rules, Storage
 * rules, indexes and all business data are shared with Testing and stay where
 * they are. This is a frontend rollback, and it is only safe because the release
 * discipline requires backend changes to remain backward compatible with the
 * frontend currently live on production.
 */
exports.rollbackProductionRelease = onCall(releaseOptions, (request) => startPromotion(request, {
    kind: 'rollback',
    action: ACTIONS.PROMOTE,
    resolveCandidate: (state) => state.previousProduction?.sha || null,
}));
