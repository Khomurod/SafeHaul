/**
 * Data cleanup → old SSN copies, which nothing reads:
 *
 * - `drivers/{id}/pending_updates/*` `proposedChanges.personalInfo.ssn`: driver
 *   sync staged every application and lead there with the SSN encrypted, until
 *   it stopped (`driverSync.js`);
 * - `drivers/{id}` `personalInfo.ssn`: for a few weeks driver sync wrote the
 *   SSN in plain text onto the master profile, which the driver's companies'
 *   staff can read.
 *
 * Only that one field is deleted, and only where it holds a value. Both scans
 * walk the whole collection: a missing or present field cannot be queried
 * there without an index.
 */
const { createWriter, forEachPage, readPath } = require('./shared');

const PENDING_FIELD = 'proposedChanges.personalInfo.ssn';
const DRIVER_FIELD = 'personalInfo.ssn';
const PENDING_PATH = /^drivers\/[^/]+\/pending_updates\/[^/]+$/;

const holdsValue = (value) => typeof value === 'string' && value.length > 0;

async function sweep(ctx) {
    const counts = { pendingUpdates: 0, driverProfiles: 0 };
    const writer = createWriter(ctx.db, ctx.apply);
    const remove = ctx.FieldValue.delete();

    const scan = (query, field, key, pathOk) => forEachPage(ctx, query.select(field), async (docs) => {
        for (const doc of docs) {
            if (!pathOk(doc.ref.path) || !holdsValue(readPath(doc.data(), field))) continue;
            counts[key] += 1;
            await writer.update(doc.ref, { [field]: remove });
        }
    });

    let done = await scan(ctx.db.collectionGroup('pending_updates'), PENDING_FIELD, 'pendingUpdates',
        (path) => PENDING_PATH.test(path));
    if (done) done = await scan(ctx.db.collection('drivers'), DRIVER_FIELD, 'driverProfiles', () => true);
    await writer.flush();
    return { done, counts };
}

module.exports = { sweep };
