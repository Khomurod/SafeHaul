/**
 * Legally-licensed article images.
 *
 * The rule this module exists to enforce: SafeHaul never takes an image from a
 * news article or an arbitrary website. Images come only from providers whose
 * public API grants a licence for this use, and every stored image carries the
 * attribution that licence requires.
 *
 * Three providers, each with its own obligations honoured here:
 *  - **Pexels** — free to use, attribution appreciated rather than required;
 *    the API terms do require a link back to Pexels, which is stored.
 *  - **Unsplash** — requires photographer and Unsplash attribution, and
 *    requires hotlinking the delivered image URL rather than re-hosting it.
 *    `allowsHosting: false` is what encodes that.
 *  - **Openverse** — an index of openly-licensed work. The licence varies per
 *    item, so the specific licence and its URL are stored per image, and items
 *    whose licence we cannot identify are rejected.
 *
 * When nothing licensable is found, an approved local SafeHaul image is used.
 * The daily article count is never a reason to publish an image we do not have
 * the right to use.
 */

const { safeUrl } = require('../pipeline/sanitize');

const FETCH_TIMEOUT_MS = 10000;

const PROVIDERS = Object.freeze([
    {
        id: 'pexels',
        displayName: 'Pexels',
        priority: 1,
        searchUrl: 'https://api.pexels.com/v1/search',
        // Pexels authenticates with a bare key in the Authorization header,
        // not a bearer token.
        authHeader: (credentials) => ({ Authorization: credentials.apiKey }),
        secretFields: [{ name: 'apiKey', label: 'API key', description: 'Pexels API key from pexels.com/api.' }],
        licenceName: 'Pexels License',
        licenceUrl: 'https://www.pexels.com/license/',
        allowsHosting: true,
        attributionRequired: false,
    },
    {
        id: 'unsplash',
        displayName: 'Unsplash',
        priority: 2,
        searchUrl: 'https://api.unsplash.com/search/photos',
        authHeader: (credentials) => ({ Authorization: `Client-ID ${credentials.accessKey}` }),
        secretFields: [{ name: 'accessKey', label: 'Access key', description: 'Unsplash application access key.' }],
        licenceName: 'Unsplash License',
        licenceUrl: 'https://unsplash.com/license',
        // Unsplash requires serving the URL they deliver, so SafeHaul must not
        // copy the file into its own storage.
        allowsHosting: false,
        attributionRequired: true,
    },
    {
        id: 'openverse',
        displayName: 'Openverse',
        priority: 3,
        searchUrl: 'https://api.openverse.org/v1/images/',
        // Openverse serves anonymous requests; a token raises the rate limit.
        authHeader: (credentials) => (
            credentials.accessToken ? { Authorization: `Bearer ${credentials.accessToken}` } : {}
        ),
        secretFields: [{ name: 'accessToken', label: 'Access token (optional)', description: 'Openverse API token; raises the anonymous rate limit.' }],
        licenceName: null, // Per-item; resolved from the response.
        licenceUrl: null,
        allowsHosting: false,
        attributionRequired: true,
    },
]);

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

/**
 * The approved local fallback. Committed to the landing site, so it is always
 * available and unambiguously ours.
 */
const FALLBACK_IMAGE = Object.freeze({
    provider: 'safehaul-local',
    sourceUrl: 'https://safehaul.io/news',
    imageUrl: '/assets/images/news-fallback.svg',
    creator: 'SafeHaul',
    licenceName: 'SafeHaul owned asset',
    licenceUrl: 'https://safehaul.io/news',
    attributionText: 'Illustration by SafeHaul',
    altText: 'SafeHaul News and Insights',
    hosted: true,
});

/** Openverse licence codes we accept, with the canonical deed URL. */
const OPENVERSE_LICENCES = Object.freeze({
    'cc0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    'pdm': { name: 'Public Domain Mark', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
    'by': { name: 'CC BY', url: 'https://creativecommons.org/licenses/by/4.0/' },
    'by-sa': { name: 'CC BY-SA', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
});

async function getJson(url, headers, fetchImpl) {
    const doFetch = fetchImpl || globalThis.fetch;
    if (typeof doFetch !== 'function') return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await doFetch(url, {
            headers: { Accept: 'application/json', ...headers },
            signal: controller.signal,
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Normalizes a Pexels result into the stored image record. */
function normalizePexels(payload, provider) {
    const photo = payload?.photos?.[0];
    if (!photo) return null;
    const imageUrl = safeUrl(photo.src?.large || photo.src?.original);
    const sourceUrl = safeUrl(photo.url);
    if (!imageUrl || !sourceUrl) return null;

    const creator = String(photo.photographer || 'Unknown').slice(0, 120);
    return {
        provider: provider.id,
        sourceUrl,
        imageUrl,
        creator,
        licenceName: provider.licenceName,
        licenceUrl: provider.licenceUrl,
        attributionText: `Photo by ${creator} on Pexels`,
        altText: String(photo.alt || '').slice(0, 200) || null,
        hosted: false,
    };
}

function normalizeUnsplash(payload, provider) {
    const photo = payload?.results?.[0];
    if (!photo) return null;
    const imageUrl = safeUrl(photo.urls?.regular || photo.urls?.full);
    const sourceUrl = safeUrl(photo.links?.html);
    if (!imageUrl || !sourceUrl) return null;

    const creator = String(photo.user?.name || 'Unknown').slice(0, 120);
    return {
        provider: provider.id,
        sourceUrl,
        imageUrl,
        creator,
        licenceName: provider.licenceName,
        licenceUrl: provider.licenceUrl,
        attributionText: `Photo by ${creator} on Unsplash`,
        altText: String(photo.alt_description || photo.description || '').slice(0, 200) || null,
        hosted: false,
    };
}

function normalizeOpenverse(payload, provider) {
    const image = payload?.results?.[0];
    if (!image) return null;

    // The licence varies per item, so an item whose licence we do not
    // recognise is rejected rather than guessed at.
    const licence = OPENVERSE_LICENCES[String(image.license || '').toLowerCase()];
    if (!licence) return null;

    const imageUrl = safeUrl(image.url);
    const sourceUrl = safeUrl(image.foreign_landing_url || image.url);
    if (!imageUrl || !sourceUrl) return null;

    const creator = String(image.creator || 'Unknown').slice(0, 120);
    return {
        provider: provider.id,
        sourceUrl,
        imageUrl,
        creator,
        licenceName: licence.name,
        licenceUrl: licence.url,
        attributionText: `"${String(image.title || 'Untitled').slice(0, 120)}" by ${creator}, licensed ${licence.name}`,
        altText: String(image.title || '').slice(0, 200) || null,
        hosted: false,
    };
}

const NORMALIZERS = Object.freeze({
    pexels: normalizePexels,
    unsplash: normalizeUnsplash,
    openverse: normalizeOpenverse,
});

function buildSearchUrl(provider, query) {
    const url = new URL(provider.searchUrl);
    if (provider.id === 'openverse') {
        url.searchParams.set('q', query);
        url.searchParams.set('page_size', '1');
        // Ask Openverse for commercially-usable, modifiable work only.
        url.searchParams.set('license_type', 'commercial,modification');
    } else {
        url.searchParams.set('query', query);
        url.searchParams.set('per_page', '1');
        if (provider.id === 'pexels') url.searchParams.set('orientation', 'landscape');
    }
    return url.toString();
}

/**
 * Finds a legally usable image, trying providers in priority order.
 *
 * @param {object} params
 * @param {string} params.query search terms derived from the article topic
 * @param {string} params.altText descriptive alt text for the article
 * @param {Map<string, object>} params.credentials provider id → credential values
 * @returns {Promise<object>} an image record; the local fallback if nothing licensable was found
 */
async function findLicensedImage({ query, altText, credentials = new Map(), fetchImpl, now = Date.now() }) {
    for (const provider of PROVIDERS) {
        const values = credentials.get(provider.id);
        // Openverse works anonymously; the others need a key.
        const needsKey = provider.id !== 'openverse';
        if (needsKey && (!values || !Object.keys(values).length)) continue;

        const payload = await getJson(
            buildSearchUrl(provider, query),
            provider.authHeader(values || {}),
            fetchImpl,
        );
        if (!payload) continue;

        const image = NORMALIZERS[provider.id](payload, provider);
        if (!image) continue;

        return {
            ...image,
            // Article-specific alt text beats the provider's own description:
            // it describes the image in the context it is used in.
            altText: altText || image.altText || 'Illustration for this article',
            attributionRequired: provider.attributionRequired,
            allowsHosting: provider.allowsHosting,
            retrievedAt: new Date(now).toISOString(),
        };
    }

    return { ...FALLBACK_IMAGE, altText: altText || FALLBACK_IMAGE.altText, retrievedAt: new Date(now).toISOString() };
}

/**
 * Whether an image record carries everything a licence audit would ask for.
 * The pipeline refuses to publish an image that fails this.
 */
function isLicenceComplete(image) {
    return Boolean(
        image
        && image.provider
        && image.imageUrl
        && image.sourceUrl
        && image.creator
        && image.licenceName
        && image.licenceUrl
        && image.attributionText
        && image.altText,
    );
}

module.exports = {
    PROVIDERS,
    PROVIDERS_BY_ID,
    FALLBACK_IMAGE,
    OPENVERSE_LICENCES,
    findLicensedImage,
    isLicenceComplete,
    buildSearchUrl,
    normalizePexels,
    normalizeUnsplash,
    normalizeOpenverse,
};
