/**
 * A small document store for the signing-reminder suites (`remindSigner.test.js`,
 * `remindUnsignedSigners.test.js`), the automatic post-application send
 * (`autoSendPostApplicationForms.test.js`) and the DQ deadline notices
 * (`notifyDqExpiry.test.js`): Firestore as those functions use it, read and
 * written by path.
 *
 * - A stored timestamp is `{ ms }`, and reads back with the `toMillis` a
 *   Firestore Timestamp has; `FieldValue.delete()` removes a field.
 * - `create` refuses a document that exists (`ALREADY_EXISTS`, code 6), and
 *   `getAll` reads several documents at once, as the Admin SDK's do.
 * - A transaction applies its writes only when its function returns, so a
 *   refusal thrown inside writes nothing. One whose documents another write
 *   changed after it read them runs again, as Firestore's do, so two runs that
 *   overlap see each other's claims.
 * - A collection answers `where` (`==`, `in`, `<`, `<=`, `>`, `>=`), `orderBy`,
 *   `select` and `limit`, leaving out a document without the field, as an
 *   index does. Each query is noted in `queried`, and the fields it filters and
 *   orders on in `queries`; one on a collection in `failingQueries` fails.
 *
 * `jest.mock` is hoisted per file, so each suite keeps its own line,
 * `jest.mock('../../firebaseAdmin', () => require('./signingRequestStore.support').firebaseAdminMock())`,
 * and the body lives here. Jest gives every test file its own module registry,
 * so each suite starts from an empty store; `reset()` empties it between tests.
 */

const docs = new Map();
const queried = [];
const queries = [];
const failingQueries = new Set();
const deleteField = Symbol('delete');

function revive(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(revive);
    const keys = Object.keys(value);
    if (keys.length === 1 && typeof value.ms === 'number') return { ms: value.ms, toMillis: () => value.ms };
    return Object.fromEntries(keys.map((key) => [key, revive(value[key])]));
}

function snapshot(path) {
    const data = docs.get(path);
    return {
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : revive(structuredClone(data))),
        get: (field) => data?.[field],
    };
}

// What a write stores: a timestamp read back (`toMillis`) is stored as `{ ms }` again.
function stored(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stored);
    if (typeof value.toMillis === 'function') return { ms: value.toMillis() };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stored(item)]));
}

function update(path, changes) {
    if (!docs.has(path)) throw new Error(`No document to update: ${path}`);
    const doc = structuredClone(docs.get(path));
    for (const [key, value] of Object.entries(changes)) {
        const parts = key.split('.');
        const leaf = parts.pop();
        let target = doc;
        for (const part of parts) {
            target[part] = { ...target[part] };
            target = target[part];
        }
        if (value === deleteField) delete target[leaf];
        else target[leaf] = stored(value);
    }
    docs.set(path, doc);
}

/** A value as a query compares it: a timestamp or a date by its milliseconds. */
function comparable(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (value && typeof value === 'object' && typeof value.ms === 'number') return value.ms;
    return value;
}

/** Numbers and strings (a `YYYY-MM-DD` day) in their order. */
const ascending = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const MATCHES = {
    '==': (field, value) => field === value,
    'in': (field, value) => value.includes(field),
    '<': (field, value) => field < value,
    '<=': (field, value) => field <= value,
    '>': (field, value) => field > value,
    '>=': (field, value) => field >= value,
};

function query(collectionPath, { filters = [], order = null, fields = null, max = null } = {}) {
    const refine = (change) => query(collectionPath, { filters, order, fields, max, ...change });
    return {
        where: (field, op, value) => refine({ filters: [...filters, [field, op, value]] }),
        orderBy: (field, direction = 'asc') => refine({ order: [field, direction] }),
        select: (...names) => refine({ fields: names }),
        limit: (count) => refine({ max: count }),
        get: async () => {
            queried.push(collectionPath);
            queries.push({ path: collectionPath, fields: [...new Set([...filters.map(([field]) => field), ...(order ? [order[0]] : [])])] });
            if (failingQueries.has(collectionPath)) throw Object.assign(new Error('unavailable (artificial)'), { code: 14 });
            const depth = collectionPath.split('/').length + 1;
            let found = [...docs.keys()]
                .filter((path) => path.startsWith(`${collectionPath}/`) && path.split('/').length === depth)
                .map((path) => ({ path, data: revive(structuredClone(docs.get(path))) }))
                .filter(({ data }) => filters.every(([field, op, value]) => (
                    data[field] !== undefined && MATCHES[op](comparable(data[field]), op === 'in' ? value : comparable(value))
                )));
            if (order) {
                const [field, direction] = order;
                found = found.filter(({ data }) => data[field] !== undefined)
                    .sort((a, b) => ascending(comparable(a.data[field]), comparable(b.data[field])) * (direction === 'desc' ? -1 : 1));
            }
            if (max !== null) found = found.slice(0, max);
            const results = found.map(({ path, data }) => ({
                id: path.split('/').pop(),
                ref: ref(path),
                exists: true,
                data: () => (fields ? Object.fromEntries(fields.filter((name) => name in data).map((name) => [name, data[name]])) : data),
            }));
            return { docs: results, empty: results.length === 0, size: results.length };
        },
    };
}

function collection(path) {
    return { ...query(path), doc: (id) => ref(`${path}/${id}`) };
}

function ref(path) {
    return {
        path,
        id: path.split('/').pop(),
        collection: (name) => collection(`${path}/${name}`),
        get: async () => snapshot(path),
        set: async (data) => docs.set(path, structuredClone(data)),
        create: async (data) => {
            if (docs.has(path)) throw Object.assign(new Error(`6 ALREADY_EXISTS: ${path}`), { code: 6 });
            docs.set(path, structuredClone(data));
        },
        update: async (data) => update(path, data),
    };
}

/** Runs `fn` as a transaction: its writes apply when it returns, once nothing it read has changed. */
async function runTransaction(fn) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const seen = new Map();
        const writes = [];
        const result = await fn({
            get: async (doc) => {
                if (!seen.has(doc.path)) seen.set(doc.path, docs.get(doc.path));
                return snapshot(doc.path);
            },
            set: (doc, data) => writes.push(() => docs.set(doc.path, structuredClone(data))),
            update: (doc, data) => writes.push(() => update(doc.path, data)),
        });
        if ([...seen].every(([path, value]) => docs.get(path) === value)) {
            writes.forEach((write) => write());
            return result;
        }
    }
    throw new Error('The transaction kept meeting newer writes (artificial contention)');
}

function firebaseAdminMock() {
    const db = { runTransaction, collection, getAll: (...refs) => Promise.all(refs.map((doc) => doc.get())) };
    const firestore = Object.assign(() => db, {
        FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => deleteField },
        Timestamp: { fromMillis: (ms) => ({ ms }), now: () => ({ ms: Date.now() }) },
    });
    return { admin: { firestore }, db };
}

function reset() {
    docs.clear();
    queried.length = 0;
    queries.length = 0;
    failingQueries.clear();
}

module.exports = { docs, queried, queries, failingQueries, revive, ref, update, firebaseAdminMock, reset };
