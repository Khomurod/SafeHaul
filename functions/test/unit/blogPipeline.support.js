/**
 * Shared fixtures and mock factories for the blog-pipeline suites.
 *
 * ## Why the mocks are factories rather than `jest.mock` calls
 *
 * `jest.mock` is hoisted to the top of the file it appears in, so it cannot be
 * moved into a helper module and still register. Each suite therefore keeps its
 * own one-line `jest.mock(path, () => require('./blogPipeline.support').xMock())`
 * and the *body* lives here — which is what stops six copies of a 60-line
 * Firestore double drifting apart.
 *
 * Jest gives every test file its own module registry, so each suite gets a fresh
 * `mockPosts` and `mockLedger`. That is isolation the single 1496-line file did
 * not have: there, one suite's leftover document was visible to the next.
 *
 * ## The `Once` hazard does not apply here, and it was checked
 *
 * `AGENTS.md` records that `clearAllMocks` does not drain a `*Once` queue, and
 * that splitting a file changes test ordering — the timing that makes such a leak
 * surface. This suite queues no `*Once` value anywhere (verified before the
 * split), so `resetBlogState` keeps using `clearAllMocks` exactly as before.
 * **If you add a `mockResolvedValueOnce` here, switch it to `resetAllMocks` and
 * re-establish the implementations below.**
 */

/** An in-memory Firestore standing in for the blog_posts collection. */
const mockPosts = new Map();

/**
 * Rows written to the run ledger.
 *
 * Kept separately because the assertions that matter most here are about the
 * ledger: before it existed every refusal was asserted only on `runSlot`'s
 * *return value*, so this suite would have passed unchanged with nothing
 * persisted at all — which is exactly what was shipped.
 */
const mockLedger = [];

// AI tasks are mocked at the task boundary. Routing has its own suite.
const mockGenerateArticle = jest.fn();
const mockVerifyArticleClaims = jest.fn();
const mockSelectTopic = jest.fn();

function httpsMock() {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
    return {
        HttpsError,
        onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
        onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    };
}

const schedulerMock = () => ({
    onSchedule: jest.fn((_opts, fn) => fn),
});

function firebaseAdminMock() {
    const serverTimestamp = () => ({ toDate: () => new Date('2026-08-02T12:00:00Z') });
    return {
        admin: { firestore: { FieldValue: { serverTimestamp, delete: () => '__delete__' } } },
        db: {
            collection: (name) => {
                const makeQuery = (filters = [], order = null, limit = null) => ({
                    where: (field, op, value) => makeQuery([...filters, { field, op, value }], order, limit),
                    orderBy: (field, direction) => makeQuery(filters, { field, direction }, limit),
                    limit: (count) => makeQuery(filters, order, count),
                    get: async () => {
                        let rows = [...mockPosts.entries()].map(([id, data]) => ({ id, data }));
                        for (const filter of filters) {
                            rows = rows.filter(({ data }) => {
                                const actual = data[filter.field];
                                if (filter.op === '==') return actual === filter.value;
                                if (filter.op === '>=') return String(actual) >= String(filter.value);
                                return true;
                            });
                        }
                        if (order) {
                            rows.sort((a, b) => String(b.data[order.field] ?? '').localeCompare(String(a.data[order.field] ?? '')));
                            if (order.direction === 'asc') rows.reverse();
                        }
                        if (limit) rows = rows.slice(0, limit);
                        return {
                            empty: rows.length === 0,
                            docs: rows.map((row) => ({ id: row.id, data: () => row.data })),
                        };
                    },
                });

                return {
                    ...makeQuery(),
                    doc: (id) => ({
                        get: async () => ({
                            exists: mockPosts.has(id),
                            data: () => mockPosts.get(id),
                        }),
                        create: async (data) => {
                            if (mockPosts.has(id)) {
                                const error = new Error('ALREADY_EXISTS');
                                error.code = 6;
                                throw error;
                            }
                            mockPosts.set(id, { ...data, publishedAt: serverTimestamp() });
                        },
                        update: async (patch) => {
                            mockPosts.set(id, { ...(mockPosts.get(id) || {}), ...patch });
                        },
                        set: async (patch) => {
                            mockPosts.set(id, { ...(mockPosts.get(id) || {}), ...patch });
                        },
                    }),
                    add: async (data) => {
                        // `blog_runs` is the only collection reached by `add`.
                        if (name === 'blog_runs') mockLedger.push(data);
                    },
                };
            },
        },
    };
}

const rateLimiterMock = () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) });

function articleGenerationMock() {
    const actual = jest.requireActual('../../ai/tasks/articleGeneration');
    return {
        ...actual,
        generateArticle: (...args) => mockGenerateArticle(...args),
        verifyArticleClaims: (...args) => mockVerifyArticleClaims(...args),
        selectTopic: (...args) => mockSelectTopic(...args),
    };
}

const mediaCredentialsMock = () => ({
    readAllMediaCredentials: jest.fn().mockResolvedValue(new Map()),
    writeMediaSecret: jest.fn(),
    destroyMediaSecret: jest.fn(),
    buildMediaSecretId: jest.requireActual('../../blog/media/credentials').buildMediaSecretId,
});

/** A generated draft long enough to clear the minimum word count. */
function draftArticle(overrides = {}) {
    // Long enough to clear the production MIN_WORD_COUNT of 450. The threshold
    // is deliberately not lowered for the sake of a fixture.
    const paragraph = ('Carriers need to understand the practical effect of this change on their daily '
        + 'operations, because the compliance burden falls on the fleet rather than on the agency that '
        + 'issued the rule. Safety managers should read the amended text closely and compare it with '
        + 'the records they retain today. ').repeat(6);
    return {
        title: 'FMCSA Updates Hours-of-Service Documentation Requirements for 2026',
        metaDescription: 'The agency has revised what carriers must retain to show hours-of-service compliance. Here is what changed and what fleets should do next.',
        excerpt: 'A revision to hours-of-service recordkeeping changes what carriers must retain. We explain the change and the practical steps for a fleet.',
        imageQuery: 'semi truck highway',
        imageAltText: 'A semi truck travelling on an interstate highway at dusk',
        blocks: [
            { type: 'heading', level: 2, text: 'What changed' },
            { type: 'paragraph', text: paragraph },
            { type: 'heading', level: 2, text: 'Who it affects' },
            { type: 'paragraph', text: paragraph },
            { type: 'list', items: ['Interstate carriers', 'Owner-operators', 'Safety managers'] },
            { type: 'heading', level: 2, text: 'What to do next' },
            { type: 'paragraph', text: paragraph },
        ],
        ...overrides,
    };
}

const SECOND_ITEM = {
    title: 'FMCSA Recordkeeping Amendment Draws Carrier Comment',
    url: 'https://www.federalregister.gov/documents/2026/07/31/example-comment',
    summary: 'Carriers respond to the amended 49 CFR 395 recordkeeping requirements.',
    publishedAt: '2026-07-31',
};

const NEWS_ITEM = {
    title: 'FMCSA Revises Hours-of-Service Recordkeeping Rule',
    url: 'https://www.federalregister.gov/documents/2026/07/30/example-rule',
    summary: 'The agency amends 49 CFR 395 recordkeeping requirements effective October 2026.',
    publishedAt: '2026-07-30',
};

/** A feed fetch that answers the Federal Register API and nothing else. */
function researchFetch(items = [NEWS_ITEM, SECOND_ITEM]) {
    return async (url) => {
        if (url.includes('federalregister.gov')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    results: items.map((item) => ({
                        title: item.title,
                        html_url: item.url,
                        abstract: item.summary,
                        publication_date: item.publishedAt,
                        type: 'Rule',
                    })),
                }),
                text: async () => '',
            };
        }
        // Every other source is unreachable in this test, which also exercises
        // the "one publisher down must not stop publication" path.
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
    };
}

/** The `beforeEach` every blog-pipeline suite runs. */
function resetBlogState() {
    jest.clearAllMocks();
    mockPosts.clear();
    mockLedger.length = 0;
    mockGenerateArticle.mockResolvedValue({
        article: draftArticle(),
        providerId: 'groq',
        // Carried so a ledger row can be joined to the provider timeline that
        // produced it. The router mints it and this used to drop it.
        transactionId: 'txn-generate-1',
        model: 'llama-3.3-70b-versatile',
        fallbackCount: 0,
    });
    // `{ verification, transactionId }`: the verdict and the transaction's
    // success are different facts, and the ledger needs both halves.
    mockVerifyArticleClaims.mockResolvedValue({
        verification: { supported: true, unsupportedClaims: [], notes: '' },
        transactionId: 'txn-verify-1',
    });
    mockSelectTopic.mockResolvedValue({ selectedIndex: 0, angle: 'Explain the recordkeeping change.' });
}

module.exports = {
    mockPosts,
    mockLedger,
    mockGenerateArticle,
    mockVerifyArticleClaims,
    mockSelectTopic,
    httpsMock,
    schedulerMock,
    firebaseAdminMock,
    rateLimiterMock,
    articleGenerationMock,
    mediaCredentialsMock,
    draftArticle,
    researchFetch,
    resetBlogState,
    NEWS_ITEM,
    SECOND_ITEM,
};
