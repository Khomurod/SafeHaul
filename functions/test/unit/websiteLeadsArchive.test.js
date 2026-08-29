/**
 * Contract for the website-lead archive.
 *
 * ## What this replaced
 *
 * `landingLead.test.js` covered two-step capture, completion tokens, honeypot
 * handling and rate limiting. `landingSettings.test.js` covered Telegram
 * configuration, masked reads, test-send and delivery retry. All of that is
 * retired with the marketing site — the tests went with the code they tested.
 *
 * **The leads were kept**, so what has to be proven is different and smaller:
 * that reading them is still guarded exactly as it was, that the read cannot be
 * widened, and that nothing here can write.
 */

const { LEADS_COLLECTION, listLeads } = require('../../landing/leads');

jest.mock('../../firebaseAdmin', () => {
    const docs = [];
    const query = {
        orderBy: jest.fn(() => query),
        limit: jest.fn((n) => { query.__limit = n; return query; }),
        get: jest.fn(async () => ({ docs })),
    };
    return {
        db: { collection: jest.fn((name) => { query.__collection = name; return query; }) },
        __query: query,
        __docs: docs,
    };
});

const admin = require('../../firebaseAdmin');

function seed(rows) {
    admin.__docs.length = 0;
    for (const row of rows) {
        admin.__docs.push({ id: row.id, data: () => row });
    }
}

describe('website-lead archive — reading', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        seed([]);
    });

    it('reads the collection the leads were captured into', async () => {
        await listLeads();
        expect(admin.__query.__collection).toBe(LEADS_COLLECTION);
        expect(LEADS_COLLECTION).toBe('landing_leads');
    });

    it('returns newest first', async () => {
        await listLeads();
        expect(admin.__query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('caps the page size at 200 however high the caller asks', async () => {
        // The cap applies to the CSV export too, which asks for everything it
        // can get. "Everything" on an unbounded collection is how a read-only
        // screen becomes an outage.
        await listLeads(100000);
        expect(admin.__query.__limit).toBe(200);
    });

    it('floors a nonsense limit at a usable page rather than zero', async () => {
        await listLeads(0);
        expect(admin.__query.__limit).toBe(50);
        await listLeads(-5);
        expect(admin.__query.__limit).toBe(1);
    });

    it('projects only the fields the archive screen shows', async () => {
        seed([{
            id: 'lead-1',
            fullName: 'Dana Fixture',
            workEmail: 'dana@example.test',
            companyName: 'Ridgeline Carriers',
            companySize: '25',
            phone: '555-0100',
            primaryGoal: 'hiring',
            stage: 'qualified',
            sourcePage: '/',
            utmSource: null,
            delivery: { status: 'delivered', code: null, attempts: 1 },
            createdAt: { toMillis: () => 1754136000000 },
            // Deliberately present, and deliberately not returned: the
            // single-use completion token's hash. It authorised writes that no
            // longer exist, and an archive has no reason to hand it out.
            referenceHash: 'ffffffffffffffffffffffffffffffff',
        }]);
        const [row] = await listLeads();
        expect(row).toEqual({
            id: 'lead-1',
            fullName: 'Dana Fixture',
            workEmail: 'dana@example.test',
            companyName: 'Ridgeline Carriers',
            companySize: '25',
            phone: '555-0100',
            primaryGoal: 'hiring',
            stage: 'qualified',
            sourcePage: '/',
            utmSource: null,
            delivery: { status: 'delivered', code: null, attempts: 1 },
            createdAt: 1754136000000,
        });
        expect(Object.keys(row)).not.toContain('referenceHash');
    });

    it('survives a lead written before a field existed', async () => {
        seed([{ id: 'old', createdAt: null }]);
        const [row] = await listLeads();
        expect(row.fullName).toBeNull();
        expect(row.delivery).toEqual({ status: null, code: null, attempts: 0 });
        expect(row.createdAt).toBeNull();
    });
});

describe('website-lead archive — nothing here writes', () => {
    it('exports no capture, completion, delivery or retry function', () => {
        const leads = require('../../landing/leads');
        // The archive is read-only by construction, not by convention. If a
        // writer comes back it must be a deliberate change to this list.
        expect(Object.keys(leads).sort()).toEqual(['LEADS_COLLECTION', 'listLeads']);
    });

    it('the callable module exposes only the read', () => {
        jest.isolateModules(() => {
            jest.doMock('firebase-functions/v2/https', () => ({
                onCall: (_opts, handler) => handler,
                HttpsError: class extends Error {},
            }));
            jest.doMock('../../environmentVault/audit', () => ({
                ACTIONS: { LIST: 'list' }, RESULTS: { SUCCESS: 'success' }, recordAuditEvent: jest.fn(),
            }));
            jest.doMock('../../environmentVault/guards', () => ({
                assertSuperAdmin: jest.fn(), assertWithinRateLimit: jest.fn(),
            }));
            const callables = require('../../landing/callables');
            expect(Object.keys(callables)).toEqual(['listLandingLeads']);
        });
    });
});
