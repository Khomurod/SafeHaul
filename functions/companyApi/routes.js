/**
 * What the company API answers, route by route (version 1, read-only).
 *
 *   GET /v1/key                              the key itself: name, company, permissions
 *   GET /v1/submissions?since=&cursor=&limit= submissions in the order they arrived
 *   GET /v1/applications/{id}?version=       one application, from its frozen record
 *   GET /v1/applications/{id}/documents      links to its uploaded files
 *   GET /v1/applications/{id}/pdf            a link to its preserved PDF
 *
 * Each route names the permissions it needs; `http.js` checks them before the
 * handler runs. A handler returns `{ body, audit }` or throws an `ApiError`.
 * Every read is of the key's own company: the company id comes from the key,
 * never from the request, so another company's application is simply not found.
 */

const { admin, db, storage } = require('../firebaseAdmin');
const { decodeStoredSnapshot } = require('../shared/submissionSnapshotStorage');
const { originalPdfPath } = require('../shared/preserveApplicationPdf');
const { LINK_TTL_MS } = require('./apiKeys');
const { ApiError } = require('./apiAuth');
const { documentsFor, documentsOf, toApiApplication } = require('./applicationView');

const ID = '([A-Za-z0-9_-]{1,64})';
const VERSION = /^v[1-9][0-9]{0,2}$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/**
 * A record is listed once it is this old. A submission stamps its time just
 * before writing its record, inside a 30-second function, so by then every
 * record stamped earlier is written, and a cursor never passes one still on
 * its way.
 */
const SETTLE_MS = 60 * 1000;

/** The first value of a query parameter, when it is a string. */
const param = (query, name) => {
    const value = Array.isArray(query?.[name]) ? query[name][0] : query?.[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const badRequest = (message) => new ApiError(400, 'bad_request', message);
const notFound = (message = 'Application not found.') => new ApiError(404, 'not_found', message);

function applicationRef(companyId, applicationId) {
    return db.collection('companies').doc(companyId).collection('applications').doc(applicationId);
}

/** Where the paging left off, as a caller carries it: opaque, and only ever this company's. */
function encodeCursor({ submittedAt, applicationId, version }) {
    return Buffer.from(JSON.stringify({ s: submittedAt, a: applicationId, v: version })).toString('base64url');
}

function decodeCursor(text) {
    try {
        const { s, a, v } = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
        if (typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(a) && VERSION.test(v)) {
            return { submittedAt: s, applicationId: a, version: v };
        }
    } catch {
        // Falls through to the refusal below.
    }
    throw badRequest('cursor is not one this API returned.');
}

/** The record asked for (`version`), or the application's latest. Null when it has none. */
async function submissionRecord(ref, version) {
    if (version) {
        const snap = await ref.collection('submission').doc(version).get();
        return snap.exists ? snap : null;
    }
    const latest = await ref.collection('submission').orderBy('sequence', 'desc').limit(1).get();
    return latest.empty ? null : latest.docs[0];
}

/** The application and its record, or a refusal saying which one is missing. */
async function loadApplication(ctx, applicationId, query) {
    const version = param(query, 'version');
    if (version && !VERSION.test(version)) throw badRequest('version must look like v1, v2 and so on.');
    const ref = applicationRef(ctx.companyId, applicationId);
    const [applicationSnap, recordSnap] = await Promise.all([ref.get(), submissionRecord(ref, version)]);
    if (!applicationSnap.exists) throw notFound();
    if (!recordSnap || recordSnap.data()?.companyId !== ctx.companyId) {
        throw notFound(version ? `This application has no submission ${version}.` : 'This application has no submitted record.');
    }
    return {
        application: applicationSnap.data() || {},
        snapshot: decodeStoredSnapshot(recordSnap.data()),
        version: recordSnap.id,
    };
}

/** A safe `filename=` for a download: no quotes, slashes or line breaks. */
function attachment(name) {
    const safe = String(name || 'download').replace(/["\\/\r\n]/g, '_').slice(0, 150);
    return `attachment; filename="${safe}"`;
}

async function signedLink(path, name) {
    const expires = Date.now() + LINK_TTL_MS;
    const [url] = await storage.bucket().file(path).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires,
        responseDisposition: attachment(name),
    });
    return { url, expiresAt: new Date(expires).toISOString() };
}

async function keyInfo(ctx) {
    return {
        body: {
            keyId: ctx.keyId,
            name: ctx.name,
            permissions: ctx.scopes,
            company: { id: ctx.companyId, name: ctx.companyName },
        },
    };
}

async function listSubmissions(ctx, _params, query) {
    const limitText = param(query, 'limit');
    const limit = limitText === null ? DEFAULT_LIMIT : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw badRequest(`limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    const sinceText = param(query, 'since');
    const since = sinceText === null ? null : new Date(sinceText);
    if (since && Number.isNaN(since.getTime())) throw badRequest('since must be a date and time, such as 2026-10-01T00:00:00Z.');
    const cursorText = param(query, 'cursor');
    const cursor = cursorText === null ? null : decodeCursor(cursorText);

    let search = db.collectionGroup('submission').where('companyId', '==', ctx.companyId);
    if (since) search = search.where('submittedAt', '>=', since.toISOString());
    search = search
        .where('submittedAt', '<=', new Date(Date.now() - SETTLE_MS).toISOString())
        .orderBy('submittedAt')
        .orderBy(admin.firestore.FieldPath.documentId());
    if (cursor) {
        const after = applicationRef(ctx.companyId, cursor.applicationId).collection('submission').doc(cursor.version);
        search = search.startAfter(cursor.submittedAt, after);
    }
    const snap = await search.limit(limit + 1).get();

    const submissions = snap.docs.slice(0, limit).map((doc) => {
        const data = doc.data() || {};
        return {
            applicationId: data.applicationId,
            version: doc.id,
            isOriginal: doc.id === 'v1',
            submittedAt: data.submittedAt || null,
        };
    });
    const last = submissions[submissions.length - 1];
    return {
        body: {
            submissions,
            // Kept by the caller and sent back next time, it returns only what arrived since.
            nextCursor: last ? encodeCursor(last) : cursorText,
            hasMore: snap.docs.length > limit,
        },
    };
}

async function getApplication(ctx, [applicationId], query) {
    const { application, snapshot, version } = await loadApplication(ctx, applicationId, query);
    const body = toApiApplication({ snapshot, application, applicationId, version, companyId: ctx.companyId, scopes: ctx.scopes });
    return { body, audit: { applicationId, version, ssnIncluded: body.ssnIncluded } };
}

async function getDocuments(ctx, [applicationId], query) {
    const { snapshot, version } = await loadApplication(ctx, applicationId, query);
    const shown = documentsFor(snapshot, ctx.companyId, ctx.scopes);
    const documents = await Promise.all(shown.map(async (item) => ({
        id: item.id,
        label: item.label,
        fileName: item.fileName,
        ...(await signedLink(item.storagePath, item.fileName)),
    })));
    // Named, so a caller knows a file exists that this key may not fetch.
    const withheld = documentsOf(snapshot, ctx.companyId)
        .filter((item) => !shown.some((visible) => visible.id === item.id))
        .map(({ id, label }) => ({ id, label, needs: 'ssn:read' }));
    return {
        body: { applicationId, version, documents, withheld },
        audit: { applicationId, version, documents: documents.length, ssnIncluded: documents.some((item) => item.id === 'ssc-upload') },
    };
}

async function getPdf(ctx, [applicationId], query) {
    const { version } = await loadApplication(ctx, applicationId, query);
    const path = originalPdfPath({ companyId: ctx.companyId, applicationId, snapshotId: version });
    const file = storage.bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) throw new ApiError(404, 'pdf_not_ready', 'The PDF of this submission has not been made yet. Try again later.');
    const [metadata] = await file.getMetadata();
    const fileName = metadata?.metadata?.safehaulFileName || 'Driver-Application.pdf';

    // The PDF shows the full SSN, so its every opening is in the application's
    // own history, as `getApplicationOriginalPdfUrl` records a person's.
    await applicationRef(ctx.companyId, applicationId).collection('activity_logs').add({
        action: 'Original Application PDF Accessed',
        details: `The API key "${ctx.name}" opened the preserved `
            + `${version === 'v1' ? 'original' : `resubmission (${version})`} application PDF, `
            + 'which contains the full Social Security Number.',
        type: 'security',
        companyId: ctx.companyId,
        performedBy: `api_key:${ctx.keyId}`,
        performedByName: `API key: ${ctx.name}`,
        accessRole: 'api',
        snapshotId: version,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
        body: { applicationId, version, fileName, ...(await signedLink(path, fileName)) },
        audit: { applicationId, version, documents: 1, ssnIncluded: true },
    };
}

/** Every route, with the permissions it needs. */
const ROUTES = Object.freeze([
    { name: 'GET /v1/key', pattern: /^\/v1\/key$/, scopes: ['applications:read'], handler: keyInfo },
    { name: 'GET /v1/submissions', pattern: /^\/v1\/submissions$/, scopes: ['applications:read'], handler: listSubmissions },
    { name: 'GET /v1/applications/:id', pattern: new RegExp(`^/v1/applications/${ID}$`), scopes: ['applications:read'], handler: getApplication },
    {
        name: 'GET /v1/applications/:id/documents',
        pattern: new RegExp(`^/v1/applications/${ID}/documents$`),
        scopes: ['applications:read', 'documents:read'],
        handler: getDocuments,
    },
    {
        name: 'GET /v1/applications/:id/pdf',
        pattern: new RegExp(`^/v1/applications/${ID}/pdf$`),
        scopes: ['applications:read', 'documents:read', 'ssn:read'],
        handler: getPdf,
    },
]);

/** The route a path names, with its captured ids; null for none. */
function matchRoute(path) {
    const clean = String(path || '/').replace(/\/+$/, '') || '/';
    for (const route of ROUTES) {
        const match = route.pattern.exec(clean);
        if (match) return { route, params: match.slice(1) };
    }
    return null;
}

module.exports = { ROUTES, SETTLE_MS, decodeCursor, encodeCursor, matchRoute };
