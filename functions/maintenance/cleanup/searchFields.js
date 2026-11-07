/**
 * Data cleanup → application search fields: the normalized name, email, phone,
 * confirmation number and application id that search reads, written on every
 * application where one is missing or out of date. The rule is the one a
 * submission writes (`shared/searchNormalization.js`); this reads only the
 * fields it needs and stops at the time budget.
 *
 * Applications only. Leads get no search fields from any writer, and
 * `searchName` has no writer at all, so neither is added here.
 */
const { buildApplicationSearchFields } = require('../../shared/searchNormalization');
const { createWriter, forEachCompanyRecord } = require('./shared');

/** The fields an application's search fields are built from. */
const SEARCH_SOURCE_FIELDS = Object.freeze([
    'firstName', 'lastName', 'email', 'phone', 'phoneNumber', 'confirmationNumber', 'applicationId',
]);
/** Every field the two lists name: what a read needs to decide. */
const SEARCH_READ_FIELDS = Object.freeze([
    ...SEARCH_SOURCE_FIELDS, ...Object.keys(buildApplicationSearchFields({})),
]);

/**
 * The search fields to merge into an application, or null when every one
 * already holds its value.
 */
function applicationSearchFieldsUpdate(docSnap) {
    const data = docSnap.data() || {};
    const fields = buildApplicationSearchFields({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone || data.phoneNumber,
        confirmationNumber: data.confirmationNumber,
        applicationId: data.applicationId || docSnap.id,
    });
    return Object.entries(fields).some(([key, value]) => data[key] !== value) ? fields : null;
}

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
