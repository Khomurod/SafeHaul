// The one "Exclude Previously Messaged" rule the count, the preview list and
// the launch share (`bulkActions/helpers/recentlyMessaged.js`). Firestore is a
// map of ledger documents; stamps are Dates. All data is artificial.

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { Timestamp: { fromDate: (date) => date } } },
}));

const {
    excludeWindow,
    leadMessagedWithin,
    emailLedgerKey,
    recipientsMessagedWithin,
    LOOKUP_CHUNK,
} = require('../../bulkActions/helpers/recentlyMessaged');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

function ledgerDb(entries, { failing = null } = {}) {
    const calls = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const db = {
        collection: () => ({
            doc: () => ({
                collection: (name) => ({ doc: (id) => ({ id, path: `${name}/${id}` }) }),
            }),
        }),
        getAll: async (...refs) => {
            calls.push(refs.length);
            if (failing && refs.some((ref) => ref.path.startsWith(`${failing}/`))) {
                throw new Error(`${failing} unavailable`);
            }
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setImmediate(resolve));
            inFlight -= 1;
            return refs.map((ref) => ({
                id: ref.id,
                exists: ref.path in entries,
                data: () => entries[ref.path],
            }));
        },
    };
    return { db, calls, maxInFlight: () => maxInFlight };
}

describe('excludeWindow', () => {
    it('reads no window, forever, a number of days, and anything else as 7 days', () => {
        expect(excludeWindow(undefined)).toEqual({ active: false, since: null });
        expect(excludeWindow('off')).toEqual({ active: false, since: null });
        expect(excludeWindow('forever')).toEqual({ active: true, since: null });

        const thirty = excludeWindow('30');
        expect(thirty.active).toBe(true);
        expect(Math.round((Date.now() - thirty.since.getTime()) / DAY)).toBe(30);

        for (const odd of ['abc', '0', '-3']) {
            expect(Math.round((Date.now() - excludeWindow(odd).since.getTime()) / DAY)).toBe(7);
        }
    });
});

describe('leadMessagedWithin', () => {
    const week = excludeWindow('7');

    it("counts either of a lead's stamps, not only the first one present", () => {
        expect(leadMessagedWithin({ lastBulkMessageAt: daysAgo(90), lastContactedAt: daysAgo(1) }, week)).toBe(true);
        expect(leadMessagedWithin({ lastBulkMessageAt: daysAgo(2) }, week)).toBe(true);
        expect(leadMessagedWithin({ lastBulkMessageAt: daysAgo(90), lastContactedAt: daysAgo(30) }, week)).toBe(false);
        expect(leadMessagedWithin({}, week)).toBe(false);
    });

    it('counts any stamp for forever, and nothing without a window', () => {
        expect(leadMessagedWithin({ lastContactedAt: daysAgo(900) }, excludeWindow('forever'))).toBe(true);
        expect(leadMessagedWithin({ lastContactedAt: daysAgo(1) }, excludeWindow('off'))).toBe(false);
    });
});

describe('emailLedgerKey', () => {
    it('is the lowercased address in base64url without padding, as the send loop writes it', () => {
        expect(emailLedgerKey(' Driver@Example.COM ')).toBe(Buffer.from('driver@example.com').toString('base64url'));
        expect(emailLedgerKey('not an address')).toBeNull();
    });
});

describe('recipientsMessagedWithin', () => {
    it("finds a number under its canonical or its legacy key, inside the window only", async () => {
        const { db } = ledgerDb({
            'sms_sent_phones/+15550000001': { lastSentAt: daysAgo(1) },
            'sms_sent_phones/5550000002': { lastSentAt: daysAgo(2) },
            'sms_sent_phones/+15550000003': { lastSentAt: daysAgo(40) },
        });
        const recipients = [
            { key: 'a', phone: '(555) 000-0001' },
            { key: 'b', phone: '+1 555 000 0002' },
            { key: 'c', phone: '555-000-0003' },
            { key: 'd', phone: '' },
        ];

        const week = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('7'), recipients });
        const ever = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('forever'), recipients });

        expect([...week].sort()).toEqual(['a', 'b']);
        expect([...ever].sort()).toEqual(['a', 'b', 'c']);
    });

    it('reports a recipient once when its number sits under several keys', async () => {
        const { db } = ledgerDb({
            'sms_sent_phones/+15550000001': { lastSentAt: daysAgo(1) },
            'sms_sent_phones/15550000001': { lastSentAt: daysAgo(1) },
            'sms_sent_phones/5550000001': { lastSentAt: daysAgo(1) },
            'sms_sent_phones/15550000002': { lastSentAt: daysAgo(1) }, // the 11-digit legacy key only
        });
        const recipients = [
            { key: 'a', phone: '5550000001' },
            { key: 'b', phone: '(555) 000-0002' },
        ];

        const messaged = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('7'), recipients });

        expect([...messaged].sort()).toEqual(['a', 'b']);
    });

    it('reads the email ledger for an email campaign only', async () => {
        const { db } = ledgerDb({ [`email_sent_addresses/${emailLedgerKey('pat@example.com')}`]: { lastSentAt: daysAgo(1) } });
        const recipients = [{ key: 'p', phone: '', email: 'Pat@Example.com' }];

        const sms = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('7'), method: 'sms', recipients });
        const email = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('7'), method: 'email', recipients });

        expect([...sms]).toEqual([]);
        expect([...email]).toEqual(['p']);
    });

    it("keeps one ledger's matches when the other ledger cannot be read", async () => {
        const entries = {
            'sms_sent_phones/+15550000001': { lastSentAt: daysAgo(1) },
            [`email_sent_addresses/${emailLedgerKey('pat@example.com')}`]: { lastSentAt: daysAgo(1) },
        };
        const recipients = [
            { key: 'texted', phone: '5550000001', email: 'sam@example.com' },
            { key: 'emailed', phone: '5550000002', email: 'pat@example.com' },
        ];
        const args = { companyId: 'co-1', window: excludeWindow('7'), method: 'email', recipients };
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

        const emailDown = await recipientsMessagedWithin({ ...args, db: ledgerDb(entries, { failing: 'email_sent_addresses' }).db });
        const smsDown = await recipientsMessagedWithin({ ...args, db: ledgerDb(entries, { failing: 'sms_sent_phones' }).db });

        expect([...emailDown]).toEqual(['texted']);
        expect([...smsDown]).toEqual(['emailed']);
        expect(errors).toHaveBeenCalledTimes(2);
        errors.mockRestore();
    });

    it('reads nothing without a window', async () => {
        const { db, calls } = ledgerDb({});
        const messaged = await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('off'), recipients: [{ key: 'a', phone: '5550000001' }] });
        expect(messaged.size).toBe(0);
        expect(calls).toEqual([]);
    });

    it(`reads ${LOOKUP_CHUNK} documents a call, several calls at once`, async () => {
        const { db, calls, maxInFlight } = ledgerDb({});
        // Each 10-digit number has three ledger keys: +1…, 1…, and the ten digits.
        const recipients = Array.from({ length: 2000 }, (_, i) => ({ key: `r${i}`, phone: `555${String(i).padStart(7, '0')}` }));

        await recipientsMessagedWithin({ db, companyId: 'co-1', window: excludeWindow('7'), recipients });

        expect(calls.reduce((sum, n) => sum + n, 0)).toBe(6000);
        expect(Math.max(...calls)).toBe(LOOKUP_CHUNK);
        expect(calls.length).toBe(60);
        expect(maxInFlight()).toBeGreaterThan(1);
        expect(maxInFlight()).toBeLessThanOrEqual(10);
    });
});
