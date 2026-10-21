// functions/bulkActions/helpers/campaignLimit.js
//
// Limit Volume: a campaign takes the newest N recipients its filters match,
// after the recently-messaged exclusion. The count, the preview and the launch
// read it here.

/** The most recipients the campaign takes, or 0 for no limit. */
const campaignLimitOf = (filters) => {
    const limit = parseInt(filters?.campaignLimit, 10);
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
};

/** A record's creation time for "newest first"; a record without one sorts last. */
const createdMillis = (createdAt) => (typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : -Infinity);

module.exports = { campaignLimitOf, createdMillis };
