/**
 * Data cleanup → old lead fields, written the way current screens write them:
 *
 * - `assignedTo`: an unassigned lead stores `''`, which the Unassigned filter
 *   asks for. Older leads hold `null` (imports) or nothing (Quick Add,
 *   Facebook) and are not found there.
 * - `normalizedPhone`: the lead import's duplicate check looks leads up by it.
 *   A lead with a phone and no value gets the digits the import writes
 *   (`normalizeSearchPhone`, the same as the browser's `normalizePhone`).
 * - `driverType`: the dashboard filter asks for a string. A list of one becomes
 *   that string and an empty list `''`, on leads and applications. A list of
 *   several is left as it is and only counted: choosing one would lose the
 *   others, so that is the owner's decision.
 *
 * Applications keep their own `assignedTo` and phone fields; only `driverType`
 * is changed on them. The lead triggers fire on these writes and do nothing:
 * an empty `assignedTo` notifies nobody, and the contact SMS needs a status
 * change.
 */
const { normalizeSearchPhone } = require('../../shared/searchNormalization');
const { createWriter, forEachCompanyRecord } = require('./shared');

/** How many record paths with several driver types the result names. */
const EXAMPLE_LIMIT = 20;

/** `{ value }` to write for a list driver type, `{ several: true }` to leave, or null. */
function driverTypeFix(value) {
    if (!Array.isArray(value)) return null;
    if (value.length === 0) return { value: '' };
    if (value.length === 1 && typeof value[0] === 'string') return { value: value[0] };
    return { several: true };
}

const isBlank = (value) => value === undefined || value === null || value === '';

function leadPatch(data, patch) {
    if (data.assignedTo === undefined || data.assignedTo === null) patch.assignedTo = '';
    if (isBlank(data.normalizedPhone) && !isBlank(data.phone)) {
        const digits = normalizeSearchPhone(data.phone);
        if (digits) patch.normalizedPhone = digits;
    }
}

async function sweep(ctx) {
    const counts = { assignedTo: 0, normalizedPhone: 0, driverType: 0, driverTypeSeveral: 0 };
    const examples = [];
    const writer = createWriter(ctx.db, ctx.apply);

    const visit = (isLead) => async (doc) => {
        const data = doc.data() || {};
        const patch = {};
        if (isLead) leadPatch(data, patch);
        const type = driverTypeFix(data.driverType);
        if (type?.several) {
            counts.driverTypeSeveral += 1;
            if (examples.length < EXAMPLE_LIMIT) examples.push(doc.ref.path);
        } else if (type) patch.driverType = type.value;
        for (const key of Object.keys(patch)) counts[key] += 1;
        if (Object.keys(patch).length > 0) await writer.update(doc.ref, patch);
    };

    let done = await forEachCompanyRecord(ctx, 'leads',
        ['assignedTo', 'phone', 'normalizedPhone', 'driverType'], visit(true));
    if (done) done = await forEachCompanyRecord(ctx, 'applications', ['driverType'], visit(false));
    await writer.flush();
    return { done, counts, ...(examples.length ? { notes: { driverTypeSeveral: examples } } : {}) };
}

module.exports = { sweep, driverTypeFix };
