/**
 * createNotification adds one notification per call, or, given an id, one per
 * event however often a trigger delivers it.
 */
const { createNotification } = require('../../shared/createNotification');

function fakeDb() {
    const docs = new Map();
    let autoId = 0;
    const docRef = (id) => ({
        id,
        set: jest.fn(async (data) => { docs.set(id, data); }),
        create: jest.fn(async (data) => {
            if (docs.has(id)) {
                const err = new Error(`6 ALREADY_EXISTS: Document already exists: ${id}`);
                err.code = 6;
                throw err;
            }
            docs.set(id, data);
        }),
    });
    const collection = { doc: jest.fn((id) => docRef(id ?? `auto${++autoId}`)) };
    const db = {
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ collection: jest.fn(() => collection) })) })),
    };
    return { db, docs };
}

describe('createNotification', () => {
    let log;
    beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => log.mockRestore());

    it('adds a new unread notification on every call without an id, as before', async () => {
        const { db, docs } = fakeDb();
        const first = await createNotification(db, 'co1', { type: 'status_change', title: 'A' });
        const second = await createNotification(db, 'co1', { type: 'status_change', title: 'A' });
        expect(first).not.toBe(second);
        expect(docs.size).toBe(2);
        expect(docs.get(first)).toMatchObject({ type: 'status_change', read: false, createdAt: expect.any(Date) });
    });

    it('adds one notification per id however many times the event is delivered', async () => {
        const { db, docs } = fakeDb();
        await expect(createNotification(db, 'co1', { type: 'signed' }, { id: 'seal_req1' })).resolves.toBe('seal_req1');
        await expect(createNotification(db, 'co1', { type: 'signed' }, { id: 'seal_req1' })).resolves.toBeNull();
        expect(docs.size).toBe(1);
        expect(docs.get('seal_req1')).toMatchObject({ type: 'signed', read: false });
    });

    it('passes on any other write failure', async () => {
        const failing = {
            id: 'seal_req2',
            create: jest.fn(async () => { throw Object.assign(new Error('unavailable'), { code: 14 }); }),
        };
        const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => failing }) }) }) };
        await expect(createNotification(db, 'co1', { type: 'signed' }, { id: 'seal_req2' })).rejects.toThrow('unavailable');
    });
});
