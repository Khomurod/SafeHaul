/**
 * Which stored application statuses mean a hired driver, on the server.
 *
 * `'Hired'` and the older `'Approved'`, matched exactly as stored: the browser's
 * `APPLICATION_STATUS_GROUPS.hired` (`src/shared/utils/applicationStatus.js`),
 * which the Hired segment queries with `status in [...]`, held to this list by
 * `applicationStatus.parity.test.js`. The dashboard's Hired number and its
 * "Needs attention" both read hired drivers through it. Only append variants:
 * stored documents carry them.
 */
const HIRED_STATUSES = Object.freeze(['Hired', 'Approved']);

function isHiredStatus(status) {
    return HIRED_STATUSES.includes(status);
}

module.exports = { HIRED_STATUSES, isHiredStatus };
