/**
 * Shared harness for the `companyApi.*` suites: an in-memory Firestore with the
 * queries the API makes (equality and range filters, ordering by a field and by
 * document path, `startAfter`, `limit`, collection groups, transactions), a
 * Storage double that signs links without signing anything, and two companies
 * of made-up applications.
 *
 * `jest.mock` is hoisted per file, so each suite registers its own mocks with
 * the factories below; the store is built once here and reset in place, because
 * the modules under test destructure `{ admin, db, storage }` at require time.
 */

const { hashKey, mintKey } = require('../../companyApi/apiKeys');

const DOCUMENT_ID = { __documentId: true };
const docs = new Map();
const files = new Map();
/** Path prefixes whose writes fail, as an outage would. */
const failing = new Set();
let autoId = 0;

/**
 * Stored as Firestore would return it: the server's timestamp fields come back
 * as dates, and everything the record keeps as text (`submittedAt` and the
 * other ISO strings of a snapshot) stays text.
 */
const TIMESTAMPS = new Set(['at', 'createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt', 'timestamp']);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value), (key, inner) => (
    TIMESTAMPS.has(key) && typeof inner === 'string' ? new Date(inner) : inner)));

function snapshotOf(path) {
    const data = docs.get(path);
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => clone(data), ref: docRef(path) };
}

function docRef(path) {
    return {
        path,
        id: path.split('/').pop(),
        get: async () => snapshotOf(path),
        set: async (data, options) => {
            if ([...failing].some((prefix) => path.startsWith(prefix))) throw new Error(`Write refused: ${path}`);
            docs.set(path, { ...(options?.merge ? docs.get(path) : {}), ...clone(data) });
        },
        update: async (data) => {
            if (!docs.has(path)) throw Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
            docs.set(path, { ...docs.get(path), ...clone(data) });
        },
        collection: (name) => collectionRef(`${path}/${name}`),
    };
}

const valueAt = (path, field) => (field === DOCUMENT_ID ? path : docs.get(path)?.[field]);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function query(paths, steps = []) {
    const run = () => {
        let found = paths();
        const orders = [];
        let after = null;
        let limit = Infinity;
        for (const step of steps) {
            if (step.where) {
                const { field, op, value } = step.where;
                found = found.filter((path) => {
                    const actual = valueAt(path, field);
                    if (op === '==') return actual === value;
                    if (op === '>=') return actual !== undefined && actual >= value;
                    if (op === '<=') return actual !== undefined && actual <= value;
                    throw new Error(`Unsupported operator ${op}`);
                });
            }
            if (step.orderBy) orders.push(step.orderBy);
            if (step.startAfter) after = step.startAfter;
            if (step.limit) limit = step.limit;
        }
        found = found.filter((path) => orders.every(({ field }) => field === DOCUMENT_ID || valueAt(path, field) !== undefined));
        found.sort((x, y) => {
            for (const { field, direction } of orders) {
                const order = compare(valueAt(x, field), valueAt(y, field));
                if (order) return direction === 'desc' ? -order : order;
            }
            return 0;
        });
        if (after) {
            found = found.filter((path) => {
                for (let i = 0; i < orders.length; i += 1) {
                    const order = compare(valueAt(path, orders[i].field), after[i]);
                    if (order) return order > 0;
                }
                return false;
            });
        }
        return found.slice(0, limit).map(snapshotOf);
    };
    const next = (step) => query(paths, [...steps, step]);
    return {
        where: (field, op, value) => next({ where: { field, op, value } }),
        orderBy: (field, direction = 'asc') => next({ orderBy: { field, direction } }),
        startAfter: (...values) => next({ startAfter: values.map((value) => (value && value.path ? value.path : value)) }),
        limit: (count) => next({ limit: count }),
        get: async () => {
            const found = run();
            return { empty: found.length === 0, size: found.length, docs: found };
        },
    };
}

const childrenOf = (prefix) => () => [...docs.keys()].filter((path) => (
    path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/')
));

function collectionRef(path) {
    return {
        path,
        doc: (id) => docRef(`${path}/${id ?? `auto_${(autoId += 1)}`}`),
        add: async (data) => {
            const ref = docRef(`${path}/auto_${(autoId += 1)}`);
            await ref.set(data);
            return ref;
        },
        ...query(childrenOf(path)),
    };
}

const db = {
    collection: (name) => collectionRef(name),
    collectionGroup: (name) => query(() => [...docs.keys()].filter((path) => path.split('/').slice(-2)[0] === name)),
    runTransaction: async (handler) => handler({
        get: (target) => target.get(),
        set: (ref, data) => ref.set(data),
        update: (ref, data) => ref.update(data),
    }),
};

const admin = {
    firestore: Object.assign(() => db, {
        FieldValue: { serverTimestamp: () => new Date() },
        FieldPath: { documentId: () => DOCUMENT_ID },
    }),
};

const storage = {
    bucket: () => ({
        file: (path) => ({
            exists: async () => [files.has(path)],
            getMetadata: async () => [files.get(path) || {}],
            getSignedUrl: async ({ expires, responseDisposition }) => [
                `https://storage.example/${encodeURIComponent(path)}?expires=${expires}&disposition=${encodeURIComponent(responseDisposition)}`,
            ],
        }),
    }),
};

const firebaseAdminMock = () => ({ admin, db, storage });

function seedCompany(companyId, data = {}) {
    docs.set(`companies/${companyId}`, { companyName: `${companyId} Freight`, ...data });
}

/** A key of `companyId`, stored as `createCompanyApiKey` stores one; returns the key itself too. */
function seedKey(companyId, { scopes = ['applications:read'], revokedAt = null, lastUsedAt = null, name = 'TMS' } = {}) {
    const { keyId, key } = mintKey();
    docs.set(`company_api_keys/${keyId}`, clone({
        companyId, name, hash: hashKey(key), scopes, createdAt: new Date('2026-10-01T09:00:00Z'),
        createdBy: 'admin-uid', createdByName: 'Dana Admin', lastUsedAt, revokedAt, revokedBy: null, revokedByName: null,
    }));
    return { keyId, key };
}

/** A made-up application of `companyId`, with its frozen record `v{sequence}`. */
function seedApplication(companyId, applicationId, { sequence = 1, submittedAt, ssn = '412-88-7391', otherCompanyFile = false } = {}) {
    // Required here, not at the top: the admin mock is built from this file.
    const { buildApplicationDefinition } = require('../../shared/applicationDefinition');
    const { buildSubmissionSnapshot } = require('../../shared/submissionSnapshot');
    const { encodeSnapshotForStorage } = require('../../shared/submissionSnapshotStorage');
    const upload = (folder, name) => ({ name, storagePath: `companies/${otherCompanyFile ? 'co-other' : companyId}/${folder}/guest_uploads/1700000000000_ab12_${name}` });
    const formData = {
        firstName: 'Marcus', lastName: 'Delgado', ssn, dob: '1986-04-17',
        email: `${applicationId}@example.test`, phone: '(214) 555-0188',
        street: '812 Cottonwood Lane', city: 'Arlington', state: 'Texas', zip: '76010',
        employers: [{ companyName: 'Lone Star Logistics', position: 'OTR Driver', startDate: '2023-09', endDate: '2026-06', _localDraftId: 'internal-7712' }],
        'cdl-front': upload('applications', 'cdl-front.jpg'),
        'ssc-upload': upload('applications', 'ss-card.jpg'),
    };
    const definition = buildApplicationDefinition({ company: { companyName: `${companyId} Freight`, dotNumber: '3312998' } });
    const snapshot = buildSubmissionSnapshot({ definition, formData, submittedAt });
    docs.set(`companies/${companyId}/applications/${applicationId}`, {
        companyId, confirmationNumber: `CONF-${applicationId}`, status: 'New Application', ssn,
    });
    docs.set(`companies/${companyId}/applications/${applicationId}/submission/v${sequence}`, clone({
        ...encodeSnapshotForStorage(snapshot), companyId, applicationId, sequence,
    }));
}

function reset() {
    docs.clear();
    files.clear();
    failing.clear();
    autoId = 0;
}

const failWritesTo = (prefix) => failing.add(prefix);

/** A request as Express hands it to the function. */
function request({ method = 'GET', path, query = {}, key, ip = '203.0.113.7' } = {}) {
    const headers = key ? { authorization: `Bearer ${key}` } : {};
    return { method, path, query, headers, ip, get: (name) => headers[String(name).toLowerCase()] };
}

/** A response that keeps what was sent. */
function response() {
    const res = { statusCode: null, headers: {}, body: null };
    res.set = (name, value) => { res.headers[name] = value; return res; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = typeof body === 'string' ? JSON.parse(body) : body; return res; };
    return res;
}

const auditRecords = () => [...docs.entries()].filter(([path]) => path.startsWith('api_audit/')).map(([, data]) => data);

module.exports = {
    auditRecords, docs, failWritesTo, files, firebaseAdminMock, request, reset, response, seedApplication, seedCompany, seedKey,
};
