/**
 * Blog pipeline: topic selection and lead enrichment.
 *
 * Only publishable leads may be offered, and a feed item's own topic is not the
 * topic of the article written from it.
 *
 * Split from a 1496-line `blogPipeline.test.js` on 2026-08-29. The mocks and
 * fixtures live in `./blogPipeline.support`; the `jest.mock` calls stay here
 * because Jest hoists them per file and they cannot register from a helper.
 *
 * No test here contacts a real feed, a real AI provider or a real image
 * provider: research fetches use an injected `fetchImpl`, and the AI tasks are
 * mocked at the task boundary.
 */

jest.mock('firebase-functions/v2/https', () => require('./blogPipeline.support').httpsMock());
jest.mock('firebase-functions/v2/scheduler', () => require('./blogPipeline.support').schedulerMock());
jest.mock('../../firebaseAdmin', () => require('./blogPipeline.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./blogPipeline.support').rateLimiterMock());
jest.mock('../../ai/tasks/articleGeneration', () => require('./blogPipeline.support').articleGenerationMock());
jest.mock('../../blog/media/credentials', () => require('./blogPipeline.support').mediaCredentialsMock());

const themes = require('../../blog/pipeline/themes');
const generate = require('../../blog/pipeline/generate');
const store = require('../../blog/store');
const research = require('../../blog/research/fetchSources');
const {
    mockSelectTopic, researchFetch, resetBlogState,
} = require('./blogPipeline.support');

beforeEach(resetBlogState);

describe('topic selection only offers publishable leads', () => {
    const theme = () => themes.getTheme('industry-news');

    function item({ id, tier, title, url }) {
        return {
            title,
            summary: `${title}. Motor carrier compliance detail.`,
            url,
            topics: ['regulation', 'compliance', 'freight-market'],
            sourceId: id,
            tier,
            publishedAt: '2026-08-01T00:00:00Z',
            retrievedAt: '2026-08-01T00:00:00Z',
        };
    }

    /**
     * The production shape: a trade-press story is the most newsworthy candidate
     * but cannot satisfy `requiresPrimarySource`, while a primary-sourced
     * candidate sits in the same list.
     */
    const CANDIDATES = [
        item({
            id: 'ttnews',
            tier: 'secondary',
            title: 'Trucking industry reacts to the new hours of service proposal',
            url: 'https://ttnews.com/a',
        }),
        item({
            id: 'federal-register-fmcsa',
            tier: 'primary',
            title: 'FMCSA hours of service recordkeeping amendment for motor carriers',
            url: 'https://www.federalregister.gov/b',
        }),
    ];

    it('a trade-press lead cannot satisfy the sourcing bar on its own', () => {
        // Confirms the premise: this is why the run was being discarded.
        const pkg = generate.buildFactPackage(CANDIDATES[0], [CANDIDATES[0]], theme());
        expect(generate.sourcingIsSufficient(pkg, theme()).ok).toBe(false);
    });

    it('publishes using the primary candidate even when a secondary one exists', async () => {
        // Before the fix, the model was shown both, and if it chose the
        // trade-press story the whole slot was refused with
        // `skipped_no_sources (no primary or official source)` — four
        // consecutive production runs did exactly that.
        mockSelectTopic.mockResolvedValue({ selectedIndex: 0, angle: 'Explain it.' });

        const result = await generate.runSlot(
            { themeId: 'industry-news', publicationDate: '2026-08-02', key: '2026-08-02_industry-news', slotIndex: 0 },
            {
                store,
                fetchImpl: researchFetch([
                    { title: CANDIDATES[1].title, url: CANDIDATES[1].url, summary: CANDIDATES[1].summary, publishedAt: '2026-08-01' },
                ]),
                now: Date.parse('2026-08-02T13:00:00Z'),
            },
        );

        expect(result.outcome).toBe(generate.OUTCOME.PUBLISHED);
    });

    it('still refuses when no candidate can meet the bar, and says so', () => {
        // The sourcing rule itself is unchanged and absolute.
        const secondaryOnly = [CANDIDATES[0]];
        const pkg = generate.buildFactPackage(secondaryOnly[0], secondaryOnly, theme());

        expect(generate.sourcingIsSufficient(pkg, theme())).toEqual({
            ok: false,
            reason: 'no primary or official source',
        });
    });
});

describe('lead document enrichment', () => {
    const { fetchDocumentText, MAX_DOCUMENT_TEXT_CHARS } = require('../../blog/research/fetchSources');

    /**
     * Why this exists: an article written from a one-paragraph abstract is a
     * one-paragraph article. Drafts came in at 251 words against a 450-word floor
     * because the abstract was all the model had, and the honest fix is more
     * material — not a lower floor and not permission to pad.
     */
    it('fetches the document text for a Federal Register URL', async () => {
        const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'Line one.\n\n  Line   two.' });

        const text = await fetchDocumentText(
            'https://www.federalregister.gov/documents/full_text/text/2026/07/30/x.txt',
            { fetchImpl },
        );

        expect(text).toBe('Line one. Line two.');
    });

    it('bounds the text, because an unbounded prompt is refused outright', async () => {
        // 14,000 characters made Groq answer `provider_unavailable` and Gemini
        // `provider_request_rejected` — both over their per-request ceilings.
        const fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(50000) });

        const text = await fetchDocumentText(
            'https://www.federalregister.gov/documents/full_text/text/2026/07/30/x.txt',
            { fetchImpl },
        );

        expect(text).toHaveLength(MAX_DOCUMENT_TEXT_CHARS);
        // The ceiling is Groq's per-minute token budget, which its headers state
        // as `x-ratelimit-limit-tokens: 8000` and which charges input plus the
        // full requested output. Roughly: 9,000 chars ~ 2,250 tokens, plus ~800
        // for the house style and schema, plus a 3,000 article budget and a 512
        // reasoning allowance = ~6,560, inside the ceiling with margin.
        //
        // 12,000 characters would not be: it pushes the total past 8,000 and the
        // request is refused before the model writes anything.
        expect(MAX_DOCUMENT_TEXT_CHARS).toBeLessThanOrEqual(10000);
    });

    it('refuses a URL that is not on federalregister.gov', async () => {
        // The URL arrives from a feed payload, so it is not trusted to be
        // anywhere in particular.
        let called = false;
        const fetchImpl = async () => { called = true; return { ok: true, status: 200, text: async () => 'x' }; };

        expect(await fetchDocumentText('https://evil.example.com/x.txt', { fetchImpl })).toBeNull();
        expect(await fetchDocumentText('http://www.federalregister.gov/x.txt', { fetchImpl })).toBeNull();
        expect(called).toBe(false);
    });

    it('falls back to null rather than throwing when the fetch fails', async () => {
        // A document whose text cannot be read must degrade to its abstract, not
        // take down the run.
        const failing = async () => { throw new Error('network'); };
        expect(await fetchDocumentText('https://www.federalregister.gov/a.txt', { fetchImpl: failing })).toBeNull();

        const notOk = async () => ({ ok: false, status: 404, text: async () => '' });
        expect(await fetchDocumentText('https://www.federalregister.gov/a.txt', { fetchImpl: notOk })).toBeNull();
    });

    it('prefers a substantive rule over a fresher one-page notice', () => {
        // The freshest Federal Register document is routinely a one-page
        // exemption withdrawal, which cannot honestly support 450 words.
        const base = {
            summary: 'Motor carrier hours of service detail.',
            topics: ['regulation', 'compliance', 'freight-market'],
            sourceId: 'federal-register-fmcsa',
            tier: 'primary',
        };
        const items = [
            { ...base, title: 'FMCSA one-page trucking exemption withdrawal', url: 'https://x/a', publishedAt: '2026-08-03T00:00:00Z', pageLength: 1 },
            { ...base, title: 'FMCSA hours of service final rule for motor carriers', url: 'https://x/b', publishedAt: '2026-08-01T00:00:00Z', pageLength: 24 },
        ];

        const candidates = generate.buildCandidates(items, themes.getTheme('industry-news'));

        expect(candidates[0].title).toContain('final rule');
    });
});

describe('item relevance — feed topics are not item topics', () => {
    /**
     * Titles taken verbatim from the live `federal-register-dot` feed on
     * 2026-08-03. Every one arrived tagged `regulation, compliance,
     * freight-market` — the *source's* topics — and every one passed the theme
     * filter. They were the top candidates for the industry-news slot.
     */
    const REAL_OFF_TOPIC = [
        'High-Speed Train Noise Emission Standards',
        'Amendment of Very High Frequency Omnidirectional Range Federal Airway',
        'Establishment of United States Area Navigation Route T-581',
        'Amendment of Class D and Class E Airspace; Morgantown, WV',
        'Notice of Adoption of Tennessee Valley Authority Categorical Exclusion',
        'FAA Transition Plan to Unleaded Aviation Gasoline V1.0',
        'Qualification and Certification of Locomotive Engineers',
        'Amendment of Jet Route J-24 and Very High Frequency Omnidirectional Range',
        'Requirements for Interference-Tolerant Radio Altimeter Systems',
    ];

    it.each(REAL_OFF_TOPIC)('rejects the aviation/rail notice %#: "%s"', (title) => {
        expect(generate.isRoadFreightRelevant({ title, summary: '' })).toBe(false);
    });

    const REAL_ON_TOPIC = [
        'Truck enforcement sweeps hit 32 drivers, 45 vehicles',
        'Trump unveils military-to-trucking hiring pipeline',
        'FMCSA revises hours of service guidance for short-haul operations',
        'Drug and Alcohol Clearinghouse query requirements updated',
        'Electronic logging device revocation affects 400 carriers',
    ];

    it.each(REAL_ON_TOPIC)('accepts the road-freight item: "%s"', (title) => {
        expect(generate.isRoadFreightRelevant({ title, summary: '' })).toBe(true);
    });

    it('matches on the summary when the title alone is uninformative', () => {
        expect(generate.isRoadFreightRelevant({
            title: 'Agency Information Collection Activities',
            summary: 'Renewal of the driver qualification file recordkeeping requirement.',
        })).toBe(true);
    });

    it('keeps off-topic items out of the candidate list entirely', () => {
        // The topic filter alone passes both; only the relevance gate separates
        // them, which is the defect this closes.
        const feedTopics = ['regulation', 'compliance', 'freight-market'];
        const items = [
            {
                title: 'Amendment of Jet Route J-24',
                summary: '',
                url: 'https://www.federalregister.gov/a',
                topics: feedTopics,
                sourceId: 'federal-register-dot',
                tier: 'primary',
                publishedAt: '2026-08-02T00:00:00Z',
            },
            {
                title: 'FMCSA hours of service revision for motor carriers',
                summary: '',
                url: 'https://www.federalregister.gov/b',
                topics: feedTopics,
                sourceId: 'federal-register-fmcsa',
                tier: 'primary',
                publishedAt: '2026-08-01T00:00:00Z',
            },
        ];

        const candidates = generate.buildCandidates(items, themes.getTheme('industry-news'));

        expect(candidates).toHaveLength(1);
        expect(candidates[0].title).toContain('FMCSA');
    });
});
