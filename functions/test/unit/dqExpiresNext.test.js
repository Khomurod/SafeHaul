/**
 * `dqExpiresNext` on an application or lead: the earliest valid-until date
 * (`expirationDate`, `YYYY-MM-DD`) among its DQ records that are not removed and
 * have one, or absent when none has. The server keeps it: a DQ write that can
 * move it recomputes it from the record's DQ files, and it is written only when
 * it changes. The dashboard queries it with a single-field range.
 *
 * All names and ids below are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts, fn) => fn,
}));

// `mock`-prefixed so the jest.mock factory may reference them (jest hoisting rule).
const mockDocs = new Map();
const mockUpdates = [];
const mockReads = [];
jest.mock('../../firebaseAdmin', () => {
    const docsUnder = (path) => [...mockDocs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data }));
    const docRef = (path) => ({
        kind: 'doc',
        path,
        collection: (name) => colRef(`${path}/${name}`),
    });
    const colRef = (path) => ({ kind: 'collection', path, doc: (id) => docRef(`${path}/${id}`) });
    const read = async (ref) => {
        mockReads.push(ref.path);
        if (ref.kind === 'collection') return { docs: docsUnder(ref.path) };
        return { exists: mockDocs.has(ref.path), data: () => mockDocs.get(ref.path) };
    };
    return {
        admin: { firestore: { FieldValue: { delete: () => 'DELETE_FIELD' } } },
        db: {
            collection: (name) => colRef(name),
            runTransaction: async (callback) => callback({
                get: read,
                update: (ref, data) => { mockUpdates.push({ path: ref.path, data }); },
            }),
        },
    };
});

const { onDqFileWritten } = require('../../dqExpiresNext');
const { calendarDay, earliestExpiration } = require('../../shared/dqExpiry');

const APP = 'companies/co1/applications/app1';

/** A write of `dq_files/{fileId}` under `collectionName/recordId`, from `before` to `after` (null: absent). */
const write = (before, after, { collectionName = 'applications', recordId = 'app1', fileId = 'f1' } = {}) => onDqFileWritten({
    params: { companyId: 'co1', collectionName, recordId, fileId },
    data: {
        before: { exists: Boolean(before), data: () => before || undefined },
        after: { exists: Boolean(after), data: () => after || undefined },
    },
});

beforeEach(() => {
    mockDocs.clear();
    mockUpdates.length = 0;
    mockReads.length = 0;
});

describe('the earliest valid-until date', () => {
    it('is the earliest day among the records that are not removed', () => {
        expect(earliestExpiration([
            { expirationDate: '2027-05-01' },
            { expirationDate: '2026-12-31' },
            { expirationDate: '2026-01-01', removedAt: 'then' },
            { fileType: 'Road Test Certificate' },
        ])).toBe('2026-12-31');
    });

    it('is null when no record has a date it can read', () => {
        expect(earliestExpiration([])).toBeNull();
        expect(earliestExpiration([{ expirationDate: '' }, { expirationDate: '03/01/2027' }, { expirationDate: 20270301 }])).toBeNull();
    });

    it('reads a calendar day, also at the start of an ISO time, and never an impossible one', () => {
        expect(calendarDay('2027-03-01')).toBe('2027-03-01');
        expect(calendarDay('2027-03-01T00:00:00.000Z')).toBe('2027-03-01');
        expect(calendarDay('2027-02-30')).toBeNull();
        expect(calendarDay('2027-13-01')).toBeNull();
        expect(calendarDay(null)).toBeNull();
    });
});

describe('onDqFileWritten', () => {
    it('sets it on the application when a dated record arrives', async () => {
        mockDocs.set(APP, { status: 'New Application' });
        mockDocs.set(`${APP}/dq_files/medical_card`, { expirationDate: '2027-04-30' });
        mockDocs.set(`${APP}/dq_files/license_front`, { expirationDate: '2028-01-15' });

        await write(null, { expirationDate: '2027-04-30' }, { fileId: 'medical_card' });

        expect(mockUpdates).toEqual([{ path: APP, data: { dqExpiresNext: '2027-04-30' } }]);
    });

    it('moves to the next date when the earliest record is removed, and leaves the field when none is left', async () => {
        mockDocs.set(APP, { dqExpiresNext: '2027-04-30' });
        mockDocs.set(`${APP}/dq_files/medical_card`, { expirationDate: '2027-04-30', removedAt: 'now' });
        mockDocs.set(`${APP}/dq_files/license_front`, { expirationDate: '2028-01-15' });

        await write({ expirationDate: '2027-04-30' }, { expirationDate: '2027-04-30', removedAt: 'now' }, { fileId: 'medical_card' });
        expect(mockUpdates).toEqual([{ path: APP, data: { dqExpiresNext: '2028-01-15' } }]);

        mockUpdates.length = 0;
        mockDocs.set(APP, { dqExpiresNext: '2028-01-15' });
        mockDocs.delete(`${APP}/dq_files/license_front`);
        await write({ expirationDate: '2028-01-15' }, null, { fileId: 'license_front' });
        expect(mockUpdates).toEqual([{ path: APP, data: { dqExpiresNext: 'DELETE_FIELD' } }]);
    });

    it('writes nothing when the value it would write is already there', async () => {
        mockDocs.set(APP, { dqExpiresNext: '2027-04-30' });
        mockDocs.set(`${APP}/dq_files/medical_card`, { expirationDate: '2027-04-30' });
        mockDocs.set(`${APP}/dq_files/auto-1`, { expirationDate: '2029-01-01' });

        await write(null, { expirationDate: '2029-01-01' }, { fileId: 'auto-1' });

        expect(mockUpdates).toEqual([]);
    });

    it('reads nothing when the write cannot move the date', async () => {
        mockDocs.set(APP, {});
        await write(null, { fileType: 'Road Test Certificate' });
        await write({ fileType: 'Other', expirationDate: '2027-01-01' }, { fileType: 'Other', expirationDate: '2027-01-01', fileName: 'renamed.pdf' });
        await write({ fileType: 'Other' }, { fileType: 'Other', removedAt: 'now' });

        expect(mockReads).toEqual([]);
        expect(mockUpdates).toEqual([]);
    });

    it('keeps a lead\'s date on the lead', async () => {
        const LEAD = 'companies/co1/leads/lead1';
        mockDocs.set(LEAD, {});
        mockDocs.set(`${LEAD}/dq_files/auto-1`, { expirationDate: '2027-02-01' });

        await write(null, { expirationDate: '2027-02-01' }, { collectionName: 'leads', recordId: 'lead1', fileId: 'auto-1' });

        expect(mockUpdates).toEqual([{ path: LEAD, data: { dqExpiresNext: '2027-02-01' } }]);
    });

    it('never writes a record that is gone, nor one of another collection', async () => {
        mockDocs.set(`${APP}/dq_files/f1`, { expirationDate: '2027-02-01' });
        await write(null, { expirationDate: '2027-02-01' });

        mockDocs.set('companies/co1/drivers/d1', {});
        await write(null, { expirationDate: '2027-02-01' }, { collectionName: 'drivers', recordId: 'd1' });

        expect(mockUpdates).toEqual([]);
        expect(mockReads.some((path) => path.includes('/drivers/'))).toBe(false);
    });
});
