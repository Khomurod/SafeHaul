// functions/bulkActions/helpers/launchLimit.js
//
// The most recipients one bulk launch may message (`docs/APP_BRIEF.md` §8). It
// is counted after every exclusion, and a larger audience is refused before
// anything is written, so the recruiter narrows it rather than the server
// picking who is left out. The screens show the same limit
// (`src/features/campaigns/constants/campaignConstants.js`).

const { HttpsError } = require("firebase-functions/v2/https");

const MAX_RECIPIENTS_PER_LAUNCH = 2000;

function assertWithinLaunchLimit(count) {
    if (count <= MAX_RECIPIENTS_PER_LAUNCH) return;
    const limit = MAX_RECIPIENTS_PER_LAUNCH.toLocaleString("en-US");
    throw new HttpsError(
        "invalid-argument",
        `A launch can message at most ${limit} recipients, and this audience has ${count.toLocaleString("en-US")}. ` +
        "Narrow the filters, set Limit Volume, or un-tick rows, then launch the rest separately."
    );
}

module.exports = {
    MAX_RECIPIENTS_PER_LAUNCH,
    assertWithinLaunchLimit,
};
