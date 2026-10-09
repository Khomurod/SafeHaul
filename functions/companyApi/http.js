/**
 * The company API: how another service reads a company's submitted
 * applications with one of its API keys (`keyCallables.js`).
 *
 * Read-only for now: anything but GET is refused before a key is read. A route
 * names the permissions it needs (`routes.js`), so a write route can arrive
 * later with its own permission and no key holds it until it is granted.
 *
 * Every answered request is recorded in `api_audit` (which key, which route,
 * which application, whether the full SSN went out) before the answer leaves.
 * A read that could not be recorded is not answered, as for the application
 * PDF's own callable. Records are deleted after `AUDIT_DAYS` by a TTL policy.
 *
 * Server to server: no CORS header is sent, so a browser page cannot read the
 * answers, and a key has no business sitting in one.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { admin, db } = require('../firebaseAdmin');
const { AUDIT_COLLECTION, AUDIT_DAYS, hasScope } = require('./apiKeys');
const { ApiError, authenticate } = require('./apiAuth');
const { matchRoute } = require('./routes');

function applyHeaders(res) {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
}

function send(res, status, body, headers = {}) {
    for (const [name, value] of Object.entries(headers)) res.set(name, value);
    res.status(status).send(JSON.stringify(body));
}

function sendError(res, error) {
    if (error instanceof ApiError) {
        send(res, error.status, { error: { code: error.code, message: error.message } }, error.headers);
        return;
    }
    send(res, 500, { error: { code: 'internal', message: 'Something went wrong on our side. Try again shortly.' } });
}

/** One request's record. Holds no driver data: ids, counts and whether the SSN went out. */
function auditRecord(ctx, route, status, detail = {}) {
    return {
        keyId: ctx.keyId,
        companyId: ctx.companyId,
        route: route.name,
        status,
        applicationId: detail.applicationId || null,
        version: detail.version || null,
        documents: Number.isInteger(detail.documents) ? detail.documents : 0,
        ssnIncluded: Boolean(detail.ssnIncluded),
        address: ctx.address,
        at: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + AUDIT_DAYS * 24 * 60 * 60 * 1000),
    };
}

async function handleRequest(req, res) {
    applyHeaders(res);
    if (req.method !== 'GET') {
        send(res, 405, { error: { code: 'method_not_allowed', message: 'This API only reads: use GET.' } }, { Allow: 'GET' });
        return;
    }
    const matched = matchRoute(req.path);
    if (!matched) {
        send(res, 404, { error: { code: 'not_found', message: 'No such endpoint. See the API documentation.' } });
        return;
    }

    let ctx;
    try {
        ctx = await authenticate(req);
    } catch (error) {
        if (!(error instanceof ApiError)) console.error(`[companyApi] authentication failed: ${error?.message || 'unknown'}`);
        sendError(res, error);
        return;
    }

    let result;
    try {
        const missing = matched.route.scopes.find((scope) => !hasScope(ctx.scopes, scope));
        if (missing) throw new ApiError(403, 'missing_permission', `This key does not have the ${missing} permission.`);
        result = await matched.route.handler(ctx, matched.params, req.query || {});
    } catch (error) {
        if (!(error instanceof ApiError)) {
            console.error(`[companyApi] ${matched.route.name} for company ${ctx.companyId} failed: ${error?.message || 'unknown'}`);
        }
        const status = error instanceof ApiError ? error.status : 500;
        // A refusal is recorded too, but its record is no reason to hold it back.
        await db.collection(AUDIT_COLLECTION).add(auditRecord(ctx, matched.route, status)).catch(() => {});
        sendError(res, error);
        return;
    }

    try {
        await db.collection(AUDIT_COLLECTION).add(auditRecord(ctx, matched.route, 200, result.audit));
    } catch (error) {
        console.error(`[companyApi] request record not written, answer withheld: ${error?.message || 'unknown'}`);
        sendError(res, new ApiError(503, 'unavailable', 'This request could not be recorded, so it was not answered. Try again shortly.'));
        return;
    }
    send(res, 200, result.body);
}

exports.companyApi = onRequest({
    region: 'us-central1',
    invoker: 'public',
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 10,
}, (req, res) => handleRequest(req, res));

exports.__test = { handleRequest };
