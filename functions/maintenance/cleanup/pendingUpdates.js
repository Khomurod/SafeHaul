/**
 * Data cleanup → old driver staging copies: every `drivers/{id}/pending_updates`
 * document. Driver sync wrote one for each application and lead a driver sent,
 * a copy of their details, until it stopped (`driverSync.js`); nothing reads or
 * writes them, and no rule lets anyone open them. Deleting them is the owner's
 * decision (В7).
 *
 * The documents are deleted whole; the driver profile above them is not
 * touched, and a collection of the same name anywhere else is left alone.
 */
const { createWriter, forEachPage } = require('./shared');

const PENDING_PATH = /^drivers\/[^/]+\/pending_updates\/[^/]+$/;

async function sweep(ctx) {
    const counts = { pendingUpdates: 0 };
    const writer = createWriter(ctx.db, ctx.apply);

    const done = await forEachPage(ctx, ctx.db.collectionGroup('pending_updates').select(), async (docs) => {
        for (const doc of docs) {
            if (!PENDING_PATH.test(doc.ref.path)) continue;
            counts.pendingUpdates += 1;
            await writer.delete(doc.ref);
        }
    });
    await writer.flush();
    return { done, counts };
}

module.exports = { sweep };
