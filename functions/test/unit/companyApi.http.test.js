/**
 * The company API as another service meets it: a key opens only its own
 * company's submitted applications, the SSN and files only with their own
 * permissions, and every answer is recorded before it leaves.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('../../firebaseAdmin', () => require('./companyApi.support').firebaseAdminMock());
const mockCheckRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...args) => mockCheckRateLimit(...args) }));

const support = require('./companyApi.support');
const { __test: { handleRequest } } = require('../../companyApi/http');

const ALL = ['applications:read', 'documents:read', 'ssn:read'];
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

async function get(path, { key, query, method = 'GET', ip } = {}) {
    const res = support.response();
    await handleRequest(support.request({ method, path, query, key, ip }), res);
    return res;
}

beforeEach(() => {
    jest.resetAllMocks();
    support.reset();
    mockCheckRateLimit.mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    support.seedCompany('co-a');
    support.seedCompany('co-b');
});

afterEach(() => jest.restoreAllMocks());

describe('who may call', () => {
    it('reads only: anything but GET is refused before a key is looked at', async () => {
        const res = await get('/v1/key', { method: 'POST' });
        expect(res.statusCode).toBe(405);
        expect(res.headers.Allow).toBe('GET');
        expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('names no endpoint it does not have', async () => {
        expect((await get('/v1/drivers')).body.error.code).toBe('not_found');
    });

    it('refuses no key, a malformed one, an unknown one and a wrong secret alike', async () => {
        const { key } = support.seedKey('co-a');
        const wrongSecret = `${key.slice(0, -4)}AAAA`;
        expect((await get('/v1/key')).body.error.code).toBe('missing_key');
        for (const presented of ['not-a-key', key.replace(/_[0-9a-f]{16}_/, '_0000000000000000_'), wrongSecret]) {
            const res = await get('/v1/key', { key: presented });
            expect([res.statusCode, res.body.error.code]).toEqual([401, 'invalid_key']);
        }
    });

    it('refuses a key that was turned off, and one whose company is gone', async () => {
        const off = support.seedKey('co-a', { revokedAt: new Date('2026-10-05T00:00:00Z') });
        expect((await get('/v1/key', { key: off.key })).body.error.code).toBe('key_revoked');

        const orphan = support.seedKey('co-gone');
        expect((await get('/v1/key', { key: orphan.key })).body.error.code).toBe('invalid_key');
    });

    it('limits each address before any key is read, and each key after', async () => {
        const { key, keyId } = support.seedKey('co-a');
        mockCheckRateLimit.mockResolvedValueOnce(false);
        const byAddress = await get('/v1/key', { key });
        expect([byAddress.statusCode, byAddress.headers['Retry-After']]).toEqual([429, '60']);
        expect(mockCheckRateLimit).toHaveBeenCalledWith('api_addr_203.0.113.7', 120, 60, 'open');

        mockCheckRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const byKey = await get('/v1/key', { key });
        expect(byKey.statusCode).toBe(429);
        expect(mockCheckRateLimit).toHaveBeenLastCalledWith(`api_key_${keyId}`, 60, 60, 'closed');
    });

    it('answers with no CORS header and nothing cached', async () => {
        const { key } = support.seedKey('co-a');
        const res = await get('/v1/key', { key });
        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(Object.keys(res.headers).some((name) => /access-control/i.test(name))).toBe(false);
    });
});

describe('GET /v1/key', () => {
    it('says which key and company it is, and notes the use at most once a minute', async () => {
        const { key, keyId } = support.seedKey('co-a', { scopes: ['applications:read', 'documents:read'] });

        const res = await get('/v1/key/', { key });
        expect(res.body).toEqual({
            keyId, name: 'TMS', permissions: ['applications:read', 'documents:read'], company: { id: 'co-a', name: 'co-a Freight' },
        });
        const firstUse = support.docs.get(`company_api_keys/${keyId}`).lastUsedAt;
        expect(firstUse).toBeInstanceOf(Date);

        await get('/v1/key', { key });
        expect(support.docs.get(`company_api_keys/${keyId}`).lastUsedAt).toEqual(firstUse);
    });
});

describe('GET /v1/submissions', () => {
    beforeEach(() => {
        support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) });
        support.seedApplication('co-a', 'app-2', { submittedAt: minutesAgo(40) });
        support.seedApplication('co-a', 'app-1', { sequence: 2, submittedAt: minutesAgo(30) });
        support.seedApplication('co-b', 'app-9', { submittedAt: minutesAgo(45) });
        support.seedApplication('co-a', 'app-3', { submittedAt: minutesAgo(20) });
    });

    it('lists this company’s submissions in the order they arrived, resubmissions too', async () => {
        const { key } = support.seedKey('co-a');
        const res = await get('/v1/submissions', { key });
        expect(res.body.submissions.map(({ applicationId, version }) => `${applicationId}/${version}`))
            .toEqual(['app-1/v1', 'app-2/v1', 'app-1/v2', 'app-3/v1']);
        expect(res.body.submissions[2]).toEqual(expect.objectContaining({ isOriginal: false }));
        expect(res.body.hasMore).toBe(false);
    });

    it('pages with a cursor that, sent back later, returns only what arrived since', async () => {
        const { key } = support.seedKey('co-a');
        const first = await get('/v1/submissions', { key, query: { limit: '2' } });
        expect(first.body.submissions.map((item) => item.applicationId)).toEqual(['app-1', 'app-2']);
        expect(first.body.hasMore).toBe(true);

        const second = await get('/v1/submissions', { key, query: { limit: '2', cursor: first.body.nextCursor } });
        expect(second.body.submissions.map((item) => `${item.applicationId}/${item.version}`)).toEqual(['app-1/v2', 'app-3/v1']);

        support.seedApplication('co-a', 'app-4', { submittedAt: minutesAgo(5) });
        const later = await get('/v1/submissions', { key, query: { cursor: second.body.nextCursor } });
        expect(later.body.submissions.map((item) => item.applicationId)).toEqual(['app-4']);

        const quiet = await get('/v1/submissions', { key, query: { cursor: later.body.nextCursor } });
        expect(quiet.body).toEqual({ submissions: [], nextCursor: later.body.nextCursor, hasMore: false });
    });

    it('holds a record back for its first minute, so a cursor never passes one still being written', async () => {
        const { key } = support.seedKey('co-a');
        support.seedApplication('co-a', 'app-5', { submittedAt: new Date(Date.now() - 10 * 1000).toISOString() });
        const res = await get('/v1/submissions', { key });
        expect(res.body.submissions.map((item) => item.applicationId)).not.toContain('app-5');
    });

    it('starts from a date when asked', async () => {
        const { key } = support.seedKey('co-a');
        const res = await get('/v1/submissions', { key, query: { since: minutesAgo(35) } });
        expect(res.body.submissions.map((item) => `${item.applicationId}/${item.version}`)).toEqual(['app-1/v2', 'app-3/v1']);
    });

    it('refuses a bad limit, date or cursor in words', async () => {
        const { key } = support.seedKey('co-a');
        for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'ten' }, { since: 'yesterday' }, { cursor: 'abc' }]) {
            const res = await get('/v1/submissions', { key, query });
            expect([res.statusCode, res.body.error.code]).toEqual([400, 'bad_request']);
        }
    });
});

describe('GET /v1/applications/{id}', () => {
    beforeEach(() => {
        support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) });
        support.seedApplication('co-b', 'app-9', { submittedAt: minutesAgo(45) });
    });

    it('returns the frozen record with the SSN masked, and no path, link or internal value', async () => {
        const { key } = support.seedKey('co-a');
        const res = await get('/v1/applications/app-1', { key });

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            id: 'app-1', version: 'v1', isOriginal: true, confirmationNumber: 'CONF-app-1', ssnIncluded: false, documents: [],
            provenance: { source: 'submission', notes: [] },
        }));
        expect(res.body.applicant).toEqual(expect.objectContaining({ firstName: 'Marcus', lastName: 'Delgado', dateOfBirth: '1986-04-17' }));
        const text = JSON.stringify(res.body);
        expect(text).toContain('***-**-7391');
        expect(text).not.toMatch(/412-88-7391|412887391|guest_uploads|storagePath|internal-7712|_localDraftId/);
    });

    it('gives the full SSN only to a key that holds ssn:read, and records that it did', async () => {
        const { key, keyId } = support.seedKey('co-a', { scopes: ['applications:read', 'ssn:read'] });
        const res = await get('/v1/applications/app-1', { key });
        expect(JSON.stringify(res.body)).toContain('412-88-7391');
        expect(res.body.ssnIncluded).toBe(true);
        expect(support.auditRecords()).toEqual([expect.objectContaining({
            keyId, companyId: 'co-a', route: 'GET /v1/applications/:id', status: 200, applicationId: 'app-1', version: 'v1', ssnIncluded: true,
        })]);
        expect(JSON.stringify(support.auditRecords())).not.toContain('412-88-7391');
    });

    it('reads a named version, and answers another company’s application as not found', async () => {
        support.seedApplication('co-a', 'app-1', { sequence: 2, submittedAt: minutesAgo(30) });
        const { key } = support.seedKey('co-a');
        expect((await get('/v1/applications/app-1', { key })).body.version).toBe('v2');
        expect((await get('/v1/applications/app-1', { key, query: { version: 'v1' } })).body.version).toBe('v1');
        expect((await get('/v1/applications/app-1', { key, query: { version: 'v7' } })).statusCode).toBe(404);
        expect((await get('/v1/applications/app-1', { key, query: { version: '../v1' } })).statusCode).toBe(400);
        expect((await get('/v1/applications/app-9', { key })).body.error.code).toBe('not_found');
    });
});

describe('GET /v1/applications/{id}/documents', () => {
    beforeEach(() => support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) }));

    it('needs documents:read, and records the refusal', async () => {
        const { key } = support.seedKey('co-a');
        const res = await get('/v1/applications/app-1/documents', { key });
        expect([res.statusCode, res.body.error.code]).toEqual([403, 'missing_permission']);
        expect(support.auditRecords()).toEqual([expect.objectContaining({ status: 403, route: 'GET /v1/applications/:id/documents' })]);
    });

    it('links the files for 15 minutes, and names the Social Security card it may not fetch', async () => {
        const { key } = support.seedKey('co-a', { scopes: ['applications:read', 'documents:read'] });
        const res = await get('/v1/applications/app-1/documents', { key });

        expect(res.body.documents.map((item) => item.id)).toEqual(['cdl-front']);
        expect(res.body.documents[0].url).toContain(encodeURIComponent('companies/co-a/applications/guest_uploads/'));
        expect(res.body.documents[0].url).toContain(encodeURIComponent('attachment; filename="cdl-front.jpg"'));
        expect(Date.parse(res.body.documents[0].expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
        expect(res.body.withheld).toEqual([expect.objectContaining({ id: 'ssc-upload', needs: 'ssn:read' })]);
    });

    it('links the card too with ssn:read, and never a file outside this company', async () => {
        const { key } = support.seedKey('co-a', { scopes: ALL });
        expect((await get('/v1/applications/app-1/documents', { key })).body.documents.map((item) => item.id))
            .toEqual(['cdl-front', 'ssc-upload']);

        support.seedApplication('co-a', 'app-2', { submittedAt: minutesAgo(40), otherCompanyFile: true });
        const crafted = await get('/v1/applications/app-2/documents', { key });
        expect(crafted.body).toEqual(expect.objectContaining({ documents: [], withheld: [] }));
    });
});

describe('GET /v1/applications/{id}/pdf', () => {
    const PDF = 'application_originals/co-a/app-1/v1.pdf';
    beforeEach(() => support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) }));

    it('needs the SSN permission, because the PDF shows the full number', async () => {
        const { key } = support.seedKey('co-a', { scopes: ['applications:read', 'documents:read'] });
        expect((await get('/v1/applications/app-1/pdf', { key })).statusCode).toBe(403);
    });

    it('says when the PDF is not made yet', async () => {
        const { key } = support.seedKey('co-a', { scopes: ALL });
        expect((await get('/v1/applications/app-1/pdf', { key })).body.error.code).toBe('pdf_not_ready');
    });

    it('links the preserved PDF and writes the opening into the application’s history', async () => {
        support.files.set(PDF, { metadata: { safehaulFileName: 'Delgado-Application.pdf' } });
        const { key, keyId } = support.seedKey('co-a', { scopes: ALL });
        const res = await get('/v1/applications/app-1/pdf', { key });

        expect(res.body).toEqual(expect.objectContaining({ applicationId: 'app-1', version: 'v1', fileName: 'Delgado-Application.pdf' }));
        expect(res.body.url).toContain(encodeURIComponent(PDF));
        const history = [...support.docs.entries()].filter(([path]) => path.startsWith('companies/co-a/applications/app-1/activity_logs/'));
        expect(history.map(([, entry]) => entry)).toEqual([expect.objectContaining({
            action: 'Original Application PDF Accessed', performedBy: `api_key:${keyId}`, snapshotId: 'v1', type: 'security',
        })]);
    });
});

describe('the request record', () => {
    it('withholds an answer it could not record', async () => {
        support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) });
        const { key } = support.seedKey('co-a', { scopes: ALL });
        support.failWritesTo('api_audit/');

        const res = await get('/v1/applications/app-1', { key });
        expect([res.statusCode, res.body.error.code]).toEqual([503, 'unavailable']);
        expect(JSON.stringify(res.body)).not.toMatch(/Marcus|412-88-7391/);
    });

    it('holds ids and counts, never the answers, and is kept 90 days', async () => {
        support.seedApplication('co-a', 'app-1', { submittedAt: minutesAgo(50) });
        const { key } = support.seedKey('co-a', { scopes: ALL });
        await get('/v1/applications/app-1/documents', { key });

        const [record] = support.auditRecords();
        expect(record).toEqual(expect.objectContaining({ applicationId: 'app-1', documents: 2, ssnIncluded: true, address: '203.0.113.7' }));
        expect(JSON.stringify(record)).not.toMatch(/Marcus|cdl-front\.jpg|storage\.example/);
        const days = (record.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(89.9);
        expect(days).toBeLessThanOrEqual(90);
    });
});
