/**
 * What every data-cleanup item shares: reading a collection page by page in
 * document order, writing in batches, and the list of companies.
 *
 * Every item selects by the data's current state, so a run that stops at the
 * time budget leaves nothing half-done that the next run cannot find again.
 */

/** Documents read per page. */
const PAGE_SIZE = 500;
/** Writes per batch, under Firestore's 500. */
const BATCH_LIMIT = 400;

/**
 * Calls `onPage(docs)` for each page of `query`, in document order. Resolves
 * true when every page was read, false when the time ran out first.
 *
 * @param {object} ctx the item's context (`FieldPath`, `outOfTime`)
 * @param {object} query a Firestore query or collection
 * @param {(docs: object[]) => Promise<void>} onPage
 */
async function forEachPage(ctx, query, onPage) {
    let last = null;
    for (;;) {
        if (ctx.outOfTime()) return false;
        let page = query.orderBy(ctx.FieldPath.documentId()).limit(PAGE_SIZE);
        if (last) page = page.startAfter(last);
        const snap = await page.get();
        if (snap.docs.length === 0) return true;
        await onPage(snap.docs);
        if (snap.docs.length < PAGE_SIZE) return true;
        last = snap.docs[snap.docs.length - 1];
    }
}

/**
 * Batched writes, committed every `BATCH_LIMIT` operations. Without `apply` it
 * writes nothing at all, so a check and a run walk the same code.
 *
 * @param {object} db
 * @param {boolean} apply
 */
function createWriter(db, apply) {
    let batch = apply ? db.batch() : null;
    let pending = 0;

    const add = async (operation) => {
        if (!apply) return;
        operation(batch);
        pending += 1;
        if (pending >= BATCH_LIMIT) await flush();
    };
    const flush = async () => {
        if (!apply || pending === 0) return;
        await batch.commit();
        batch = db.batch();
        pending = 0;
    };

    return {
        update: (ref, data) => add((b) => b.update(ref, data)),
        set: (ref, data, options) => add((b) => b.set(ref, data, options)),
        delete: (ref) => add((b) => b.delete(ref)),
        flush,
    };
}

/** Every company's id, without reading the documents. */
async function companyIds(db) {
    const snap = await db.collection('companies').select().get();
    return snap.docs.map((doc) => doc.id);
}

/**
 * Walks `collectionName` of every company, page by page. Resolves true when
 * every company was read.
 */
async function forEachCompanyRecord(ctx, collectionName, fields, onDoc) {
    for (const companyId of await companyIds(ctx.db)) {
        const query = ctx.db.collection('companies').doc(companyId).collection(collectionName).select(...fields);
        const finished = await forEachPage(ctx, query, async (docs) => {
            for (const doc of docs) await onDoc(doc, companyId);
        });
        if (!finished) return false;
    }
    return true;
}

/** The value at a dotted path of plain data, or undefined. */
function readPath(data, dotted) {
    return dotted.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data);
}

const has = (object, key) => Boolean(object) && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);

module.exports = { BATCH_LIMIT, PAGE_SIZE, companyIds, createWriter, forEachCompanyRecord, forEachPage, has, readPath };
