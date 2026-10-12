// functions/bulkActions/helpers/launchLimit.js
//
// The most recipients one bulk launch may message (`docs/APP_BRIEF.md` §8). It
// is counted after every exclusion, and a larger audience is refused before
// anything is written, so the recruiter narrows it rather than the server
// picking who is left out. The screens show the same limit
// (`src/features/campaigns/constants/campaignConstants.js`).

const { HttpsError } = require("firebase-functions/v2/https");

const MAX_RECIPIENTS_PER_LAUNCH = 2000;

// The server's text is what the screens show when it refuses, so it names
// what the recruiter can change where the launch came from. A retry cannot be
// narrowed, but sends stamp only the recipients they reached, so launching the
// campaign again with the window on leaves those out.
function howToNarrow(source, limit) {
    if (source === "upload") return "Upload the list in parts, or un-tick rows.";
    if (source === "retry") {
        return `Launch the campaign again with Exclude Previously Messaged on, at most ${limit} at a time: whoever got the message is left out.`;
    }
    return "Narrow the filters, set Limit Volume, or un-tick leads, then launch the rest separately.";
}

/** @param {{ source?: 'crm'|'upload'|'retry' }} [options] where the launch came from */
function assertWithinLaunchLimit(count, { source = "crm" } = {}) {
    if (count <= MAX_RECIPIENTS_PER_LAUNCH) return;
    const limit = MAX_RECIPIENTS_PER_LAUNCH.toLocaleString("en-US");
    throw new HttpsError(
        "invalid-argument",
        `A launch can message at most ${limit} recipients, and this audience has ${count.toLocaleString("en-US")}. ${howToNarrow(source, limit)}`
    );
}

module.exports = {
    MAX_RECIPIENTS_PER_LAUNCH,
    assertWithinLaunchLimit,
};
