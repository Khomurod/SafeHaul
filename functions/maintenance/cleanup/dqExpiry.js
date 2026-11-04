/**
 * Data cleanup → DQ valid-until dates: `dqExpiresNext` on every application and
 * lead whose DQ file disagrees with it. Since the field exists the DQ trigger
 * keeps it (`dqExpiresNext.js`, the rule in `shared/dqExpiry.js`): the earliest
 * `expirationDate` among records not removed, no field when none has one. A
 * record filed before then has it only once its DQ tab opens; this writes it,
 * so the dashboard's Needs attention sees those dates too.
 *
 * It reads each record's `dq_files` (dates and removal only) and writes the
 * record alone, only where the value differs; the DQ records are left as they are.
 */
const { earliestExpiration } = require('../../shared/dqExpiry');
const { createWriter, forEachCompanyRecord } = require('./shared');

const COLLECTIONS = Object.freeze(['applications', 'leads']);

async function sweep(ctx) {
    const counts = { applications: 0, leads: 0 };
    const writer = createWriter(ctx.db, ctx.apply);
    let done = true;
    for (const collectionName of COLLECTIONS) {
        done = await forEachCompanyRecord(ctx, collectionName, ['dqExpiresNext'], async (doc) => {
            const files = await doc.ref.collection('dq_files').select('expirationDate', 'removedAt').get();
            const next = earliestExpiration(files.docs.map((file) => file.data()));
            if ((doc.data()?.dqExpiresNext ?? null) === next) return;
            counts[collectionName] += 1;
            await writer.update(doc.ref, { dqExpiresNext: next ?? ctx.FieldValue.delete() });
        });
        if (!done) break;
    }
    await writer.flush();
    return { done, counts };
}

module.exports = { sweep };
