/**
 * `readFailures`: every failure of the asked task types in the window, for the
 * watcher's "how many people felt it" count.
 *
 * Pinned: failures are read through `outcome == 'failure'` before any limit, so
 * newer successes cannot push them out; other tasks' failures (the probes, the
 * Test button) only cost pages, never hide a person's failure; the read pages
 * on until the window is exhausted, and says "at least" when it stops early or
 * a page fails.
 */

const mockRows = [];
const mockQueries = [];
let mockFailOnPage = 0;

function mockQuery(state) {
    return {
        where: (field, op, value) => mockQuery({ ...state, filters: [...state.filters, { field, op, value }] }),
        orderBy: (field, direction) => mockQuery({ ...state, order: [field, direction] }),
        limit: (count) => mockQuery({ ...state, limit: count }),
        startAfter: (doc) => mockQuery({ ...state, after: doc.id }),
        get: async () => {
            mockQueries.push(state);
            if (mockFailOnPage && mockQueries.length === mockFailOnPage) throw new Error('unavailable');
            const passes = (row) => state.filters.every(({ field, op, value }) => {
                const actual = field === 'timestamp' ? row.at : row[field];
                if (op === '==') return actual === value;
                if (op === '>=') return actual >= value.getTime();
                if (op === '<') return actual < value.getTime();
                throw new Error(`unexpected operator ${op}`);
            });
            let rows = mockRows.filter(passes).sort((a, b) => b.at - a.at);
            if (state.after) rows = rows.slice(rows.findIndex((row) => row.id === state.after) + 1);
            return {
                docs: rows.slice(0, state.limit).map((row) => ({
                    id: row.id,
                    data: () => ({
                        taskType: row.taskType,
                        outcome: row.outcome,
                        capability: row.capability,
                        timestamp: { toDate: () => new Date(row.at) },
                    }),
                })),
            };
        },
    };
}

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => null } } },
    db: { collection: () => mockQuery({ filters: [] }) },
}));

const { readFailures } = require('../../ai/telemetry/record');

const NOW = Date.parse('2026-10-25T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const WINDOW = { from: new Date(NOW - HOUR).toISOString(), to: new Date(NOW).toISOString() };
const USER_TASKS = ['cdl_extraction', 'medical_card_extraction'];

let nextId = 0;
const add = (count, row) => {
    for (let index = 0; index < count; index += 1) {
        nextId += 1;
        mockRows.push({ id: `row${nextId}`, capability: 'vision', ...row, at: row.at - index });
    }
};

beforeEach(() => {
    mockRows.length = 0;
    mockQueries.length = 0;
    mockFailOnPage = 0;
    nextId = 0;
});

it('finds failures behind more newer successes than a page holds', async () => {
    add(2, { taskType: 'cdl_extraction', outcome: 'failure', at: NOW - 50 * 60 * 1000 });
    add(400, { taskType: 'cdl_extraction', outcome: 'success', at: NOW - 60 * 1000 });

    const { entries, truncated } = await readFailures({ taskTypes: USER_TASKS, ...WINDOW });

    expect(entries).toHaveLength(2);
    expect(truncated).toBe(false);
    expect(mockQueries[0].filters).toEqual(expect.arrayContaining([{ field: 'outcome', op: '==', value: 'failure' }]));
});

it('pages past other tasks\' failures to the end of the hour', async () => {
    add(1, { taskType: 'medical_card_extraction', outcome: 'failure', at: NOW - 55 * 60 * 1000 });
    add(300, { taskType: 'health_check', outcome: 'failure', at: NOW - 60 * 1000 });
    // Outside the hour: not counted.
    add(1, { taskType: 'cdl_extraction', outcome: 'failure', at: NOW - 2 * HOUR });

    const { entries, truncated } = await readFailures({ taskTypes: USER_TASKS, ...WINDOW, pageSize: 100 });

    expect(entries.map((entry) => entry.taskType)).toEqual(['medical_card_extraction']);
    expect(truncated).toBe(false);
    expect(mockQueries).toHaveLength(4);
});

it('says "at least" when it stops at its scan limit', async () => {
    add(5, { taskType: 'cdl_extraction', outcome: 'failure', at: NOW - 60 * 1000 });

    const { entries, truncated } = await readFailures({ taskTypes: USER_TASKS, ...WINDOW, pageSize: 2, maxScanned: 4 });

    expect(entries).toHaveLength(4);
    expect(truncated).toBe(true);
});

it('keeps what it read and says "at least" when a page fails', async () => {
    add(3, { taskType: 'cdl_extraction', outcome: 'failure', at: NOW - 60 * 1000 });
    mockFailOnPage = 2;
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { entries, truncated } = await readFailures({ taskTypes: USER_TASKS, ...WINDOW, pageSize: 2 });

    expect(entries).toHaveLength(2);
    expect(truncated).toBe(true);
    console.error.mockRestore();
});
