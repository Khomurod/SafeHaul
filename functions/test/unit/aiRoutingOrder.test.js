/**
 * The operator-controlled routing order.
 *
 * The property that matters most here is not that a reorder works — it is that
 * *nothing* an operator or a corrupt document can do switches AI off. This
 * module sits in front of every AI request in the platform, and a Cloud
 * Functions deploy reaches Production immediately, so "the config document was
 * malformed and CDL parsing stopped platform-wide" is the failure these tests
 * exist to make impossible.
 *
 * Every degradation case is therefore asserted explicitly, and the last test in
 * the first block sweeps a battery of malformed inputs so a future change
 * cannot introduce a new one quietly.
 */

const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } },
    db: { collection: (...args) => mockCollection(...args) },
}));

const {
    COLLECTION,
    ORDER_DOC,
    MAX_STORED_IDS,
    orderProviders,
    readProviderOrder,
    sanitizeOrder,
    writeProviderOrder,
} = require('../../ai/router/order');
const { PROVIDERS, DEFAULT_FALLBACK_ORDER } = require('../../ai/registry/providers');

const ids = (providers) => providers.map((provider) => provider.id);

beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue(undefined);
    // The degradation cases deliberately provoke the module's own warning. It
    // is captured rather than printed so a passing run stays readable.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('orderProviders — degrading to the registry order', () => {
    it('uses the registry order when no document exists', () => {
        // `readProviderOrder` reports an absent document as `[]`.
        expect(ids(orderProviders(PROVIDERS, []))).toEqual(DEFAULT_FALLBACK_ORDER);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'gemini,groq'],
        ['a number', 7],
        ['an object', { gemini: 1 }],
        ['an array of objects', [{ id: 'gemini' }]],
        ['an array of nulls', [null, null]],
        ['an array of empty strings', ['', '   ']],
    ])('uses the registry order when the stored value is %s', (_label, stored) => {
        expect(ids(orderProviders(PROVIDERS, stored))).toEqual(DEFAULT_FALLBACK_ORDER);
    });

    it('never returns an empty list from a non-empty registry, whatever it is given', () => {
        const hostile = [
            undefined, null, false, 0, '', 'gemini', {}, [], [''], [null],
            ['not-a-provider'], ['not-a-provider', 'also-not-one'],
            [{}], [[]], new Array(500).fill('nope'), Symbol.iterator,
        ];

        for (const stored of hostile) {
            const result = orderProviders(PROVIDERS, stored);
            expect(result.length).toBe(PROVIDERS.length);
            expect(new Set(ids(result)).size).toBe(PROVIDERS.length);
        }
    });

    it('returns an empty list only when the registry itself is empty', () => {
        // Defensive: there is no code path that produces this, and if one ever
        // appears the router should fail loudly on "no providers" rather than
        // silently walking a list this function invented.
        expect(orderProviders([], ['gemini'])).toEqual([]);
        expect(orderProviders(null, ['gemini'])).toEqual([]);
    });
});

describe('orderProviders — applying an order', () => {
    it('puts a fully-specified order in exactly that order', () => {
        const wanted = ['mistral', 'gemini', 'groq', 'openrouter', 'huggingface',
            'cloudflare', 'cerebras', 'sambanova', 'github-models'];

        expect(ids(orderProviders(PROVIDERS, wanted))).toEqual(wanted);
    });

    it('promotes a partial order and leaves the rest in registry order', () => {
        const result = ids(orderProviders(PROVIDERS, ['mistral', 'openrouter']));

        expect(result.slice(0, 2)).toEqual(['mistral', 'openrouter']);
        // The remainder keeps its relative registry order rather than being
        // shuffled, so an operator who ranks two providers has not implicitly
        // reordered the other seven.
        expect(result.slice(2)).toEqual(
            DEFAULT_FALLBACK_ORDER.filter((id) => id !== 'mistral' && id !== 'openrouter'),
        );
    });

    it('ignores ids that are not in the registry', () => {
        const result = ids(orderProviders(PROVIDERS, ['not-a-provider', 'mistral', 'openai']));

        expect(result[0]).toBe('mistral');
        expect(result).not.toContain('not-a-provider');
        expect(result).not.toContain('openai');
        expect(result).toHaveLength(PROVIDERS.length);
    });

    it('keeps the first occurrence of a repeated id', () => {
        const result = ids(orderProviders(PROVIDERS, ['mistral', 'gemini', 'mistral']));

        expect(result.slice(0, 2)).toEqual(['mistral', 'gemini']);
        expect(result.filter((id) => id === 'mistral')).toHaveLength(1);
        expect(result).toHaveLength(PROVIDERS.length);
    });

    it('returns every registry provider exactly once, whatever the input', () => {
        for (const stored of [
            [], ['gemini'], ['huggingface', 'gemini'], DEFAULT_FALLBACK_ORDER,
            [...DEFAULT_FALLBACK_ORDER].reverse(), ['x', 'gemini', 'x', 'gemini'],
        ]) {
            expect(ids(orderProviders(PROVIDERS, stored)).sort())
                .toEqual([...DEFAULT_FALLBACK_ORDER].sort());
        }
    });

    it('keeps the retired provider in the order rather than dropping it', () => {
        // The registry keeps the retired row so the documented order keeps its
        // shape; ordering must not be the thing that removes it. The router
        // still skips it as `retired`.
        expect(ids(orderProviders(PROVIDERS, ['github-models'])))
            .toContain('github-models');
    });

    it('does not mutate the registry array it was given', () => {
        const before = ids(PROVIDERS);
        orderProviders(PROVIDERS, ['huggingface', 'sambanova']);
        expect(ids(PROVIDERS)).toEqual(before);
    });
});

describe('sanitizeOrder', () => {
    it('keeps only non-empty strings, trimmed', () => {
        expect(sanitizeOrder([' gemini ', '', null, 3, 'groq', {}])).toEqual(['gemini', 'groq']);
    });

    it('caps how much a stored document can hand the router', () => {
        expect(sanitizeOrder(new Array(500).fill('gemini'))).toHaveLength(MAX_STORED_IDS);
    });
});

describe('readProviderOrder', () => {
    it('reads the single document in the server-only collection', async () => {
        mockGet.mockResolvedValue({ exists: true, data: () => ({ providerIds: ['mistral'] }) });

        await expect(readProviderOrder()).resolves.toEqual(['mistral']);
        expect(mockCollection).toHaveBeenCalledWith(COLLECTION);
        expect(mockDoc).toHaveBeenCalledWith(ORDER_DOC);
    });

    it('reports an absent document as no override', async () => {
        mockGet.mockResolvedValue({ exists: false, data: () => undefined });
        await expect(readProviderOrder()).resolves.toEqual([]);
    });

    it('reports a malformed field as no override', async () => {
        mockGet.mockResolvedValue({ exists: true, data: () => ({ providerIds: 'gemini,groq' }) });
        await expect(readProviderOrder()).resolves.toEqual([]);
    });

    it('reports an unreadable document as no override instead of throwing', async () => {
        // This is the case that would otherwise take AI down platform-wide: a
        // rejected read here must not become a rejected AI request.
        mockGet.mockRejectedValue(new Error('permission denied'));
        await expect(readProviderOrder()).resolves.toEqual([]);
    });

    it('survives a document whose data() is missing entirely', async () => {
        mockGet.mockResolvedValue({ exists: true, data: () => null });
        await expect(readProviderOrder()).resolves.toEqual([]);
    });
});

describe('writeProviderOrder', () => {
    it('writes one document, with the actor and a server timestamp', async () => {
        await writeProviderOrder(['mistral', 'gemini'], 'uid-1');

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockSet).toHaveBeenCalledWith({
            providerIds: ['mistral', 'gemini'],
            updatedAt: 'ts',
            updatedBy: 'uid-1',
        }, { merge: true });
    });

    it('sanitizes what it is asked to store', async () => {
        await expect(writeProviderOrder([' mistral ', 5, ''], null)).resolves.toEqual(['mistral']);
        expect(mockSet.mock.calls[0][0].providerIds).toEqual(['mistral']);
        expect(mockSet.mock.calls[0][0].updatedBy).toBeNull();
    });
});
