/**
 * An in-memory Firestore, Auth and Storage for the `dataCleanup` suites.
 *
 * It does what the cleanup items ask of the real ones and refuses the rest:
 * collection and collection-group queries with `==`, `>=`, `<` and `in`,
 * `select` (a projection, so code that reads a field it did not select sees
 * nothing, as it would in production), document-order paging with
 * `startAfter`, `listDocuments` (missing parents included), batches,
 * transactions whose writes land when the handler returns, `recursiveDelete`,
 * Auth's `listUsers`/`deleteUsers` and a bucket's `getFiles`.
 *
 * Every write is counted in `world.writes`, so a suite can say that a check or
 * a second run wrote nothing. `world.afterQuery`, when a suite sets it, sees
 * each query's result: a suite moves its clock there.
 *
 * `jest.mock` is hoisted per file, so each suite registers its own line and the
 * factories live here, closing over one world the suite resets.
 *
 * Every name, address, phone number and id below is artificial.
 */
const { assertStorableValue } = require('../helpers/firestoreValueRules');

const DELETE = Object.freeze({ __delete: true });
const SERVER_TIME = '__server_timestamp__';
const DOC_ID = Object.freeze({ __documentId: true });

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    return value;
}

function readPath(data, dotted) {
    return dotted.split('.').reduce((value, key) => (isPlainObject(value) ? value[key] : undefined), data);
}

function writePath(target, dotted, value) {
    const keys = dotted.split('.');
    let cursor = target;
    for (const key of keys.slice(0, -1)) {
        if (!isPlainObject(cursor[key])) cursor[key] = {};
        cursor = cursor[key];
    }
    const last = keys[keys.length - 1];
    if (value === DELETE) delete cursor[last];
    else cursor[last] = clone(value);
}

function deepMerge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (value === DELETE) delete target[key];
        else if (isPlainObject(value) && isPlainObject(target[key])) deepMerge(target[key], value);
        else target[key] = clone(value);
    }
    return target;
}

function project(data, fields) {
    if (!fields) return clone(data);
    const out = {};
    for (const field of fields) {
        const value = readPath(data, field);
        if (value !== undefined) writePath(out, field, value);
    }
    return out;
}

const parentOf = (path) => path.split('/').slice(0, -1).join('/');
const lastSegment = (path) => path.split('/').pop();

function compare(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function matches(value, op, expected) {
    if (value === undefined) return false;
    switch (op) {
        case '==': return value === expected;
        case '>=': return typeof value === typeof expected && value >= expected;
        case '<': return typeof value === typeof expected && value < expected;
        case 'in': return expected.includes(value);
        default: throw new Error(`The cleanup double does not support "${op}".`);
    }
}

function createWorld() {
    const docs = new Map();
    const authUsers = new Map();
    const files = new Set();
    const world = { docs, authUsers, files, writes: 0, log: [], audit: [] };

    const record = (op, path) => {
        world.writes += 1;
        world.log.push(`${op} ${path}`);
    };

    const applySet = (path, data, options) => {
        assertStorableValue(data, path);
        const next = options?.merge ? deepMerge(clone(docs.get(path) || {}), data) : deepMerge({}, data);
        docs.set(path, next);
        record('set', path);
    };
    const applyUpdate = (path, data) => {
        assertStorableValue(data, path);
        if (!docs.has(path)) {
            const error = new Error(`5 NOT_FOUND: No document to update: ${path}`);
            error.code = 5;
            throw error;
        }
        const next = clone(docs.get(path));
        for (const [key, value] of Object.entries(data)) writePath(next, key, value);
        docs.set(path, next);
        record('update', path);
    };
    const applyDelete = (path) => {
        docs.delete(path);
        record('delete', path);
    };

    function snapshot(path, fields) {
        const data = docs.get(path);
        return {
            id: lastSegment(path),
            ref: docRef(path),
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : project(data, fields)),
        };
    }

    function docRef(path) {
        return {
            path,
            id: lastSegment(path),
            get: async () => snapshot(path),
            set: async (data, options) => applySet(path, data, options),
            update: async (data) => applyUpdate(path, data),
            delete: async () => applyDelete(path),
            collection: (name) => collectionRef(`${path}/${name}`),
        };
    }

    function query(source, state = { filters: [], fields: null, ordered: false, limit: null, after: null }) {
        const next = (change) => query(source, { ...state, ...change });
        return {
            where: (field, op, value) => next({ filters: [...state.filters, { field, op, value }] }),
            select: (...fields) => next({ fields }),
            orderBy: (field) => {
                if (field !== DOC_ID) throw new Error('The cleanup double orders by document id only.');
                return next({ ordered: true });
            },
            limit: (count) => next({ limit: count }),
            startAfter: (snap) => {
                if (!state.ordered) throw new Error('startAfter needs orderBy first.');
                return next({ after: snap.ref.path });
            },
            get: async () => {
                let paths = [...docs.keys()].filter(source).sort(compare);
                for (const { field, op, value } of state.filters) {
                    paths = paths.filter((path) => matches(
                        field === DOC_ID ? lastSegment(path) : readPath(docs.get(path), field), op, value));
                }
                if (state.after) paths = paths.filter((path) => path > state.after);
                if (state.limit !== null) paths = paths.slice(0, state.limit);
                const snaps = paths.map((path) => snapshot(path, state.fields));
                world.afterQuery?.(snaps);
                return { docs: snaps, size: snaps.length, empty: snaps.length === 0 };
            },
        };
    }

    function collectionRef(path) {
        return {
            path,
            id: lastSegment(path),
            doc: (id) => docRef(`${path}/${id}`),
            // Only the audit trail adds documents. Its records are kept apart
            // from `writes`, which counts what the cleanup changed.
            add: async (data) => {
                assertStorableValue(data, path);
                world.audit.push({ collection: path, ...clone(data) });
            },
            listDocuments: async () => {
                const ids = new Set();
                for (const docPath of docs.keys()) {
                    if (docPath.startsWith(`${path}/`)) ids.add(docPath.slice(path.length + 1).split('/')[0]);
                }
                return [...ids].sort().map((id) => docRef(`${path}/${id}`));
            },
            ...query((docPath) => parentOf(docPath) === path),
        };
    }

    const db = {
        collection: (path) => collectionRef(path),
        collectionGroup: (name) => query((docPath) => {
            const segments = docPath.split('/');
            return segments.length >= 2 && segments[segments.length - 2] === name;
        }),
        batch: () => {
            const ops = [];
            return {
                set: (ref, data, options) => ops.push(() => applySet(ref.path, data, options)),
                update: (ref, data) => ops.push(() => applyUpdate(ref.path, data)),
                delete: (ref) => ops.push(() => applyDelete(ref.path)),
                commit: async () => ops.splice(0).forEach((op) => op()),
            };
        },
        runTransaction: async (handler) => {
            const ops = [];
            const transaction = {
                get: async (ref) => snapshot(ref.path),
                set: (ref, data, options) => ops.push(() => applySet(ref.path, data, options)),
                update: (ref, data) => ops.push(() => applyUpdate(ref.path, data)),
            };
            const result = await handler(transaction);
            ops.forEach((op) => op());
            return result;
        },
        recursiveDelete: async (ref) => {
            for (const path of [...docs.keys()]) {
                if (path === ref.path || path.startsWith(`${ref.path}/`)) applyDelete(path);
            }
        },
        settings: () => {},
    };

    const auth = {
        listUsers: async (max, pageToken) => {
            const all = [...authUsers.values()].sort((a, b) => compare(a.uid, b.uid));
            const start = pageToken ? Number(pageToken) : 0;
            const users = all.slice(start, start + max).map(clone);
            return { users, pageToken: start + max < all.length ? String(start + max) : undefined };
        },
        deleteUsers: async (uids) => {
            for (const uid of uids) {
                authUsers.delete(uid);
                record('deleteUser', uid);
            }
            return { successCount: uids.length, failureCount: 0, errors: [] };
        },
    };

    const bucket = {
        getFiles: async ({ prefix }) => [[...files].filter((name) => name.startsWith(prefix)).sort().map((name) => ({
            name,
            delete: async () => {
                files.delete(name);
                record('deleteFile', name);
            },
        }))],
    };

    const admin = {
        firestore: Object.assign(() => db, {
            FieldValue: { delete: () => DELETE, serverTimestamp: () => SERVER_TIME },
            FieldPath: { documentId: () => DOC_ID },
        }),
        auth: () => auth,
        storage: () => ({ bucket: () => bucket }),
    };

    /** Replaces the whole world in place; the modules under test closed over it at require time. */
    world.reset = ({ firestore = {}, users = [], storage = [] } = {}) => {
        docs.clear();
        for (const [path, data] of Object.entries(firestore)) docs.set(path, clone(data));
        authUsers.clear();
        for (const user of users) authUsers.set(user.uid, clone(user));
        files.clear();
        for (const name of storage) files.add(name);
        world.writes = 0;
        world.log = [];
        world.audit = [];
        world.afterQuery = null;
    };
    world.doc = (path) => docs.get(path);
    world.firebaseAdmin = { admin, db, auth, storage: { bucket: () => bucket } };
    return world;
}

const world = createWorld();

const httpsMock = () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
});

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);
const SUPER_ADMIN = () => ({ uid: 'owner-uid', token: { globalRole: 'super_admin', auth_time: NOW_SECONDS() } });
const request = (data, auth = SUPER_ADMIN()) => ({ auth, data });

module.exports = { DELETE, SERVER_TIME, SUPER_ADMIN, httpsMock, request, world };
