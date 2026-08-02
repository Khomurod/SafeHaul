/**
 * Minimal in-memory Firestore double for the Environment & Integrations vault
 * suites.
 *
 * It implements only what the vault actually uses — document get/update with dot
 * paths and `FieldValue.delete()`, collection and collection-group reads,
 * `add`, `orderBy(...).limit(...)`, `select(...)`, and the transaction shape the
 * shared rate limiter needs. Everything else is deliberately absent so a test
 * that starts depending on unimplemented Firestore behaviour fails loudly rather
 * than passing against a fiction.
 */

const DELETE_SENTINEL = { __delete: true };

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = clone(inner);
    return out;
}

function setPath(target, dotted, value) {
    const segments = dotted.split('.');
    let cursor = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i];
        if (typeof cursor[segment] !== 'object' || cursor[segment] === null) cursor[segment] = {};
        cursor = cursor[segment];
    }
    const last = segments[segments.length - 1];
    if (value === DELETE_SENTINEL) {
        delete cursor[last];
        return;
    }
    // `FieldValue.increment` is what the shared rate limiter counts with, so a
    // mock that stored the sentinel verbatim would silently never rate-limit.
    if (value && typeof value === 'object' && typeof value.__increment === 'number') {
        cursor[last] = (typeof cursor[last] === 'number' ? cursor[last] : 0) + value.__increment;
        return;
    }
    cursor[last] = value;
}

/**
 * @param {Record<string, object>} seed Document path → document data.
 */
function createFirestoreMock(seed = {}) {
    /** @type {Map<string, object>} */
    const docs = new Map(Object.entries(clone(seed)));
    let autoId = 0;

    const snapshotFor = (path) => {
        const data = docs.get(path);
        const id = path.split('/').pop();
        return {
            id,
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : clone(data)),
            ref: makeDocRef(path),
        };
    };

    function makeDocRef(path) {
        return {
            path,
            id: path.split('/').pop(),
            get: async () => snapshotFor(path),
            // Deep-cloned before mutation: a shallow copy would let a caller's
            // earlier read of a nested object (`config`) observe a later write,
            // which real Firestore snapshots never do.
            set: async (data, options) => {
                const next = options && options.merge ? clone(docs.get(path) || {}) : {};
                for (const [key, value] of Object.entries(data)) setPath(next, key, value);
                docs.set(path, next);
            },
            update: async (data) => {
                if (!docs.has(path)) {
                    const error = new Error(`No document to update: ${path}`);
                    error.code = 5;
                    throw error;
                }
                const next = clone(docs.get(path));
                for (const [key, value] of Object.entries(data)) setPath(next, key, value);
                docs.set(path, next);
            },
            delete: async () => { docs.delete(path); },
            collection: (name) => makeCollectionRef(`${path}/${name}`),
        };
    }

    /** Documents that live directly under `prefix`. */
    const childrenOf = (prefix) => [...docs.keys()].filter((docPath) => {
        if (!docPath.startsWith(`${prefix}/`)) return false;
        return docPath.slice(prefix.length + 1).split('/').length === 1;
    });

    function makeQuery(paths) {
        const query = {
            get: async () => {
                const snapshots = paths.map(snapshotFor);
                return {
                    empty: snapshots.length === 0,
                    size: snapshots.length,
                    docs: snapshots,
                    forEach: (fn) => snapshots.forEach(fn),
                };
            },
            select: () => query,
            limit: (count) => makeQuery(paths.slice(0, count)),
            orderBy: () => query,
            where: () => query,
        };
        return query;
    }

    function makeCollectionRef(path) {
        return {
            path,
            doc: (id) => makeDocRef(`${path}/${id ?? `auto_${(autoId += 1)}`}`),
            add: async (data) => {
                const id = `auto_${(autoId += 1)}`;
                docs.set(`${path}/${id}`, clone(data));
                return makeDocRef(`${path}/${id}`);
            },
            ...makeQuery(childrenOf(path)),
        };
    }

    const collectionGroup = (name) => {
        const paths = [...docs.keys()].filter((docPath) => {
            const segments = docPath.split('/');
            return segments.length >= 2 && segments[segments.length - 2] === name;
        });
        return makeQuery(paths);
    };

    const db = {
        collection: (name) => makeCollectionRef(name),
        collectionGroup,
        runTransaction: async (handler) => {
            const transaction = {
                get: async (ref) => ref.get(),
                set: (ref, data, options) => { ref.set(data, options); },
                update: (ref, data) => { ref.update(data); },
            };
            return handler(transaction);
        },
        settings: () => {},
        /** Test-only access to the raw store. */
        __docs: docs,
    };

    /**
     * Repopulates the *same* store in place.
     *
     * Consumers destructure `{ admin, db }` at require time, so a fresh mock
     * object per test would never reach them. Mutating the store the already-
     * required modules closed over is what actually isolates the tests.
     */
    const reset = (nextSeed = {}) => {
        docs.clear();
        autoId = 0;
        for (const [docPath, data] of Object.entries(clone(nextSeed))) docs.set(docPath, data);
    };

    const admin = {
        firestore: Object.assign(() => db, {
            FieldValue: {
                serverTimestamp: () => '__server_timestamp__',
                delete: () => DELETE_SENTINEL,
                increment: (amount) => ({ __increment: amount }),
            },
            Timestamp: {
                now: () => ({ toMillis: () => Date.now() }),
                fromMillis: (millis) => ({ toMillis: () => millis }),
            },
        }),
        auth: () => ({ getUser: async () => ({ customClaims: {} }) }),
    };

    return { admin, db, docs, reset, DELETE_SENTINEL };
}

module.exports = { createFirestoreMock, DELETE_SENTINEL };
