/**
 * Data cleanup → application search fields: the normalized name, email, phone,
 * confirmation number and application id that search reads, written on every
 * application where one is missing or out of date. The rule is
 * `backfillApplicationSearchFields`'s (`searchFieldsBackfill.js`), the same as
 * a submission writes; this reads only the fields it needs and stops at the
 * time budget.
 *
 * Applications only. Leads get no search fields from any writer, and
 * `searchName` has no writer at all, so neither is added here.
 */
const { applicationSearchFieldsUpdate, SEARCH_READ_FIELDS } = require('../../searchFieldsBackfill');
const { createWriter, forEachCompanyRecord } = require('./shared');

async function sweep(ctx) {
    const counts = { applications: 0 };
    const writer = createWriter(ctx.db, ctx.apply);
    const done = await forEachCompanyRecord(ctx, 'applications', SEARCH_READ_FIELDS, async (doc) => {
        const fields = applicationSearchFieldsUpdate(doc);
        if (!fields) return;
        counts.applications += 1;
        await writer.set(doc.ref, fields, { merge: true });
    });
    await writer.flush();
    return { done, counts };
}

module.exports = { sweep };
