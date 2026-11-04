/**
 * Data cleanup → DQ valid-until dates: `dqExpiresNext` on every application and
 * lead whose DQ file disagrees with it. Since the field exists the DQ trigger
 * keeps it (`dqExpiresNext.js`, the rule in `shared/dqExpiry.js`): the earliest
 * `expirationDate` among records not removed, no field when none has one. A
 * record filed before then has it only once its DQ tab opens; this writes it,
 * so the dashboard's Needs attention sees those dates too.
 *
 * It reads each record's `dq_files` (dates and removal only), a page of records
 * at a time and several at once, so a run gets through many records within its
 * time budget. A record that disagrees is written by `refreshDqExpiresNext`, in
 * its own transaction with a fresh read, so a DQ change made since the check is
 * never overwritten. The DQ records themselves are left as they are.
 */
const { earliestExpiration, refreshDqExpiresNext } = require('../../shared/dqExpiry');
const { companyIds, forEachPage } = require('./shared');

const COLLECTIONS = Object.freeze(['applications', 'leads']);
/** How many records' DQ files are read at once. */
const PARALLEL = 20;

async function eachInParallel(items, task) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await task(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
    return results;
}

/** Whether the record's stored date differs from its DQ file's earliest. */
async function disagrees(doc) {
    const files = await doc.ref.collection('dq_files').select('expirationDate', 'removedAt').get();
    return (doc.data()?.dqExpiresNext ?? null) !== earliestExpiration(files.docs.map((file) => file.data()));
}

async function sweep(ctx) {
    const counts = { applications: 0, leads: 0 };
    for (const companyId of await companyIds(ctx.db)) {
        for (const collectionName of COLLECTIONS) {
            const records = ctx.db.collection('companies').doc(companyId).collection(collectionName).select('dqExpiresNext');
            const finished = await forEachPage(ctx, records, async (docs) => {
                const differs = await eachInParallel(docs, disagrees);
                for (const doc of docs.filter((_, index) => differs[index])) {
                    if (!ctx.apply || await refreshDqExpiresNext(doc.ref)) counts[collectionName] += 1;
                }
            });
            if (!finished) return { done: false, counts };
        }
    }
    return { done: true, counts };
}

module.exports = { sweep };
